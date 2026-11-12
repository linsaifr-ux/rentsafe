import { describe, expect, it, vi } from "vitest";
import { isRateLimitError, retryDelayMs, withRateLimitRetry } from "../src/ai/embed.js";

const rateErr = (delay = "52s") =>
  Object.assign(new Error(`{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[{"retryDelay":"${delay}"}]}}`), { status: 429 });

describe("withRateLimitRetry", () => {
  it("辨識 429 錯誤", () => {
    expect(isRateLimitError(rateErr())).toBe(true);
    expect(isRateLimitError(new Error("RESOURCE_EXHAUSTED"))).toBe(true);
    expect(isRateLimitError(new Error("400 bad request"))).toBe(false);
  });

  it("取出建議等待時間", () => {
    expect(retryDelayMs(rateErr("52s"))).toBe(52_000);
    expect(retryDelayMs(new Error("Please retry in 1.5s."))).toBe(1500);
    expect(retryDelayMs(new Error("other"))).toBeNull();
  });

  it("429 後依建議時間等待再重試", async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn().mockRejectedValueOnce(rateErr("10s")).mockResolvedValueOnce("ok");
    await expect(withRateLimitRetry(fn, { sleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(11_000);
  });

  it("非 429 錯誤不重試", async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn().mockRejectedValue(new Error("400"));
    await expect(withRateLimitRetry(fn, { sleep })).rejects.toThrow("400");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("超過重試次數就拋出", async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn().mockRejectedValue(rateErr());
    await expect(withRateLimitRetry(fn, { sleep, retries: 2 })).rejects.toThrow("429");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
