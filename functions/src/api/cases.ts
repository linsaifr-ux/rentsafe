import { z } from "zod";
import { ALL_CITIES } from "../cities.js";
import { CASES, RATE_LIMITS } from "../config.js";
import { DAY } from "../rateLimit.js";
import { maskPii } from "../lease/pii.js";
import { fireAlarmRule } from "../viewing/fireRule.js";
import type { StoredEvidence } from "../evidence/model.js";
import { allSteps, CASE_SCENARIOS, getFlow, loadFlows, STAGES, STAGE_LABEL } from "../cases/flows.js";
import { buildCasePdf } from "../cases/pdf.js";
import type { CaseAnswers, StoredCase } from "../cases/repo.js";
import { buildCaseSummary, caseArticles, caseReferrals, summaryText } from "../cases/summary.js";
import { HttpError, json, parseBody, type ApiDeps, type ApiResponse, type Routes } from "./http.js";

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const answersSchema = z.object({
  occurredOn: dateSchema.nullable(),
  city: z.enum(ALL_CITIES).nullable(),
  landlordType: z.enum(["individual", "business", "unknown"]),
  story: z.string().max(CASES.storyMaxLength),
  wants: z.array(z.string().max(40)).max(10),
});

const updateSchema = z.object({
  id: idSchema,
  answers: answersSchema.optional(),
  checklistDone: z.array(z.string().max(64)).max(60).optional(),
  evidenceIds: z.array(idSchema).max(CASES.evidenceMax).optional(),
});

function casesDeps(deps: ApiDeps) {
  if (!deps.cases) throw new HttpError(503, "cases_unavailable");
  return deps.cases;
}

const nowOf = (deps: ApiDeps) => deps.cases?.now?.() ?? new Date();

/** 給前端的案件內容（不含 summary 的大物件時用 brief） */
function brief(c: StoredCase) {
  const flow = getFlow(c.scenario);
  const keys = new Set(allSteps(flow).map((s) => s.key));
  return {
    id: c.id,
    scenario: c.scenario,
    label: flow.label,
    done: c.checklistDone.filter((k) => keys.has(k)).length,
    total: keys.size,
    hasSummary: Boolean(c.summary),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function full(c: StoredCase) {
  return {
    ...brief(c),
    answers: c.answers,
    checklistDone: c.checklistDone,
    evidenceIds: c.evidenceIds,
    createdAt: c.createdAt.toISOString(),
  };
}

async function loadCase(deps: ApiDeps, uid: string, id: string): Promise<StoredCase> {
  const c = await casesDeps(deps).repo.get(uid, id);
  if (!c) throw new HttpError(404, "not_found");
  return c;
}

async function caseEvidence(deps: ApiDeps, uid: string, ids: string[]): Promise<StoredEvidence[]> {
  if (!deps.evidence || ids.length === 0) return [];
  const items = await Promise.all(ids.map((id) => deps.evidence!.repo.get(uid, id)));
  return items.filter((x): x is StoredEvidence => Boolean(x));
}

async function makeSummary(deps: ApiDeps, uid: string, c: StoredCase) {
  const cs = casesDeps(deps);
  const qa = (await cs.qa?.recent?.(uid, 50).catch(() => [])) ?? [];
  const evidence = await caseEvidence(deps, uid, c.evidenceIds);
  const articles = await caseArticles(deps.kb, c.scenario, c.answers.city, qa);
  return buildCaseSummary({ c, flow: getFlow(c.scenario), evidence, qa, articles, now: nowOf(deps) });
}

/** F4 情境急救包＋F6 案件摘要（SPEC 10、11）：純規則，不呼叫模型 */
export const caseRoutes: Routes = {
  /** 五個情境的流程 */
  "GET /cases/flows": async () =>
    json(200, {
      stages: STAGES.map((id) => ({ id, label: STAGE_LABEL[id] })),
      flows: loadFlows().map((f) => ({ id: f.id, label: f.label, intro: f.intro, wants: f.wants, stages: f.stages })),
    }),

  "POST /cases/list": async ({ user, deps }) => {
    const cases = await casesDeps(deps).repo.list(user.uid, CASES.maxPerUser);
    return json(200, { cases: cases.map(brief) });
  },

  /** 開一個新案件；縣市與房東類型先帶入使用者設定 */
  "POST /cases/open": async ({ user, body, deps }) => {
    const cs = casesDeps(deps);
    const { scenario } = parseBody(z.object({ scenario: z.enum(CASE_SCENARIOS) }), body);
    if ((await cs.repo.list(user.uid, CASES.maxPerUser)).length >= CASES.maxPerUser) throw new HttpError(409, "too_many_cases");
    const me = await deps.users.ensure(user.uid, { displayName: user.name });
    const answers: CaseAnswers = { occurredOn: null, city: me.city, landlordType: me.landlordType, story: "", wants: [] };
    const c = await cs.repo.add(user.uid, { scenario, answers, checklistDone: [], doneAt: {}, evidenceIds: [], summary: null }, nowOf(deps));
    return json(200, { case: full(c) });
  },

  /** 案件內容＋相關條文（官方原文）＋火災的當地住警器規定＋轉介 */
  "POST /cases/get": async ({ user, body, deps }) => {
    const { id } = parseBody(z.object({ id: idSchema }), body);
    const c = await loadCase(deps, user.uid, id);
    const flow = getFlow(c.scenario);
    const articles = await caseArticles(deps.kb, c.scenario, null);
    const fireRule = c.scenario === "fire" ? await fireAlarmRule(deps.kb, c.answers.city) : null;
    const referrals = caseReferrals(flow, c.answers.landlordType).map((r) => ({ id: r.id, name: r.name, contact: r.contact, hours: r.hours, note: r.note, url: r.url }));
    return json(200, { case: full(c), articles, fireRule, referrals });
  },

  "POST /cases/update": async ({ user, body, deps }) => {
    const cs = casesDeps(deps);
    const input = parseBody(updateSchema, body);
    const c = await loadCase(deps, user.uid, input.id);
    const now = nowOf(deps);
    const patch: Parameters<typeof cs.repo.update>[2] = {};
    if (input.answers) {
      patch.answers = {
        ...input.answers,
        story: maskPii(input.answers.story.trim()),
        wants: [...new Set(input.answers.wants.map((w) => maskPii(w.trim())).filter(Boolean))],
      };
    }
    if (input.checklistDone) {
      const valid = new Set(allSteps(getFlow(c.scenario)).map((s) => s.key));
      const next = [...new Set(input.checklistDone.filter((k) => valid.has(k)))];
      const doneAt: Record<string, string> = {};
      for (const k of next) doneAt[k] = c.doneAt[k] ?? now.toISOString();
      patch.checklistDone = next;
      patch.doneAt = doneAt;
    }
    if (input.evidenceIds) {
      const found = await caseEvidence(deps, user.uid, [...new Set(input.evidenceIds)]);
      patch.evidenceIds = found.map((e) => e.id);
    }
    const updated = await cs.repo.update(user.uid, input.id, patch, now);
    if (!updated) throw new HttpError(404, "not_found");
    return json(200, { case: full(updated) });
  },

  "POST /cases/delete": async ({ user, body, deps }) => {
    const { id } = parseBody(z.object({ id: idSchema }), body);
    if (!(await casesDeps(deps).repo.delete(user.uid, id))) throw new HttpError(404, "not_found");
    return json(200, { ok: true });
  },

  /** 產生（或重新產生）一頁摘要，存回案件 */
  "POST /cases/summary": async ({ user, body, deps }) => {
    const { id } = parseBody(z.object({ id: idSchema }), body);
    const c = await loadCase(deps, user.uid, id);
    const summary = await makeSummary(deps, user.uid, c);
    await casesDeps(deps).repo.update(user.uid, id, { summary }, nowOf(deps));
    return json(200, { summary, text: summaryText(summary) });
  },

  /** 摘要 PDF 的 10 分鐘下載連結（PDF 在下載時才產生，用最新資料） */
  "POST /cases/export": async ({ user, body, deps }) => {
    const cs = casesDeps(deps);
    const { id } = parseBody(z.object({ id: idSchema }), body);
    await loadCase(deps, user.uid, id);
    if (!(await deps.limiter.hit(`caseExport/${user.uid}`, RATE_LIMITS.caseExportPerUserPerDay, DAY))) throw new HttpError(429, "daily_limit");
    const token = await cs.tokens.create({ uid: user.uid, ids: [id], expiresAt: new Date(nowOf(deps).getTime() + CASES.downloadTtlMs) });
    return json(200, { url: `/api/cases/download/${token}` });
  },
};

const TOKEN_RE = /^\/cases\/download\/([A-Za-z0-9_-]{20,64})$/;

/** 下載摘要 PDF：外部瀏覽器沒有 LIFF 登入，用連結裡的 token 驗證；不是這個路徑回傳 null */
export async function handleCaseDownload(method: string, path: string, deps: ApiDeps): Promise<ApiResponse | null> {
  const m = TOKEN_RE.exec(path);
  if (method !== "GET" || !m) return null;
  if (!deps.cases) return json(503, { error: "cases_unavailable" });
  const rec = await deps.cases.tokens.get(m[1]!);
  if (!rec || rec.expiresAt.getTime() < nowOf(deps).getTime()) return json(410, { error: "link_expired" });
  const c = await deps.cases.repo.get(rec.uid, rec.ids[0] ?? "");
  if (!c) return json(410, { error: "link_expired" });
  const summary = await makeSummary(deps, rec.uid, c);
  const pdf = await buildCasePdf(summary);
  const stamp = nowOf(deps).toISOString().slice(0, 10).replace(/-/g, "");
  return { status: 200, body: null, raw: { contentType: "application/pdf", data: pdf, filename: `case-${stamp}.pdf` } };
}
