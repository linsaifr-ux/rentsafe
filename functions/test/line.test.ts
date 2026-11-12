import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizeCity } from "../src/cities.js";
import { createLineClient } from "../src/line/client.js";
import { welcomeMessage } from "../src/line/flex.js";
import { encodePostback, parsePostback } from "../src/line/postback.js";
import { verifyLineSignature } from "../src/line/signature.js";
import { parseEvents } from "../src/line/types.js";
import { EVIDENCE_NOT_READY, QA_NOT_READY, processWebhook } from "../src/line/webhook.js";
import { fakeLine, memoryUserRepo } from "./fakes.js";

const SECRET = "test-channel-secret";
const sign = (body: string, secret = SECRET) => createHmac("sha256", secret).update(body).digest("base64");

describe("verifyLineSignature", () => {
  const body = JSON.stringify({ events: [] });

  it("正確簽章通過", () => {
    expect(verifyLineSignature(body, sign(body), SECRET)).toBe(true);
    expect(verifyLineSignature(Buffer.from(body), sign(body), SECRET)).toBe(true);
  });

  it("簽章錯誤、缺少、或 secret 不同都拒絕", () => {
    expect(verifyLineSignature(body, sign(body, "other"), SECRET)).toBe(false);
    expect(verifyLineSignature(body, undefined, SECRET)).toBe(false);
    expect(verifyLineSignature(body, "", SECRET)).toBe(false);
    expect(verifyLineSignature(body, "not-base64!!", SECRET)).toBe(false);
    expect(verifyLineSignature(body, sign(body), "")).toBe(false);
  });

  it("body 被竄改就拒絕", () => {
    expect(verifyLineSignature(body + " ", sign(body), SECRET)).toBe(false);
  });
});

describe("postback", () => {
  it("encode/parse 來回一致", () => {
    expect(parsePostback(encodePostback({ action: "setCity", city: "新北市" }))).toEqual({
      action: "setCity",
      city: "新北市",
    });
    expect(parsePostback("action=setCity&city=")).toEqual({ action: "setCity", city: null });
    expect(parsePostback("action=askLaw")).toEqual({ action: "askLaw" });
    expect(parsePostback("foo=bar")).toEqual({ action: "unknown" });
  });
});

describe("normalizeCity", () => {
  it("台／臺、有無「市」都能對應", () => {
    expect(normalizeCity("台北")).toBe("臺北市");
    expect(normalizeCity("臺中市")).toBe("臺中市");
    expect(normalizeCity("新北")).toBe("新北市");
    expect(normalizeCity("花蓮")).toBe("花蓮縣");
    expect(normalizeCity("火星")).toBeNull();
    expect(normalizeCity("")).toBeNull();
    expect(normalizeCity(null)).toBeNull();
  });
});

describe("parseEvents", () => {
  it("略過不認得或格式錯誤的事件", () => {
    const events = parseEvents({
      events: [
        { type: "follow", timestamp: 1, source: { type: "user", userId: "U1" }, replyToken: "r" },
        { type: "beacon", timestamp: 1, source: { type: "user", userId: "U1" } },
        { type: "message", timestamp: 1 },
      ],
    });
    expect(events.map((e) => e.type)).toEqual(["follow"]);
    expect(parseEvents("garbage")).toEqual([]);
  });
});

describe("welcomeMessage", () => {
  it("包含隱私權連結、免責聲明與 7 個縣市選項", () => {
    const msg = welcomeMessage("1234-abcd", "小明");
    const s = JSON.stringify(msg);
    expect(s).toContain("https://liff.line.me/1234-abcd/privacy");
    expect(s).toContain("本服務提供法律資訊，不是法律意見");
    expect(s).toContain("小明");
    const qr = msg.quickReply as { items: unknown[] };
    expect(qr.items).toHaveLength(7);
  });
});

function webhook(events: unknown[]) {
  const body = JSON.stringify({ destination: "x", events });
  return { rawBody: Buffer.from(body), signature: sign(body), body: JSON.parse(body) as unknown };
}

const src = (userId = "U1") => ({ type: "user", userId });

describe("processWebhook", () => {
  function setup() {
    const line = fakeLine({ U1: "小明" });
    const users = memoryUserRepo();
    const deps = { line: line.client, users: users.repo, liffId: "liff-1" };
    return { line, users, deps };
  }

  it("簽章錯誤回 401，不處理任何事件", async () => {
    const { line, deps } = setup();
    const req = webhook([{ type: "follow", timestamp: 1, source: src(), replyToken: "r1" }]);
    expect(await processWebhook({ ...req, signature: "bad" }, SECRET, deps)).toBe(401);
    expect(line.replies).toHaveLength(0);
  });

  it("follow：建立使用者並回歡迎卡", async () => {
    const { line, users, deps } = setup();
    const status = await processWebhook(
      webhook([{ type: "follow", timestamp: 1, source: src(), replyToken: "r1" }]),
      SECRET,
      deps,
    );
    expect(status).toBe(200);
    expect(users.docs.get("U1")).toMatchObject({ displayName: "小明", active: true, city: null });
    expect(line.replies).toHaveLength(1);
    expect(line.replies[0]?.replyToken).toBe("r1");
    expect(line.replies[0]?.messages[0]?.type).toBe("flex");
  });

  it("選縣市 postback：寫入 city 並回覆確認", async () => {
    const { line, users, deps } = setup();
    await processWebhook(
      webhook([
        {
          type: "postback",
          timestamp: 1,
          source: src(),
          replyToken: "r2",
          postback: { data: "action=setCity&city=新北市" },
        },
      ]),
      SECRET,
      deps,
    );
    expect(users.docs.get("U1")?.city).toBe("新北市");
    expect(JSON.stringify(line.replies[0]?.messages)).toContain("新北市");
  });

  it("選「其他」：city 設為 null", async () => {
    const { users, deps } = setup();
    await users.repo.setCity("U1", "臺北市");
    await processWebhook(
      webhook([
        { type: "postback", timestamp: 1, source: src(), replyToken: "r", postback: { data: "action=setCity&city=" } },
      ]),
      SECRET,
      deps,
    );
    expect(users.docs.get("U1")?.city).toBeNull();
  });

  it("unfollow：標記停用、不回覆", async () => {
    const { line, users, deps } = setup();
    await users.repo.ensure("U1", {});
    await processWebhook(webhook([{ type: "unfollow", timestamp: 1, source: src() }]), SECRET, deps);
    expect(users.docs.get("U1")?.active).toBe(false);
    expect(line.replies).toHaveLength(0);
  });

  it("文字訊息：沒接 F5 時回「準備中」；接上後交給 answerQuestion", async () => {
    const { line, deps } = setup();
    const ev = { type: "message", timestamp: 1, source: src(), replyToken: "r3", message: { id: "m", type: "text", text: "押金可以收幾個月？" } };
    await processWebhook(webhook([ev]), SECRET, deps);
    expect(line.replies[0]?.messages).toEqual([QA_NOT_READY]);

    const asked: string[] = [];
    await processWebhook(webhook([ev]), SECRET, {
      ...deps,
      answerQuestion: async ({ text }) => {
        asked.push(text);
        return [{ type: "text", text: "答案" }];
      },
    });
    expect(asked).toEqual(["押金可以收幾個月？"]);
    expect(line.replies[1]?.messages).toEqual([{ type: "text", text: "答案" }]);
    // 沒接 F5 時不顯示動畫；接上後回答前先顯示「輸入中」動畫
    expect(line.loadings).toEqual([{ chatId: "U1", seconds: 60 }]);
  });

  it("「輸入中」動畫失敗時仍正常回答", async () => {
    const { line, deps } = setup();
    line.client.showLoading = async () => {
      throw new Error("LINE API 500");
    };
    const ev = { type: "message", timestamp: 1, source: src(), replyToken: "r", message: { id: "m", type: "text", text: "漏水" } };
    await processWebhook(webhook([ev]), SECRET, { ...deps, answerQuestion: async () => [{ type: "text", text: "答案" }] });
    expect(line.replies[0]?.messages).toEqual([{ type: "text", text: "答案" }]);
  });

  it("圖片與 #存證 文字走存證流程", async () => {
    const { line, deps } = setup();
    await processWebhook(
      webhook([
        { type: "message", timestamp: 1, source: src(), replyToken: "a", message: { id: "1", type: "image" } },
        { type: "message", timestamp: 1, source: src(), replyToken: "b", message: { id: "2", type: "text", text: "#存證 房東說下週修" } },
      ]),
      SECRET,
      deps,
    );
    expect(line.replies.map((r) => r.messages)).toEqual([[EVIDENCE_NOT_READY], [EVIDENCE_NOT_READY]]);
  });

  it("處理失敗時回覆錯誤訊息、仍回 200", async () => {
    const { line, deps } = setup();
    const status = await processWebhook(
      webhook([{ type: "message", timestamp: 1, source: src(), replyToken: "r", message: { id: "m", type: "text", text: "hi" } }]),
      SECRET,
      {
        ...deps,
        answerQuestion: async () => {
          throw new Error("boom");
        },
      },
    );
    expect(status).toBe(200);
    expect(JSON.stringify(line.replies[0]?.messages)).toContain("系統暫時出了點問題");
  });
});

describe("createLineClient", () => {
  it("reply 帶 Bearer token、最多 5 則", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const c = createLineClient("TOKEN", fetchImpl);
    await c.reply("rt", Array.from({ length: 7 }, (_, i) => ({ type: "text", text: String(i) })));
    expect(calls[0]?.url).toBe("https://api.line.me/v2/bot/message/reply");
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN");
    expect(JSON.parse(String(calls[0]?.init.body)).messages).toHaveLength(5);
  });

  it("showLoading 呼叫 chat/loading/start，秒數調成 5 的倍數且不超過 60", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status: 202 });
    }) as unknown as typeof fetch;
    const c = createLineClient("TOKEN", fetchImpl);
    await c.showLoading("U1", 90);
    await c.showLoading("U1", 12);
    expect(calls[0]?.url).toBe("https://api.line.me/v2/bot/chat/loading/start");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ chatId: "U1", loadingSeconds: 60 });
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({ chatId: "U1", loadingSeconds: 10 });
  });

  it("API 錯誤時丟出例外", async () => {
    const fetchImpl = (async () => new Response("bad", { status: 400 })) as unknown as typeof fetch;
    await expect(createLineClient("T", fetchImpl).push("U", [])).rejects.toThrow("LINE API 400");
  });
});
