import { z } from "zod";
import { readKbYaml } from "../kbFiles.js";

const basisSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("standard"), point: z.string(), quote: z.string().min(4) }),
  z.object({ kind: z.literal("law"), lawName: z.string(), articleNo: z.string() }),
]);

const ruleSchema = z.object({
  id: z.string().regex(/^[a-z_]+$/),
  check: z.enum(["numeric", "semantic", "required"]),
  level: z.enum(["red", "yellow"]),
  title: z.string(),
  explanation: z.string(),
  negotiate: z.string(),
  hint: z.string().optional(),
  basis: z.array(basisSchema),
});

export const rulesetSchema = z.object({
  standard: z.object({
    name: z.string(),
    issuer: z.string(),
    sourceUrl: z.url(),
    updatedAt: z.union([z.string(), z.date()]).transform((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v)),
  }),
  rules: z.array(ruleSchema).min(1),
});

export type Ruleset = z.infer<typeof rulesetSchema>;
export type LeaseRule = Ruleset["rules"][number];
export type RuleBasis = LeaseRule["basis"][number];

/** 讀 kb/contract-rules.yaml（SPEC 8.3） */
export function loadRuleset(): Ruleset {
  return rulesetSchema.parse(readKbYaml("contract-rules.yaml"));
}

/** 要送給模型做語意比對的規則（有 hint 的） */
export function semanticRules(rs: Ruleset): LeaseRule[] {
  return rs.rules.filter((r) => r.hint);
}
