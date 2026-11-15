import { RATE_LIMITS } from "../config.js";
import { MINUTE } from "../rateLimit.js";
import { AuthError, bearerToken, type AuthUser } from "./auth.js";
import { HttpError, json, type ApiDeps, type ApiRequest, type ApiResponse, type Routes } from "./http.js";
import { meRoutes } from "./me.js";
import { viewingRoutes } from "./viewing.js";
import { leaseRoutes } from "./lease.js";
import { evidenceRoutes, handleEvidenceDownload } from "./evidence.js";

const routes: Routes = { ...meRoutes, ...viewingRoutes, ...leaseRoutes, ...evidenceRoutes };

/** 正規化路徑：Hosting rewrite 傳進來是 /api/xxx，直接打 function 是 /xxx */
export function normalizePath(path: string): string {
  const p = path.replace(/^\/api(?=\/|$)/, "") || "/";
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

export async function handleApi(req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const path = normalizePath(req.path);
  if (req.method === "GET" && path === "/health") return json(200, { ok: true });
  // 證據清單 PDF 下載連結：在外部瀏覽器開啟，用連結裡的 token 驗證
  const download = await handleEvidenceDownload(req.method, path, deps);
  if (download) return download;

  const handler = routes[`${req.method} ${path}`];
  if (!handler) return json(404, { error: "not_found" });

  const token = bearerToken(req.headers["authorization"]);
  if (!token) return json(401, { error: "unauthorized" });
  let user: AuthUser;
  try {
    user = await deps.verify(token);
  } catch (err) {
    if (err instanceof AuthError) return json(401, { error: "unauthorized" });
    throw err;
  }

  // 時間軸一次會讀很多張縮圖，讀檔另外限流
  const isFile = path === "/evidence/file";
  const [bucket, limit] = isFile ? ["apiFile", RATE_LIMITS.filePerUserPerMinute] : ["api", RATE_LIMITS.perUserPerMinute];
  if (!(await deps.limiter.hit(`${bucket}/${user.uid}`, limit, MINUTE))) {
    return json(429, { error: "rate_limited" });
  }

  try {
    return await handler({ user, body: req.body, deps });
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.code });
    throw err;
  }
}
