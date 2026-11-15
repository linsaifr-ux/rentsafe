import { normalizeCity } from "../cities.js";
import { LINE_LOADING_SECONDS } from "../config.js";
import type { UserDoc, UserRepo } from "../users.js";
import type { LineClient } from "./client.js";
import { ASK_LAW_GUIDE, citySetMessage, textMessage, welcomeMessage } from "./flex.js";
import { parsePostback } from "./postback.js";
import { verifyLineSignature } from "./signature.js";
import { parseEvents, type LineEvent, type LineMessage } from "./types.js";

export interface WebhookDeps {
  line: LineClient;
  users: UserRepo;
  liffId: string;
  /** F5 法條問答（Phase 3 接上）；回傳要回覆的訊息 */
  answerQuestion?: (args: { uid: string; text: string; user: UserDoc }) => Promise<LineMessage[]>;
  /** F3 存證（Phase 6 接上） */
  saveEvidence?: (args: { uid: string; event: Extract<LineEvent, { type: "message" }> }) => Promise<LineMessage[]>;
  /** 存證卡片的「改分類」 */
  setEvidenceCategory?: (args: { uid: string; id: string; category: string }) => Promise<LineMessage[]>;
  log?: (msg: string, data?: unknown) => void;
}

export const QA_NOT_READY = textMessage("法條問答功能準備中，很快就能用囉！");
export const EVIDENCE_NOT_READY = textMessage("存證廊功能準備中，很快就能用囉！這次的檔案還沒有存起來，請先自行保留。");

const EVIDENCE_TYPES = new Set(["image", "video", "audio", "file"]);

/** 處理單一事件，回傳要用 reply token 回覆的訊息（空陣列＝不回覆） */
export async function handleEvent(ev: LineEvent, deps: WebhookDeps): Promise<LineMessage[]> {
  const uid = ev.source.userId;
  if (!uid) return []; // 群組等沒有 userId 的來源不處理

  switch (ev.type) {
    case "follow": {
      const profile = await deps.line.getProfile(uid).catch(() => null);
      await deps.users.ensure(uid, { displayName: profile?.displayName, active: true });
      return [welcomeMessage(deps.liffId, profile?.displayName)];
    }
    case "unfollow": {
      await deps.users.setActive(uid, false);
      return [];
    }
    case "postback": {
      const pb = parsePostback(ev.postback.data);
      if (pb.action === "setCity") {
        const city = normalizeCity(pb.city);
        await deps.users.ensure(uid, {});
        await deps.users.setCity(uid, city);
        return [citySetMessage(city)];
      }
      if (pb.action === "askLaw") return [ASK_LAW_GUIDE];
      if (pb.action === "evCat") return deps.setEvidenceCategory ? deps.setEvidenceCategory({ uid, id: pb.id, category: pb.category }) : [EVIDENCE_NOT_READY];
      return [];
    }
    case "message": {
      const { message } = ev;
      if (EVIDENCE_TYPES.has(message.type) || (message.type === "text" && message.text?.trimStart().startsWith("#存證"))) {
        return deps.saveEvidence ? deps.saveEvidence({ uid, event: ev }) : [EVIDENCE_NOT_READY];
      }
      if (message.type === "text" && message.text) {
        if (!deps.answerQuestion) return [QA_NOT_READY];
        // 回答要十幾秒，先顯示「輸入中」動畫（LINE 只支援一對一聊天）；失敗不影響回答
        if (ev.source.type === "user") await deps.line.showLoading(uid, LINE_LOADING_SECONDS).catch((err: unknown) => deps.log?.("showLoading failed", { err: String(err) }));
        const user = await deps.users.ensure(uid, {});
        return deps.answerQuestion({ uid, text: message.text, user });
      }
      return [textMessage("目前只看得懂文字、圖片、影片、錄音和檔案喔！")];
    }
  }
}

export interface WebhookRequest {
  rawBody: Buffer | string;
  signature: string | undefined;
  body: unknown;
}

/** 驗證簽章 → 解析事件 → 逐一處理並回覆。回傳 HTTP 狀態碼。 */
export async function processWebhook(
  req: WebhookRequest,
  channelSecret: string,
  deps: WebhookDeps,
): Promise<number> {
  if (!verifyLineSignature(req.rawBody, req.signature, channelSecret)) return 401;
  const events = parseEvents(req.body);
  await Promise.allSettled(
    events.map(async (ev) => {
      try {
        const messages = await handleEvent(ev, deps);
        if (messages.length > 0 && ev.replyToken) await deps.line.reply(ev.replyToken, messages);
      } catch (err) {
        deps.log?.("webhook event failed", { type: ev.type, err: String(err) });
        if (ev.replyToken) {
          await deps.line
            .reply(ev.replyToken, [textMessage("系統暫時出了點問題，請稍後再試一次。")])
            .catch(() => undefined);
        }
      }
    }),
  );
  return 200;
}
