import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectEmergency } from "../src/ai/safety.js";
import { kbKeySet, parseJsonl, percentile, scoreQuestion, summarize, type QuestionOutcome } from "../src/eval/metrics.js";

const kb = kbKeySet([
  { lawName: "民法", articleNo: "424" },
  { lawName: "民法", articleNo: "429" },
  { lawName: "民法", articleNo: "430" },
]);

const o = (over: Partial<QuestionOutcome>): QuestionOutcome => ({
  id: "q", reviewed: false, kind: "answer", expected: [], cited: [], rawCited: [], mustRefer: false, referred: false, latencyMs: 100, ...over,
});

describe("eval metrics", () => {
  it("recall／precision／幻覺", () => {
    const s = scoreQuestion(
      o({
        expected: [{ lawName: "民法", articleNo: "429" }, { lawName: "民法", articleNo: "430" }],
        cited: [{ lawName: "民法", articleNo: "第 429 條" }, { lawName: "民法", articleNo: "424" }],
        rawCited: [{ lawName: "民法", articleNo: "429" }, { lawName: "民法", articleNo: "999" }],
      }),
      kb,
    );
    expect(s).toEqual({ recall: 0.5, precision: 0.5, hallucinated: 1 });
  });

  it("沒有引用時 precision 為 null", () => {
    expect(scoreQuestion(o({ expected: [{ lawName: "民法", articleNo: "424" }] }), kb).precision).toBeNull();
  });

  it("summarize 計算轉介正確率與延遲、排除錯誤題", () => {
    const s = summarize(
      [
        o({ mustRefer: true, referred: true, latencyMs: 100 }),
        o({ mustRefer: true, referred: false, latencyMs: 300 }),
        o({ latencyMs: 200 }),
        o({ error: "boom", latencyMs: 9999 }),
      ],
      kb,
    );
    expect(s.referralRecall).toBe(0.5);
    expect(s.errors).toBe(1);
    expect(s.latencyP50).toBe(200);
    expect(s.latencyP95).toBe(300);
  });

  it("percentile", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([], 50)).toBe(0);
  });
});

describe("questions.seed.jsonl", () => {
  const qs = parseJsonl(readFileSync(new URL("../../eval/questions.seed.jsonl", import.meta.url), "utf8"));

  it("格式正確", () => {
    expect(qs.length).toBeGreaterThanOrEqual(12);
  });

  it("種子題目都不會被誤判為緊急狀況", () => {
    for (const q of qs) expect(detectEmergency(q.question).emergency, q.question).toBe(false);
  });
});
