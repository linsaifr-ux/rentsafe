import { z } from "zod";
import { LEASE, RATE_LIMITS, VIEWING } from "../config.js";
import { checkLease, LEASE_PROMPT_VERSION } from "../lease/check.js";
import { loadRuleset } from "../lease/ruleset.js";
import { DAY } from "../rateLimit.js";
import type { StoredLeaseCheck } from "../lease/repo.js";
import { HttpError, json, parseBody, type ApiDeps, type Routes } from "./http.js";
import { taiwanMonthDay } from "./viewing.js";

const fileSchema = z.object({
  mimeType: z.enum(LEASE.mimeTypes),
  /** base64，不含 data: 前綴 */
  data: z.string().regex(/^[A-Za-z0-9+/]+=*$/),
});

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const bodySchema = z.object({
  files: z.array(fileSchema).min(1).max(LEASE.maxFiles),
  /** 屬於哪一間看房紀錄（租屋處）；不填＝只有租約 */
  viewingId: idSchema.nullable().optional(),
  /** 沒有對應看房紀錄時的名稱 */
  label: z.string().trim().max(VIEWING.labelMaxLength).optional(),
});

const idBody = z.object({ id: idSchema });

function leaseRepo(deps: ApiDeps) {
  if (!deps.lease) throw new HttpError(503, "lease_unavailable");
  return deps.lease.repo;
}

/** 存檔紀錄轉成前端結果格式（與剛健檢完的回應相同） */
export function storedView(l: StoredLeaseCheck) {
  return {
    status: "ok" as const,
    id: l.id,
    viewingId: l.viewingId,
    label: l.label,
    createdAt: l.createdAt,
    readability: l.readability,
    fields: l.fields,
    findings: l.findings,
    passed: l.passed,
  };
}

/** base64 解碼後的位元組數 */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/** F2 租約健檢（SPEC 8）：原圖只在這次請求的記憶體裡，不落地 */
export const leaseRoutes: Routes = {
  "POST /lease/check": async ({ user, body, deps }) => {
    if (!deps.lease) throw new HttpError(503, "lease_unavailable");
    const input = parseBody(bodySchema, body);
    const { files } = input;
    const total = files.reduce((n, f) => n + base64Bytes(f.data), 0);
    if (total > LEASE.maxTotalBytes) throw new HttpError(413, "files_too_large");
    if (files.some((f) => f.mimeType === "application/pdf") && files.length > 1) throw new HttpError(400, "one_pdf_only");
    // 指定的看房紀錄必須是自己的
    let label = input.label || `租約健檢 ${taiwanMonthDay(new Date())}`;
    const viewingId = input.viewingId ?? null;
    if (viewingId) {
      const [v] = await deps.viewings.getMany(user.uid, [viewingId]);
      if (!v) throw new HttpError(404, "viewing_not_found");
      label = v.label;
    }
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
    const rec = {
      viewingId,
      label,
      readability: result.readability,
      fields: result.fields,
      findings: result.findings,
      passed: result.passed,
      promptVersion: LEASE_PROMPT_VERSION,
      latencyMs: Date.now() - started,
    };
    const id = await deps.lease.repo.add(user.uid, rec);
    return json(200, storedView({ ...rec, id, createdAt: new Date().toISOString() }));
  },

  /** 讀取一筆租約健檢結果（只能讀自己的） */
  "POST /lease/detail": async ({ user, body, deps }) => {
    const { id } = parseBody(idBody, body);
    const l = await leaseRepo(deps).get(user.uid, id);
    if (!l) throw new HttpError(404, "not_found");
    return json(200, storedView(l));
  },

  /** 永久刪除一筆租約健檢（只能刪自己的） */
  "POST /lease/delete": async ({ user, body, deps }) => {
    const { id } = parseBody(idBody, body);
    if (!(await leaseRepo(deps).delete(user.uid, id))) throw new HttpError(404, "not_found");
    return json(200, { ok: true });
  },
};
