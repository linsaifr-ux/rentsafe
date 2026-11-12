import { z } from "zod";
import { readKbYaml } from "../kbFiles.js";

/** 看房健檢的回答：是／否／不確定 */
export const ANSWERS = ["yes", "no", "unknown"] as const;
export type Answer = (typeof ANSWERS)[number];

const citationSchema = z.object({ lawName: z.string(), articleNo: z.string() });

const itemSchema = z.object({
  id: z.string().regex(/^[a-z_]+$/),
  question: z.string().min(1),
  why: z.string().min(1),
  weight: z.number().int().min(1).max(3),
  redFlagIf: z.enum(["yes", "no"]),
  citations: z.array(citationSchema).default([]),
  askLandlord: z.string().min(1),
});

const housingTypeSchema = z.object({
  id: z.string().regex(/^[a-z_]+$/),
  label: z.string(),
  presetAnswers: z.record(z.string(), z.enum(["yes", "no"])).default({}),
  warning: z.string().optional(),
});

export const checklistSchema = z
  .object({
    housingTypes: z.array(housingTypeSchema).min(1),
    items: z.array(itemSchema).min(15),
  })
  .superRefine((c, ctx) => {
    const ids = new Set<string>();
    for (const it of c.items) {
      if (ids.has(it.id)) ctx.addIssue({ code: "custom", message: `重複的題目 id：${it.id}` });
      ids.add(it.id);
    }
    for (const h of c.housingTypes) {
      for (const k of Object.keys(h.presetAnswers)) {
        if (!ids.has(k)) ctx.addIssue({ code: "custom", message: `${h.id} 的 presetAnswers 指到不存在的題目 ${k}` });
      }
    }
  });

export type Checklist = z.infer<typeof checklistSchema>;
export type ChecklistItem = Checklist["items"][number];
export type HousingType = Checklist["housingTypes"][number];

/** 讀 kb/viewing-checklist.yaml（SPEC 7） */
export function loadChecklist(): Checklist {
  return checklistSchema.parse(readKbYaml("viewing-checklist.yaml"));
}
