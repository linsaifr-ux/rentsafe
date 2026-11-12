import { beforeAll, describe, expect, it } from "vitest";
import { fakeEmbedder, type Embedder } from "../src/ai/embed.js";
import { extractJson, generateJson, LlmJsonError, type Llm, type LlmRequest } from "../src/ai/llm.js";
import { answerQuestion, type QaDeps } from "../src/ai/orchestrator.js";
import { answerSchema } from "../src/ai/prompts/answer.v1.js";
import type { QaLog, QaRecord } from "../src/ai/qaLog.js";
import { memoryKbIndex } from "../src/ai/memoryIndex.js";
import { retrieve, type KbIndex } from "../src/ai/retrieve.js";
import { loadKb } from "../src/kb/load.js";
import { answerMessages } from "../src/line/answerFlex.js";
import { memoryRateLimiter } from "../src/rateLimit.js";
import type { UserDoc } from "../src/users.js";

/** 依序回傳預先寫好的回應；記錄每次收到的 prompt */
function scriptedLlm(responses: unknown[]) {
  const calls: LlmRequest[] = [];
  const llm: Llm = {
    async generate(req) {
      calls.push(req);
      const r = responses.shift();
      if (r === undefined) throw new Error("沒有更多預設回應");
      return typeof r === "string" ? r : JSON.stringify(r);
    },
  };
  return { llm, calls };
}

async function memoryIndex(embedder: Embedder): Promise<KbIndex> {
  return memoryKbIndex((await loadKb()).chunks, embedder);
}

const user: UserDoc = { displayName: "小明", city: "臺北市", landlordType: "unknown", active: true, consentAt: null };

const CLS_REPAIR = { scenario: "no_repair", city: null, landlordType: "individual", needsClarification: null, asksOutcome: false };

const GOOD_ANSWER = {
  summary: "租屋的修繕原則上由房東負責（民法第 429 條）。你可以先定一個合理期限請房東修。",
  citations: [{ lawName: "民法", articleNo: "429", quote: "租賃物之修繕，除契約另有訂定或另有習慣外，由出租人負擔" }],
  actions: ["用訊息或存證信函通知房東，並給一個合理期限", "保留通知紀錄"],
  evidence: ["漏水照片", "跟房東的對話紀錄"],
  referTo: ["none"],
  confidence: "high",
};

describe("answerQuestion", () => {
  let index: KbIndex;
  const embedder = fakeEmbedder();
  beforeAll(async () => {
    index = await memoryIndex(embedder);
  });

  function deps(llm: Llm, extra: Partial<QaDeps> = {}): QaDeps & { logs: QaRecord[] } {
    const logs: QaRecord[] = [];
    const qaLog: QaLog = { add: async (_uid, rec) => void logs.push(rec) };
    return { llm, embedder, index, limiter: memoryRateLimiter(), qaLog, logs, ...extra };
  }

  it("正常流程：引用驗證一次通過", async () => {
    const { llm, calls } = scriptedLlm([CLS_REPAIR, GOOD_ANSWER]);
    const d = deps(llm);
    const { result, trace } = await answerQuestion({ uid: "U1", text: "冷氣壞了房東不修怎麼辦", user }, d);
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") return;
    expect(result.citations).toEqual([
      expect.objectContaining({
        lawName: "民法",
        articleNo: "429",
        sourceUrl: "https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=B0000001&flno=429",
        plain: null, // 白話未審閱，不顯示
      }),
    ]);
    expect(result.note).toBeNull();
    expect(result.city).toBe("臺北市"); // 沿用使用者設定
    expect(trace?.secondPass).toBeNull();
    // 情境必帶條文有送進 prompt
    expect(calls[1]?.user).toContain('articleNo="430"');
    expect(calls[1]?.user).toContain('articleNo="423"');
    expect(d.logs[0]).toMatchObject({ outcome: "answer", promptVersion: "classify.v1+answer.v1", referred: false });
  });

  it("引用錯誤 → 嚴格重試後通過", async () => {
    const bad = { ...GOOD_ANSWER, citations: [{ lawName: "民法", articleNo: "429", quote: "房東要負責修" }] };
    const { llm, calls } = scriptedLlm([CLS_REPAIR, bad, GOOD_ANSWER]);
    const d = deps(llm);
    const { result, trace } = await answerQuestion({ uid: "U1", text: "冷氣壞了房東不修", user }, d);
    expect(trace?.firstPass?.ok).toBe(false);
    expect(trace?.secondPass?.ok).toBe(true);
    expect(calls[2]?.user).toContain("只能引用以下條號");
    expect(calls[2]?.user).toContain("quote 不是逐字出自條文");
    expect(result.kind === "answer" && result.note).toBeNull();
    expect(d.logs[0]?.citeCheck).toEqual({ firstPassOk: false, retried: true, finalOk: true, degraded: false });
  });

  it("重試仍失敗 → 移除未驗證引用並加註", async () => {
    const hallucinated = {
      ...GOOD_ANSWER,
      summary: "依民法第 429 條與第 999 條，房東要修。",
      citations: [...GOOD_ANSWER.citations, { lawName: "民法", articleNo: "999", quote: "不存在的條文" }],
    };
    const { llm } = scriptedLlm([CLS_REPAIR, hallucinated, hallucinated]);
    const { result, trace } = await answerQuestion({ uid: "U1", text: "冷氣壞了房東不修", user }, deps(llm));
    expect(trace?.firstPassNotRetrieved).toBe(1);
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") return;
    expect(result.citations.map((c) => c.articleNo)).toEqual(["429"]);
    expect(result.summary).toBe("依民法第 429 條與相關規定，房東要修。");
    expect(result.note).toContain("部分內容未能對應條文");
  });

  it("緊急狀況：不呼叫模型", async () => {
    const { llm, calls } = scriptedLlm([]);
    const { result } = await answerQuestion({ uid: "U1", text: "救命房間都是煙", user }, deps(llm));
    expect(result).toEqual({ kind: "emergency", emergencyKind: "fire" });
    expect(calls).toHaveLength(0);
  });

  it("需要反問：回傳問題，問縣市時附縣市選單", async () => {
    const { llm } = scriptedLlm([{ ...CLS_REPAIR, scenario: "fire", needsClarification: "你租屋在哪個縣市？" }]);
    const { result } = await answerQuestion({ uid: "U1", text: "要裝住警器嗎", user: { ...user, city: null } }, deps(llm));
    expect(result).toEqual({ kind: "clarify", question: "你租屋在哪個縣市？", askCity: true });
    const msg = answerMessages(result, "L")[0]!;
    expect((msg.quickReply as { items: unknown[] }).items).toHaveLength(7);
  });

  it("問勝敗 → 附轉介（法扶）", async () => {
    const { llm } = scriptedLlm([{ ...CLS_REPAIR, asksOutcome: true }, GOOD_ANSWER]);
    const { result } = await answerQuestion({ uid: "U1", text: "告房東會贏嗎", user }, deps(llm));
    expect(result.kind === "answer" && result.referrals.map((r) => r.id)).toEqual(["legal_aid", "mediation"]);
  });

  it("每人每日上限 50 題", async () => {
    const limiter = memoryRateLimiter();
    for (let i = 0; i < 50; i++) await limiter.hit("qa/U1", 50, 86_400_000);
    const { llm, calls } = scriptedLlm([]);
    const { result } = await answerQuestion({ uid: "U1", text: "押金可以收幾個月", user }, deps(llm, { limiter }));
    expect(result).toEqual({ kind: "rate_limited", scope: "user" });
    expect(calls).toHaveLength(0);
  });

  it("火災情境：帶入民法 423、424、434 與消防法 6", async () => {
    const r = await retrieve({ question: "租屋處火災", city: "新北市", scenario: "fire", embedder, index });
    const keys = r.map((c) => `${c.lawName}${c.articleNo}`);
    for (const k of ["民法423", "民法424", "民法434", "消防法6"]) expect(keys).toContain(k);
  });
});

describe("answerMessages", () => {
  it("回答卡片包含結論、條文、原文連結、免責聲明；有轉介時為 carousel", () => {
    const msgs = answerMessages(
      {
        kind: "answer",
        summary: "結論",
        citations: [{ lawName: "民法", articleNo: "429", quote: "由出租人負擔", sourceUrl: "https://law.moj.gov.tw/x", scope: "national", plain: null }],
        actions: ["a"],
        evidence: ["e"],
        referrals: [{ id: "legal_aid", name: "法扶", contact: "412-8518", hours: null, note: "免費", url: null, source: "", checkedAt: "" }],
        confidence: "high",
        note: null,
        scenario: "no_repair",
        city: null,
      },
      "L",
    );
    const s = JSON.stringify(msgs);
    expect(s).toContain("民法 第 429 條");
    expect(s).toContain("https://law.moj.gov.tw/x");
    expect(s).toContain("本服務提供法律資訊，不是法律意見");
    expect((msgs[0]!.contents as { type: string }).type).toBe("carousel");
  });

  it("緊急卡片有 119／110 按鈕與急救包連結", () => {
    const s = JSON.stringify(answerMessages({ kind: "emergency", emergencyKind: "fire" }, "L"));
    expect(s).toContain("tel:119");
    expect(s).toContain("https://liff.line.me/L/emergency");
  });
});

describe("generateJson", () => {
  it("格式錯誤重試 1 次並附上錯誤說明", async () => {
    const { llm, calls } = scriptedLlm(["not json", GOOD_ANSWER]);
    const out = await generateJson(llm, { system: "s", user: "u" }, answerSchema);
    expect(out.summary).toBe(GOOD_ANSWER.summary);
    expect(calls[1]?.user).toContain("上一次的輸出不符合格式");
  });

  it("兩次都失敗丟出 LlmJsonError", async () => {
    const { llm } = scriptedLlm(["x", "y"]);
    await expect(generateJson(llm, { system: "s", user: "u" }, answerSchema)).rejects.toBeInstanceOf(LlmJsonError);
  });

  it("summary 出現「保證」「勝訴」視為格式錯誤", async () => {
    const { llm } = scriptedLlm([{ ...GOOD_ANSWER, summary: "你保證勝訴" }, { ...GOOD_ANSWER, summary: "一定可以" }]);
    await expect(generateJson(llm, { system: "s", user: "u" }, answerSchema)).rejects.toBeInstanceOf(LlmJsonError);
  });

  it("actions／evidence 超過 4 項自動截斷", () => {
    const out = answerSchema.parse({ ...GOOD_ANSWER, actions: ["1", "2", "3", "4", "5"] });
    expect(out.actions).toEqual(["1", "2", "3", "4"]);
  });

  it("extractJson 去掉 ```json 圍欄", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });
});
