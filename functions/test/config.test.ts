import { describe, expect, it } from "vitest";
import { DISCLAIMER, MODELS, RATE_LIMITS, REGION, RETRIEVAL } from "../src/config.js";

describe("config", () => {
  it("部署在 asia-east1", () => {
    expect(REGION).toBe("asia-east1");
  });

  it("模型名稱都有設定", () => {
    for (const name of Object.values(MODELS)) {
      expect(name).toMatch(/^gemini-/);
    }
  });

  it("限流數字符合 SPEC 4.2", () => {
    expect(RATE_LIMITS).toEqual({
      perUserPerMinute: 30,
      filePerUserPerMinute: 120,
      qaPerUserPerDay: 50,
      leaseCheckPerUserPerDay: 10,
      pushPerUserPerDay: 3,
      evidencePerUserPerDay: 200,
      evidenceExportPerUserPerDay: 20,
      qaGlobalPerDay: 1000,
    });
  });

  it("檢索取前 8 筆", () => {
    expect(RETRIEVAL.topK).toBe(8);
  });

  it("免責聲明與 SPEC 12 一致", () => {
    expect(DISCLAIMER).toBe("本服務提供法律資訊，不是法律意見；個案請洽法扶專線或律師。");
  });
});

