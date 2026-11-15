import type { z } from "zod";
import type { KbIndex } from "../ai/retrieve.js";
import type { RateLimiter } from "../rateLimit.js";
import type { UserRepo } from "../users.js";
import type { ViewingRepo } from "../viewing/repo.js";
import type { Llm } from "../ai/llm.js";
import type { LeaseCheckRepo } from "../lease/repo.js";
import type { AuthUser } from "./auth.js";
import type { DownloadTokenRepo, EvidenceRepo } from "../evidence/repo.js";
import type { BlobStore } from "../evidence/store.js";
import type { CaseRepo } from "../cases/repo.js";
import type { QaLog } from "../ai/qaLog.js";

export interface ApiRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface ApiResponse {
  status: number;
  body: unknown;
  /** 檔案回應（照片、PDF）；有值時不送 JSON */
  raw?: { contentType: string; data: Buffer; filename?: string };
}

export interface ApiDeps {
  verify: (idToken: string) => Promise<AuthUser>;
  users: UserRepo;
  limiter: RateLimiter;
  /** 知識庫（看房健檢查住警器規定） */
  kb: KbIndex;
  viewings: ViewingRepo;
  /** 租約健檢；沒設定時 /lease/check 回 503 */
  lease?: { llm: Llm; repo: LeaseCheckRepo };
  /** 存證廊；沒設定時回 503 */
  evidence?: { repo: EvidenceRepo; store: BlobStore; tokens: DownloadTokenRepo; now?: () => Date };
  /** 急救包與案件摘要；qa 用來讀問答紀錄（摘要的條文與時間軸） */
  cases?: { repo: CaseRepo; tokens: DownloadTokenRepo; qa?: QaLog; now?: () => Date };
  log?: (msg: string, data?: unknown) => void;
}

export interface RouteContext {
  user: AuthUser;
  body: unknown;
  deps: ApiDeps;
}

export type Handler = (ctx: RouteContext) => Promise<ApiResponse>;
/** key 格式："GET /me" */
export type Routes = Record<string, Handler>;

export const json = (status: number, body: unknown): ApiResponse => ({ status, body });

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/** 用 zod 驗證 body，失敗丟 400 */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, "invalid_body");
  return r.data;
}
