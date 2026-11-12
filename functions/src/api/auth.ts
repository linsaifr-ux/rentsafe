import { z } from "zod";

const VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";

const verifyResponse = z.object({
  iss: z.string(),
  sub: z.string(),
  aud: z.string(),
  exp: z.number(),
  name: z.string().optional(),
  picture: z.string().optional(),
});

export interface AuthUser {
  uid: string;
  name: string;
}

export class AuthError extends Error {}

/** 從 Authorization: Bearer <token> 取出 token */
export function bearerToken(header: string | string[] | undefined): string | null {
  const h = Array.isArray(header) ? header[0] : header;
  const m = h?.match(/^Bearer\s+(\S+)$/i);
  return m?.[1] ?? null;
}

/**
 * 呼叫 LINE 的 verify endpoint 驗證 LIFF ID token，取得 sub 作為 uid。
 * 不相信前端傳來的任何 userId（SPEC 4.2）。
 */
export async function verifyIdToken(
  idToken: string,
  channelId: string,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<AuthUser> {
  if (!channelId) throw new AuthError("LINE_LOGIN_CHANNEL_ID 未設定");
  const res = await fetchImpl(VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }).toString(),
  });
  if (!res.ok) throw new AuthError(`verify failed: ${res.status}`);
  const parsed = verifyResponse.safeParse(await res.json());
  if (!parsed.success) throw new AuthError("verify response invalid");
  const t = parsed.data;
  if (t.iss !== "https://access.line.me") throw new AuthError("bad iss");
  if (t.aud !== channelId) throw new AuthError("bad aud");
  if (t.exp * 1000 <= now()) throw new AuthError("expired");
  return { uid: t.sub, name: t.name ?? "" };
}
