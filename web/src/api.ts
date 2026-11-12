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

/** F1 看房健檢（對應 functions/src/api/viewing.ts） */
export type ViewingAnswer = "yes" | "no" | "unknown";

export interface ViewingChecklist {
  housingTypes: Array<{ id: string; label: string; presetAnswers: Record<string, "yes" | "no">; warning: string | null }>;
  items: Array<{ id: string; question: string; why: string; weight: number }>;
}

export interface CitationLink {
  lawName: string;
  articleNo: string;
  url: string | null;
}

export interface FireRuleArticle {
  lawName: string;
  articleNo: string;
  text: string;
  sourceUrl: string;
}

export interface ViewingResult {
  id: string;
  label: string;
  city: string | null;
  housingType: string;
  createdAt: string | null;
  answers: Record<string, ViewingAnswer>;
  score: number;
  redFlags: Array<{ id: string; question: string; why: string; weight: number; citations: CitationLink[] }>;
  unknown: string[];
  questions: string[];
  warning: string | null;
  fireRule: { city: string | null; national: FireRuleArticle | null; local: FireRuleArticle[]; note: string | null };
}

export interface ViewingSummary {
  id: string;
  label: string;
  city: string | null;
  housingType: string;
  score: number;
  redFlagCount: number;
  createdAt: string | null;
}

/** F2 租約健檢（對應 functions/src/lease/check.ts） */
export interface LeaseFile {
  mimeType: string;
  /** base64，不含 data: 前綴 */
  data: string;
}

export interface LeaseBasis {
  kind: "standard" | "law";
  label: string;
  quote: string | null;
  url: string | null;
}

export interface LeaseFinding {
  ruleId: string;
  level: "red" | "yellow";
  title: string;
  explanation: string;
  detail: string | null;
  quotes: string[];
  negotiate: string;
  basis: LeaseBasis[];
}

export type LeaseResult =
  | { status: "not_lease"; readability: "good" | "partial" | "poor" }
  | {
      status: "ok";
      id: string;
      readability: "good" | "partial" | "poor";
      fields: {
        monthlyRent: number | null;
        deposit: number | null;
        leaseStart: string | null;
        leaseEnd: string | null;
        electricityRule: string | null;
      };
      findings: LeaseFinding[];
      passed: Array<{ ruleId: string; title: string }>;
    };

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
  viewingChecklist: () => apiFetch<ViewingChecklist>("/viewing/checklist"),
  submitViewing: (body: { label?: string; city: string | null; housingType: string; answers: Record<string, ViewingAnswer> }) =>
    apiFetch<ViewingResult>("/viewing", { method: "POST", body }),
  leaseCheck: (files: LeaseFile[]) => apiFetch<LeaseResult>("/lease/check", { method: "POST", body: { files } }),
  viewingHistory: () => apiFetch<{ viewings: ViewingSummary[] }>("/viewing/history"),
  deleteViewing: (id: string) => apiFetch<{ ok: true }>("/viewing/delete", { method: "POST", body: { id } }),
  viewingDetail: (ids: string[]) => apiFetch<{ viewings: ViewingResult[] }>("/viewing/detail", { method: "POST", body: { ids } }),
};

/** 給使用者看的錯誤訊息 */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "登入逾時，正在重新登入…";
    if (err.status === 429) return "操作太頻繁了，請等一分鐘再試。";
    if (err.status === 404) return "找不到這筆紀錄。";
    if (err.status === 413) return "檔案太大了，請少選幾張或改用照片。";
    if (err.status === 502) return "分析失敗了，請確認照片清楚後再試一次。";
  }
  return "系統暫時出了點問題，請稍後再試。";
}
