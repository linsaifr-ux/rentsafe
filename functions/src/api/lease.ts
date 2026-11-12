import { z } from "zod";
import { LEASE, RATE_LIMITS } from "../config.js";
import { checkLease, LEASE_PROMPT_VERSION } from "../lease/check.js";
import { loadRuleset } from "../lease/ruleset.js";
import { DAY } from "../rateLimit.js";
import { HttpError, json, parseBody, type Routes } from "./http.js";

const fileSchema = z.object({
  mimeType: z.enum(LEASE.mimeTypes),
  /** base64，不含 data: 前綴 */
  data: z.string().regex(/^[A-Za-z0-9+/]+=*$/),
});

const bodySchema = z.object({ files: z.array(fileSchema).min(1).max(LEASE.maxFiles) });

/** base64 解碼後的位元組數 */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/** F2 租約健檢（SPEC 8）：原圖只在這次請求的記憶體裡，不落地 */
export const leaseRoutes: Routes = {
  "POST /lease/check": async ({ user, body, deps }) => {
    if (!deps.lease) throw new HttpError(503, "lease_unavailable");
    const { files } = parseBody(bodySchema, body);
    const total = files.reduce((n, f) => n + base64Bytes(f.data), 0);
    if (total > LEASE.maxTotalBytes) throw new HttpError(413, "files_too_large");
    if (files.some((f) => f.mimeType === "application/pdf") && files.length > 1) throw new HttpError(400, "one_pdf_only");
    if (!(await deps.limiter.hit(`lease/${user.uid}`, RATE_LIMITS.leaseCheckPerUserPerDay, DAY))) {
      throw new HttpError(429, "rate_limited");
    }

    const started = Date.now();
    let result;
    try {
      result = await checkLease(files, loadRuleset(), { llm: deps.lease.llm });
    } catch (err) {
      deps.log?.("lease check failed", { err: String(err) });
      throw new HttpError(502, "analysis_failed");
    }
    if (result.status === "not_lease") return json(200, result);

    await deps.users.ensure(user.uid, { displayName: user.name });
    const id = await deps.lease.repo.add(user.uid, {
      fields: result.fields,
      findings: result.findings,
      promptVersion: LEASE_PROMPT_VERSION,
      latencyMs: Date.now() - started,
    });
    return json(200, { id, ...result });
  },
};
