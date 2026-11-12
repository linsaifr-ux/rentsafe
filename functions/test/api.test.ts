import { describe, expect, it } from "vitest";
import { AuthError, bearerToken, verifyIdToken } from "../src/api/auth.js";
import type { ApiDeps } from "../src/api/http.js";
import { handleApi, normalizePath } from "../src/api/router.js";
import { DAY, MINUTE, memoryRateLimiter, windowStart } from "../src/rateLimit.js";
import { emptyKbIndex, memoryUserRepo, memoryViewingRepo } from "./fakes.js";

const NOW = Date.parse("2026-11-12T03:00:00Z");

function verifyFetch(status: number, body: unknown) {
  const calls: string[] = [];
  const fn = (async (_url: string, init: RequestInit) => {
    calls.push(String(init.body));
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const goodToken = {
  iss: "https://access.line.me",
  sub: "U123",
  aud: "CH1",
  exp: NOW / 1000 + 600,
  name: "小美",
};

describe("verifyIdToken", () => {
  it("合法 token 取得 sub 作為 uid，並帶 client_id 呼叫 LINE", async () => {
    const f = verifyFetch(200, goodToken);
    await expect(verifyIdToken("tok", "CH1", f.fn, () => NOW)).resolves.toEqual({ uid: "U123", name: "小美" });
    expect(f.calls[0]).toContain("id_token=tok");
    expect(f.calls[0]).toContain("client_id=CH1");
  });

  it("LINE 回錯誤、aud 不符、過期、iss 錯誤、格式錯都拒絕", async () => {
    const cases: Array<[number, unknown]> = [
      [400, { error: "invalid_request" }],
      [200, { ...goodToken, aud: "OTHER" }],
      [200, { ...goodToken, exp: NOW / 1000 - 1 }],
      [200, { ...goodToken, iss: "https://evil.example" }],
      [200, { sub: "U1" }],
    ];
    for (const [status, body] of cases) {
      await expect(verifyIdToken("tok", "CH1", verifyFetch(status, body).fn, () => NOW)).rejects.toBeInstanceOf(AuthError);
    }
  });

  it("沒有設定 channel ID 時拒絕", async () => {
    await expect(verifyIdToken("tok", "", verifyFetch(200, goodToken).fn)).rejects.toBeInstanceOf(AuthError);
  });
});

describe("bearerToken", () => {
  it("解析 Authorization header", () => {
    expect(bearerToken("Bearer abc.def")).toBe("abc.def");
    expect(bearerToken("bearer x")).toBe("x");
    expect(bearerToken("Basic x")).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});

describe("rateLimit", () => {
  it("每分鐘上限，下一個時間窗重置", async () => {
    let now = NOW;
    const rl = memoryRateLimiter(() => now);
    for (let i = 0; i < 10; i++) expect(await rl.hit("k", 10, MINUTE)).toBe(true);
    expect(await rl.hit("k", 10, MINUTE)).toBe(false);
    expect(await rl.hit("other", 10, MINUTE)).toBe(true);
    now += MINUTE;
    expect(await rl.hit("k", 10, MINUTE)).toBe(true);
  });

  it("每日時間窗以台灣時間午夜切換", () => {
    // 台灣 2026-11-12 00:00 = UTC 2026-11-11 16:00
    expect(windowStart(Date.parse("2026-11-11T16:00:00Z"), DAY)).toBe(Date.parse("2026-11-11T16:00:00Z"));
    expect(windowStart(Date.parse("2026-11-11T15:59:59Z"), DAY)).toBe(Date.parse("2026-11-10T16:00:00Z"));
  });
});

describe("handleApi", () => {
  function setup() {
    const users = memoryUserRepo();
    const deps: ApiDeps = {
      verify: async (t) => {
        if (t !== "good") throw new AuthError("bad");
        return { uid: "U1", name: "小美" };
      },
      users: users.repo,
      limiter: memoryRateLimiter(() => NOW),
      kb: emptyKbIndex,
      viewings: memoryViewingRepo().repo,
    };
    const call = (method: string, path: string, body?: unknown, token: string | null = "good") =>
      handleApi({ method, path, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, deps);
    return { users, call };
  }

  it("路徑正規化", () => {
    expect(normalizePath("/api/me")).toBe("/me");
    expect(normalizePath("/me/")).toBe("/me");
    expect(normalizePath("/api")).toBe("/");
    expect(normalizePath("/apiary")).toBe("/apiary");
  });

  it("health 不需登入", async () => {
    const { call } = setup();
    expect(await call("GET", "/api/health", undefined, null)).toEqual({ status: 200, body: { ok: true } });
  });

  it("沒帶或帶錯 token 回 401；不存在路由回 404", async () => {
    const { call } = setup();
    expect((await call("GET", "/api/me", undefined, null)).status).toBe(401);
    expect((await call("GET", "/api/me", undefined, "bad")).status).toBe(401);
    expect((await call("GET", "/api/nope")).status).toBe(404);
  });

  it("GET /me 建立使用者並回傳名稱（uid 來自 token，不信任 body）", async () => {
    const { call, users } = setup();
    const res = await call("GET", "/api/me", { userId: "HACKER" });
    expect(res).toEqual({
      status: 200,
      body: { displayName: "小美", city: null, landlordType: "unknown", consentAt: null },
    });
    expect([...users.docs.keys()]).toEqual(["U1"]);
  });

  it("POST /me/city 驗證縣市", async () => {
    const { call, users } = setup();
    expect((await call("POST", "/api/me/city", { city: "臺南市" })).status).toBe(200);
    expect(users.docs.get("U1")?.city).toBe("臺南市");
    expect((await call("POST", "/api/me/city", { city: null })).status).toBe(200);
    expect(users.docs.get("U1")?.city).toBeNull();
    expect((await call("POST", "/api/me/city", { city: "火星" })).status).toBe(400);
  });

  it("POST /me/consent 記錄同意時間", async () => {
    const { call } = setup();
    await call("POST", "/api/me/consent");
    const me = await call("GET", "/api/me");
    expect((me.body as { consentAt: string }).consentAt).toBe("2026-11-12T00:00:00.000Z");
  });

  it("每位使用者每分鐘超過 10 次回 429", async () => {
    const { call } = setup();
    for (let i = 0; i < 10; i++) expect((await call("GET", "/api/me")).status).toBe(200);
    expect((await call("GET", "/api/me")).status).toBe(429);
  });
});
