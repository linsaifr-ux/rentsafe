import { z } from "zod";
import { ALL_CITIES } from "../cities.js";
import { ANSWERS, loadChecklist } from "../viewing/checklist.js";
import { fireAlarmRule } from "../viewing/fireRule.js";
import { scoreViewing } from "../viewing/score.js";
import { HttpError, json, parseBody, type Routes } from "./http.js";

const viewingSchema = z.object({
  city: z.enum(ALL_CITIES).nullable(),
  housingType: z.string(),
  answers: z.record(z.string(), z.enum(ANSWERS)),
});

/** F1 看房健檢（SPEC 7）：純規則計分，不呼叫模型 */
export const viewingRoutes: Routes = {
  /** 清單題目與房型（不含計分規則以外的內部欄位） */
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

    const result = scoreViewing(checklist, { housingType: input.housingType, answers });
    const fireRule = await fireAlarmRule(deps.kb, input.city);
    await deps.users.ensure(user.uid, { displayName: user.name });
    const id = await deps.viewings.add(user.uid, {
      city: input.city,
      housingType: input.housingType,
      answers: result.answers,
      score: result.score,
      redFlags: result.redFlags.map((r) => r.id),
      questions: result.questions,
    });
    return json(200, { id, ...result, fireRule });
  },
};
