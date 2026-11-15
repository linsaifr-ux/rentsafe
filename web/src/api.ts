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
  /** 從看房紀錄讀取時才有：這間最新的租約健檢 */
  lease?: LeaseSummary | null;
}

/** 一間租屋處最新的租約健檢摘要 */
export interface LeaseSummary {
  id: string;
  red: number;
  yellow: number;
  monthlyRent: number | null;
  deposit: number | null;
  depositMonths: number | null;
  createdAt: string | null;
}

export interface ViewingSummary {
  id: string;
  label: string;
  city: string | null;
  housingType: string;
  score: number;
  redFlagCount: number;
  createdAt: string | null;
  lease: LeaseSummary | null;
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
      /** 屬於哪一間看房紀錄；null＝只有租約 */
      viewingId: string | null;
      label: string;
      createdAt: string | null;
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

/** F3 存證廊（對應 functions/src/api/evidence.ts） */
export type EvidenceCategory = "repair" | "rent" | "dispute" | "safety" | "other";
export type EvidenceType = "photo" | "video" | "audio" | "document" | "note";

export interface EvidenceItem {
  id: string;
  type: EvidenceType;
  category: EvidenceCategory;
  text: string;
  fileName: string | null;
  mimeType: string | null;
  bytes: number;
  hasFile: boolean;
  hasThumb: boolean;
  sha256: string;
  source: "line" | "liff";
  /** 事件發生時間（可改） */
  occurredAt: string;
  /** 系統收到時間（不可改） */
  createdAt: string;
}

export interface EvidenceUpload {
  mimeType: string;
  data: string;
  thumb?: string;
  fileName?: string;
  text?: string;
  category?: EvidenceCategory;
  occurredAt?: string;
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

/** 讀檔案（照片、影片、PDF）回傳 Blob */
export async function apiBlob(path: string, body: unknown, deps: { getToken?: TokenGetter; fetchImpl?: typeof fetch } = {}): Promise<Blob> {
  const token = (deps.getToken ?? getIdToken)();
  if (!token) throw new ApiError(401, "no_token");
  const res = await (deps.fetchImpl ?? fetch)(`/api${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, "file_error");
  return res.blob();
}

export const api = {
  me: () => apiFetch<Me>("/me"),
  setCity: (city: string | null) => apiFetch<{ city: string | null }>("/me/city", { method: "POST", body: { city } }),
  consent: () => apiFetch<{ ok: true }>("/me/consent", { method: "POST" }),
  viewingChecklist: () => apiFetch<ViewingChecklist>("/viewing/checklist"),
  submitViewing: (body: { label?: string; city: string | null; housingType: string; answers: Record<string, ViewingAnswer> }) =>
    apiFetch<ViewingResult>("/viewing", { method: "POST", body }),
  leaseCheck: (files: LeaseFile[], opts: { viewingId?: string | null; label?: string } = {}) =>
    apiFetch<LeaseResult>("/lease/check", { method: "POST", body: { files, ...opts } }),
  leaseDetail: (id: string) => apiFetch<LeaseResult>("/lease/detail", { method: "POST", body: { id } }),
  deleteLease: (id: string) => apiFetch<{ ok: true }>("/lease/delete", { method: "POST", body: { id } }),
  viewingHistory: () =>
    apiFetch<{ viewings: ViewingSummary[]; leaseOnly: Array<LeaseSummary & { label: string }> }>("/viewing/history"),
  deleteViewing: (id: string) => apiFetch<{ ok: true }>("/viewing/delete", { method: "POST", body: { id } }),
  viewingDetail: (ids: string[]) => apiFetch<{ viewings: ViewingResult[] }>("/viewing/detail", { method: "POST", body: { ids } }),
  evidenceList: () => apiFetch<{ items: EvidenceItem[] }>("/evidence/list", { method: "POST", body: {} }),
  evidenceUpload: (body: EvidenceUpload) => apiFetch<{ item: EvidenceItem }>("/evidence/upload", { method: "POST", body }),
  evidenceNote: (body: { text: string; category?: EvidenceCategory; occurredAt?: string }) =>
    apiFetch<{ item: EvidenceItem }>("/evidence/note", { method: "POST", body }),
  evidenceUpdate: (body: { id: string; text?: string; category?: EvidenceCategory; occurredAt?: string }) =>
    apiFetch<{ item: EvidenceItem }>("/evidence/update", { method: "POST", body }),
  evidenceDelete: (id: string) => apiFetch<{ ok: true }>("/evidence/delete", { method: "POST", body: { id } }),
  evidenceFile: (id: string, thumb = false) => apiBlob("/evidence/file", { id, thumb }),
  evidenceExport: (category: EvidenceCategory | null) =>
    apiFetch<{ url: string; count: number; truncated: boolean }>("/evidence/export", { method: "POST", body: { category } }),
};

/* ───────────── 急救包與案件摘要（SPEC 10、11） ───────────── */

export type CaseScenario = "fire" | "no_repair" | "leak" | "deposit" | "early_termination";
export type CaseStage = "now" | "today" | "week" | "next";
export type LandlordType = "individual" | "business" | "unknown";

export interface FlowItem {
  id: string;
  text: string;
  link?: string;
  key?: boolean;
  sources?: Array<{ label: string; url: string }>;
}

export interface Flow {
  id: CaseScenario;
  label: string;
  intro: string;
  wants: string[];
  stages: Record<CaseStage, { ask: string; items: FlowItem[] }>;
}

export interface CaseAnswers {
  occurredOn: string | null;
  city: string | null;
  landlordType: LandlordType;
  story: string;
  wants: string[];
}

export interface CaseBrief {
  id: string;
  scenario: CaseScenario;
  label: string;
  done: number;
  total: number;
  hasSummary: boolean;
  updatedAt: string;
}

export interface CaseFull extends CaseBrief {
  answers: CaseAnswers;
  checklistDone: string[];
  evidenceIds: string[];
  createdAt: string;
}

export interface CaseArticle {
  lawName: string;
  articleNo: string;
  text: string;
  sourceUrl: string;
  scope: string;
}

export interface CaseReferral {
  id: string;
  name: string;
  contact: string;
  hours: string | null;
  note: string;
  url: string | null;
}

export interface CaseDetail {
  case: CaseFull;
  articles: CaseArticle[];
  fireRule: ViewingResult["fireRule"] | null;
  referrals: CaseReferral[];
}

export interface CaseSummaryData {
  generatedAt: string;
  scenario: CaseScenario;
  scenarioLabel: string;
  facts: { occurredOn: string | null; city: string | null; landlord: string; story: string };
  timeline: Array<{ at: string; text: string }>;
  evidence: Array<{ id: string; occurredAt: string; type: string; category: string; text: string; sha256: string }>;
  articles: CaseArticle[];
  wants: string[];
  missing: string[];
  referrals: Array<{ name: string; contact: string; hours: string | null; note: string }>;
  disclaimer: string;
}

export const caseApi = {
  flows: () => apiFetch<{ stages: Array<{ id: CaseStage; label: string }>; flows: Flow[] }>("/cases/flows"),
  list: () => apiFetch<{ cases: CaseBrief[] }>("/cases/list", { method: "POST", body: {} }),
  open: (scenario: CaseScenario) => apiFetch<{ case: CaseFull }>("/cases/open", { method: "POST", body: { scenario } }),
  get: (id: string) => apiFetch<CaseDetail>("/cases/get", { method: "POST", body: { id } }),
  update: (body: { id: string; answers?: CaseAnswers; checklistDone?: string[]; evidenceIds?: string[] }) =>
    apiFetch<{ case: CaseFull }>("/cases/update", { method: "POST", body }),
  remove: (id: string) => apiFetch<{ ok: true }>("/cases/delete", { method: "POST", body: { id } }),
  summary: (id: string) => apiFetch<{ summary: CaseSummaryData; text: string }>("/cases/summary", { method: "POST", body: { id } }),
  exportPdf: (id: string) => apiFetch<{ url: string }>("/cases/export", { method: "POST", body: { id } }),
  evidenceList: () => api.evidenceList(),
};
export type CaseClient = typeof caseApi;

/** 給使用者看的錯誤訊息 */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "登入逾時，正在重新登入…";
    if (err.status === 429 && err.code === "daily_limit") return "今天的使用次數已經用完了，明天再試。";
    if (err.status === 429) return "操作太頻繁了，請等一分鐘再試。";
    if (err.status === 404) return "找不到這筆紀錄。";
    if (err.status === 409 && err.code === "too_many_cases") return "案件太多了，請先刪掉不需要的案件。";
    if (err.status === 413) return "檔案太大了，請少選幾張或改用照片。";
    if (err.status === 502) return "分析失敗了，請確認照片清楚後再試一次。";
  }
  return "系統暫時出了點問題，請稍後再試。";
}
