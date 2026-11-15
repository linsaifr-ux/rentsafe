import { createHash } from "node:crypto";
import { EVIDENCE, RATE_LIMITS } from "../config.js";
import { maskPii } from "../lease/pii.js";
import type { ContentResult, LineClient } from "../line/client.js";
import { textMessage } from "../line/flex.js";
import type { LineEvent, LineMessage } from "../line/types.js";
import { DAY, type RateLimiter } from "../rateLimit.js";
import { categoryChangedMessage, EVIDENCE_NOT_FOUND, evidenceCard } from "./card.js";
import { CATEGORY_IDS, evidencePaths, type Category, type EvidenceType, type StoredEvidence } from "./model.js";
import type { EvidenceRepo } from "./repo.js";
import type { BlobStore } from "./store.js";

export interface EvidenceDeps {
  repo: EvidenceRepo;
  store: BlobStore;
  now?: () => Date;
}

export interface NewEvidence {
  type: EvidenceType;
  category: Category;
  text: string;
  fileName: string | null;
  mimeType: string | null;
  /** 原檔；文字紀錄為 null */
  data: Buffer | null;
  thumb: Buffer | null;
  source: "line" | "liff";
  occurredAt?: Date;
}

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** 描述統一遮蔽個資、限制長度 */
export function cleanText(text: string): string {
  return maskPii(text.trim()).slice(0, EVIDENCE.textMaxLength);
}

/** 存一筆證據：先寫檔、再寫紀錄；寫紀錄失敗就把檔案刪掉 */
export async function storeEvidence(uid: string, input: NewEvidence, deps: EvidenceDeps): Promise<StoredEvidence> {
  const now = deps.now?.() ?? new Date();
  const id = deps.repo.newId(uid);
  const paths = evidencePaths(uid, id);
  const text = cleanText(input.text);
  const rec = {
    type: input.type,
    category: input.category,
    text,
    fileName: input.fileName,
    mimeType: input.mimeType,
    bytes: input.data?.length ?? Buffer.byteLength(text),
    storagePath: input.data ? paths.file : null,
    thumbPath: input.thumb ? paths.thumb : null,
    // 文字紀錄的雜湊以存下來（遮蔽後）的文字計算，才能事後比對
    sha256: sha256(input.data ?? text),
    source: input.source,
    occurredAt: input.occurredAt ?? now,
    createdAt: now,
  };
  const written: string[] = [];
  try {
    if (input.data) {
      await deps.store.put(paths.file, input.data, input.mimeType ?? "application/octet-stream");
      written.push(paths.file);
    }
    if (input.thumb) {
      await deps.store.put(paths.thumb, input.thumb, "image/jpeg");
      written.push(paths.thumb);
    }
    await deps.repo.add(uid, id, rec);
  } catch (err) {
    await Promise.allSettled(written.map((p) => deps.store.delete(p)));
    throw err;
  }
  return { id, ...rec };
}

/** 刪除一筆證據與它的檔案 */
export async function deleteEvidence(uid: string, id: string, deps: EvidenceDeps): Promise<boolean> {
  const old = await deps.repo.delete(uid, id);
  if (!old) return false;
  await Promise.allSettled([old.storagePath, old.thumbPath].filter((p): p is string => Boolean(p)).map((p) => deps.store.delete(p)));
  return true;
}

export const NOTE_PREFIX = /^\s*#存證\s*/;

export const MSG = {
  noteEmpty: textMessage("在「#存證」後面寫下要記錄的事，例如：\n#存證 房東說下週會來修熱水器"),
  tooLarge: textMessage(`這個檔案超過 ${EVIDENCE.maxFileBytes / 1024 / 1024}MB，沒辦法存進存證廊。請先自己保留原檔，也可以傳截圖或縮小後的版本。`),
  notReady: textMessage("影片或錄音還在處理中，請過一下再傳一次。這次還沒有存起來。"),
  expired: textMessage("讀不到這個檔案（可能已經過期），請再傳一次。"),
  rateLimited: textMessage("今天存的證據太多了，請明天再試。"),
};

const TYPE_BY_MESSAGE: Record<string, EvidenceType> = { image: "photo", video: "video", audio: "audio", file: "document" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 影片、錄音剛上傳時 LINE 可能還在轉檔（202），稍等重試 */
async function download(line: LineClient, messageId: string, retryMs: number): Promise<ContentResult> {
  let res: ContentResult = { kind: "not_ready" };
  for (let i = 0; i <= EVIDENCE.contentRetries; i++) {
    res = await line.getContent(messageId, { maxBytes: EVIDENCE.maxFileBytes });
    if (res.kind !== "not_ready") return res;
    if (i < EVIDENCE.contentRetries) await sleep(retryMs);
  }
  return res;
}

/** 聊天室收件（SPEC 9）：圖片、影片、錄音、檔案、以「#存證」開頭的文字 → 存一筆，回時間戳卡片 */
export async function saveFromLine(
  args: { uid: string; event: Extract<LineEvent, { type: "message" }> },
  deps: EvidenceDeps & { line: LineClient; limiter: RateLimiter; liffId: string; retryMs?: number },
): Promise<LineMessage[]> {
  const { uid, event } = args;
  const { message } = event;
  const occurredAt = new Date(event.timestamp);

  if (message.type === "text") {
    const note = (message.text ?? "").replace(NOTE_PREFIX, "");
    if (!note.trim()) return [MSG.noteEmpty];
    if (!(await deps.limiter.hit(`evidence/${uid}`, RATE_LIMITS.evidencePerUserPerDay, DAY))) return [MSG.rateLimited];
    const ev = await storeEvidence(uid, { type: "note", category: "other", text: note, fileName: null, mimeType: null, data: null, thumb: null, source: "line", occurredAt }, deps);
    return [evidenceCard(ev, deps.liffId)];
  }

  const type = TYPE_BY_MESSAGE[message.type];
  if (!type) return [];
  if (!(await deps.limiter.hit(`evidence/${uid}`, RATE_LIMITS.evidencePerUserPerDay, DAY))) return [MSG.rateLimited];

  const res = await download(deps.line, message.id, deps.retryMs ?? EVIDENCE.contentRetryMs);
  if (res.kind === "too_large") return [MSG.tooLarge];
  if (res.kind === "not_ready") return [MSG.notReady];
  if (res.kind === "not_found") return [MSG.expired];

  let thumb: Buffer | null = null;
  if (type === "photo" || type === "video") {
    const p = await deps.line.getContent(message.id, { preview: true, maxBytes: EVIDENCE.maxThumbBytes }).catch(() => null);
    if (p?.kind === "ok") thumb = p.content.data;
  }
  const ev = await storeEvidence(
    uid,
    {
      type,
      category: "other",
      text: "",
      fileName: message.fileName ?? null,
      mimeType: res.content.contentType,
      data: res.content.data,
      thumb,
      source: "line",
      occurredAt,
    },
    deps,
  );
  return [evidenceCard(ev, deps.liffId)];
}

/** 存證卡片按「改分類」 */
export async function setCategoryFromLine(args: { uid: string; id: string; category: string }, deps: Pick<EvidenceDeps, "repo">): Promise<LineMessage[]> {
  if (!CATEGORY_IDS.includes(args.category as Category)) return [];
  const updated = await deps.repo.update(args.uid, args.id, { category: args.category as Category });
  return [updated ? categoryChangedMessage(updated.category) : EVIDENCE_NOT_FOUND];
}
