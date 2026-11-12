import { z } from "zod";
import { ALL_CITIES } from "../cities.js";
import { VIEWING } from "../config.js";
import { ANSWERS, loadChecklist, type Checklist } from "../viewing/checklist.js";
import { fireAlarmRule } from "../viewing/fireRule.js";
import type { StoredViewing } from "../viewing/repo.js";
import { scoreViewing } from "../viewing/score.js";
import { HttpError, json, parseBody, type ApiDeps, type Routes } from "./http.js";

const viewingSchema = z.object({
  label: z.string().trim().max(VIEWING.labelMaxLength).optional(),
  city: z.enum(ALL_CITIES).nullable(),
  housingType: z.string(),
  answers: z.record(z.string(), z.enum(ANSWERS)),
});

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const deleteSchema = z.object({ id: idSchema });

const detailSchema = z.object({
  ids: z.array(idSchema).min(1).max(VIEWING.compareMax),
});

/** 沒填名稱時自動命名：「新北市頂樓加蓋 11/12」（日期用台灣時間） */
export function autoLabel(checklist: Checklist, city: string | null, housingType: string, now: Date): string {
  const housing = checklist.housingTypes.find((h) => h.id === housingType)?.label ?? "";
  const date = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric" }).format(now);
  return `${city ?? ""}${housing} ${date}`.trim();
}

/** 依儲存的回答，用現行清單重新算出完整結果（SPEC 7） */
async function expand(v: StoredViewing, checklist: Checklist, deps: ApiDeps) {
  const result = scoreViewing(checklist, { housingType: v.housingType, answers: v.answers });
  const fireRule = await fireAlarmRule(deps.kb, v.city);
  return { id: v.id, label: v.label, city: v.city, housingType: v.housingType, createdAt: v.createdAt, ...result, fireRule };
}

/** F1 看房健檢（SPEC 7）：純規則計分，不呼叫模型 */
export const viewingRoutes: Routes = {
  /** 清單題目與房型 */
  "GET /viewing/checklist": async () => {
    const c = loadChecklist();
    return json(200, {
      housingTypes: c.housingTypes.map((h) => ({ id: h.id, label: h.label, presetAnswers: h.presetAnswers, warning: h.warning ?? null })),
      items: c.items.map((it) => ({ id: it.id, question: it.question, why: it.why, weight: it.weight })),
    });
  },

  /** 計分、查住警器規定、存進 users/{uid}/viewings */
  "POST /viewing": async ({ user, body, deps }) => {
    const input = parseBody(viewingSchema, body);
    const checklist = loadChecklist();
    if (!checklist.housingTypes.some((h) => h.id === input.housingType)) throw new HttpError(400, "invalid_housing_type");
    const known = new Set(checklist.items.map((it) => it.id));
    const answers = Object.fromEntries(Object.entries(input.answers).filter(([k]) => known.has(k)));
    const label = input.label || autoLabel(checklist, input.city, input.housingType, new Date());

    const result = scoreViewing(checklist, { housingType: input.housingType, answers });
    const fireRule = await fireAlarmRule(deps.kb, input.city);
    await deps.users.ensure(user.uid, { displayName: user.name });
    const id = await deps.viewings.add(user.uid, {
      label,
      city: input.city,
      housingType: input.housingType,
      answers: result.answers,
      score: result.score,
      redFlags: result.redFlags.map((r) => r.id),
      questions: result.questions,
    });
    return json(200, { id, label, city: input.city, housingType: input.housingType, createdAt: new Date().toISOString(), ...result, fireRule });
  },

  /** 我的看房紀錄（新到舊） */
  "GET /viewing/history": async ({ user, deps }) => {
    const list = await deps.viewings.list(user.uid, VIEWING.historyLimit);
    return json(200, {
      viewings: list.map((v) => ({
        id: v.id,
        label: v.label,
        city: v.city,
        housingType: v.housingType,
        score: v.score,
        redFlagCount: v.redFlags.length,
        createdAt: v.createdAt,
      })),
    });
  },

  /** 讀取 1–3 筆完整結果（看單筆或並排比較）；只能讀自己的紀錄 */
  "POST /viewing/detail": async ({ user, body, deps }) => {
    const { ids } = parseBody(detailSchema, body);
    const found = await deps.viewings.getMany(user.uid, [...new Set(ids)]);
    if (found.length === 0) throw new HttpError(404, "not_found");
    const checklist = loadChecklist();
    return json(200, { viewings: await Promise.all(found.map((v) => expand(v, checklist, deps))) });
  },

  /** 永久刪除自己的一筆看房紀錄（只能刪自己的） */
  "POST /viewing/delete": async ({ user, body, deps }) => {
    const { id } = parseBody(deleteSchema, body);
    if (!(await deps.viewings.delete(user.uid, id))) throw new HttpError(404, "not_found");
    return json(200, { ok: true });
  },
};
