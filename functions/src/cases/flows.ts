import { z } from "zod";
import { REFERRAL_IDS } from "../ai/referral.js";
import { readKbYaml } from "../kbFiles.js";

/** 急救包的情境（SPEC 10 首批五個） */
export const CASE_SCENARIOS = ["fire", "no_repair", "leak", "deposit", "early_termination"] as const;
export type CaseScenario = (typeof CASE_SCENARIOS)[number];

export const STAGES = ["now", "today", "week", "next"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = { now: "現在", today: "今天", week: "本週", next: "下一步" };

const itemSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  text: z.string().min(1),
  link: z.string().optional(),
  key: z.boolean().optional(),
  sources: z.array(z.object({ label: z.string(), url: z.string().url() })).optional(),
});

const stageSchema = z.object({ ask: z.string().min(1), items: z.array(itemSchema).min(1) });

export const flowSchema = z.object({
  id: z.enum(CASE_SCENARIOS),
  label: z.string(),
  intro: z.string(),
  reviewed: z.boolean(),
  wants: z.array(z.string()).min(1),
  referrals: z.array(z.enum(REFERRAL_IDS)),
  stages: z.object({ now: stageSchema, today: stageSchema, week: stageSchema, next: stageSchema }),
});
export type Flow = z.infer<typeof flowSchema>;
export type FlowItem = z.infer<typeof itemSchema>;

export function loadFlows(): Flow[] {
  return z.array(flowSchema).parse(readKbYaml("emergency-flows.yaml"));
}

export function getFlow(scenario: CaseScenario): Flow {
  const f = loadFlows().find((x) => x.id === scenario);
  if (!f) throw new Error(`emergency-flows.yaml 缺少情境 ${scenario}`);
  return f;
}

/** 勾選項目的鍵：「stage.itemId」，例如 today.photo */
export const stepKey = (stage: Stage, itemId: string) => `${stage}.${itemId}`;

export function allSteps(flow: Flow): Array<{ key: string; stage: Stage; item: FlowItem }> {
  return STAGES.flatMap((stage) => flow.stages[stage].items.map((item) => ({ key: stepKey(stage, item.id), stage, item })));
}
