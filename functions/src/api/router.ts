import { RATE_LIMITS } from "../config.js";
import { MINUTE } from "../rateLimit.js";
import { AuthError, bearerToken, type AuthUser } from "./auth.js";
import { HttpError, json, type ApiDeps, type ApiRequest, type ApiResponse, type Routes } from "./http.js";
import { meRoutes } from "./me.js";
import { viewingRoutes } from "./viewing.js";
import { leaseRoutes } from "./lease.js";

const routes: Routes = { ...meRoutes, ...viewingRoutes, ...leaseRoutes };

/** 正規化路徑：Hosting rewrite 傳進來是 /api/xxx，直接打 function 是 /xxx */
export function normalizePath(path: string): string {
  const p = path.replace(/^\/api(?=\/|$)/, "") || "/";
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

export async function handleApi(req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const path = normalizePath(req.path);
  if (req.method === "GET" && path === "/health") return json(200, { ok: true });

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

  if (!(await deps.limiter.hit(`api/${user.uid}`, RATE_LIMITS.perUserPerMinute, MINUTE))) {
    return json(429, { error: "rate_limited" });
  }

  try {
    return await handler({ user, body: req.body, deps });
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.code });
    throw err;
  }
}
