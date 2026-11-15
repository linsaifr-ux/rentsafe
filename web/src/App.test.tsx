import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import App from "./App.tsx";
import { ApiError, apiFetch, errorMessage, type Me } from "./api.ts";
import { DISCLAIMER_TEXT } from "./components/Disclaimer.tsx";
import { resolvePath } from "./router.tsx";

afterEach(cleanup);

const me: Me = { displayName: "小美", city: "新北市", landlordType: "unknown", consentAt: null };

describe("App", () => {
  it("載入後顯示使用者名稱、縣市與免責聲明", async () => {
    render(<App load={async () => me} path="/" />);
    expect(await screen.findByText("你好，小美！")).toBeTruthy();
    expect(screen.getByText("租屋縣市：新北市")).toBeTruthy();
    expect(screen.getByText(DISCLAIMER_TEXT)).toBeTruthy();
  });

  it("載入失敗顯示錯誤訊息", async () => {
    render(<App load={async () => Promise.reject(new ApiError(429, "rate_limited"))} path="/" />);
    expect(await screen.findByText("操作太頻繁了，請等一分鐘再試。")).toBeTruthy();
  });

  it("每日上限用完顯示明天再試，與每分鐘限流區分", () => {
    expect(errorMessage(new ApiError(429, "daily_limit"))).toBe("今天的使用次數已經用完了，明天再試。");
    expect(errorMessage(new ApiError(429, "rate_limited"))).toBe("操作太頻繁了，請等一分鐘再試。");
  });

  it("設定頁顯示目前縣市", async () => {
    render(<App load={async () => me} path="/settings" />);
    const select = (await screen.findByLabelText("租屋縣市")) as HTMLSelectElement;
    expect(select.value).toBe("新北市");
  });
});

describe("resolvePath", () => {
  it("處理一般路徑、liff.state 與未知路徑", () => {
    expect(resolvePath("/viewing")).toBe("/viewing");
    expect(resolvePath("/viewing/")).toBe("/viewing");
    expect(resolvePath("/", "?liff.state=%2Fsettings%3Fa%3D1")).toBe("/settings");
    expect(resolvePath("/nope")).toBe("/");
  });
});

describe("apiFetch", () => {
  it("帶 Bearer token；401 時觸發重新登入", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));
    const onUnauthorized = vi.fn();
    await expect(
      apiFetch("/me", {}, { getToken: () => "tok", fetchImpl: fetchImpl as unknown as typeof fetch, onUnauthorized }),
    ).rejects.toBeInstanceOf(ApiError);
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("沒有 token 時不送出請求", async () => {
    const fetchImpl = vi.fn();
    await expect(
      apiFetch("/me", {}, { getToken: () => null, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
