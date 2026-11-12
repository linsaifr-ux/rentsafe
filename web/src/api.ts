import { getIdToken, relogin } from "./liff.ts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export interface Me {
  displayName: string;
  city: string | null;
  landlordType: "individual" | "business" | "unknown";
  consentAt: string | null;
}

type TokenGetter = () => string | null;

/** 呼叫後端，一律帶 Authorization: Bearer <LIFF ID token> */
export async function apiFetch<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
  deps: { getToken?: TokenGetter; fetchImpl?: typeof fetch; onUnauthorized?: () => void } = {},
): Promise<T> {
  const token = (deps.getToken ?? getIdToken)();
  if (!token) throw new ApiError(401, "no_token");
  const res = await (deps.fetchImpl ?? fetch)(`/api${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401) (deps.onUnauthorized ?? relogin)();
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, data.error ?? "unknown");
  }
  return (await res.json()) as T;
}

export const api = {
  me: () => apiFetch<Me>("/me"),
  setCity: (city: string | null) => apiFetch<{ city: string | null }>("/me/city", { method: "POST", body: { city } }),
  consent: () => apiFetch<{ ok: true }>("/me/consent", { method: "POST" }),
};

/** 給使用者看的錯誤訊息 */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "登入逾時，正在重新登入…";
    if (err.status === 429) return "操作太頻繁了，請等一分鐘再試。";
  }
  return "系統暫時出了點問題，請稍後再試。";
}
