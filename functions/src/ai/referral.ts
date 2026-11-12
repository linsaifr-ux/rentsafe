import { z } from "zod";
import { REFERRAL_DEPOSIT_THRESHOLD_TWD } from "../config.js";
import { readKbYaml } from "../kbFiles.js";
import type { LandlordType } from "../users.js";
import type { Scenario } from "./scenario.js";

export const REFERRAL_IDS = ["legal_aid", "tmm", "mediation", "dispute_board", "consumer", "emergency"] as const;
export type ReferralId = (typeof REFERRAL_IDS)[number];

export const referralSchema = z.object({
  id: z.enum(REFERRAL_IDS),
  name: z.string(),
  contact: z.string(),
  hours: z.string().nullable(),
  note: z.string(),
  url: z.string().nullable(),
  source: z.string(),
  checkedAt: z.string(),
});
export type Referral = z.infer<typeof referralSchema>;

export function loadReferrals(): Referral[] {
  return z.array(referralSchema).parse(readKbYaml("referrals.yaml"));
}

const CN_NUM: Record<string, number> = { 一: 1, 兩: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/**
 * 從問題文字抓出金額（新台幣）。支援「3萬」「三萬」「兩萬四」「1.5萬」「25000元」「25,000」。
 * 抓不到回傳 null；有多個取最大。
 */
export function parseAmountTWD(text: string): number | null {
  const t = text.replace(/[,，]/g, "");
  const found: number[] = [];
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*萬/g)) found.push(Math.round(Number(m[1]) * 10_000));
  // 「兩萬四」＝24000、「一萬二」＝12000（萬後面接單一國字數字＝千位）
  for (const m of t.matchAll(/([一兩二三四五六七八九十])\s*萬([一二三四五六七八九])?(?![千百十])/g)) {
    found.push(CN_NUM[m[1]!]! * 10_000 + (m[2] ? CN_NUM[m[2]]! * 1_000 : 0));
  }
  for (const m of t.matchAll(/(\d{4,})\s*(?:元|塊)?/g)) found.push(Number(m[1]));
  return found.length ? Math.max(...found) : null;
}

export interface ReferralInput {
  scenario: Scenario;
  asksOutcome: boolean;
  landlordType: LandlordType;
  question: string;
  /** 模型建議的轉介（generate 的 referTo） */
  modelReferTo: string[];
  confidence: "high" | "medium" | "low";
}

export interface ReferralDecision {
  refer: boolean;
  reasons: string[];
  ids: ReferralId[];
}

/** 轉介判斷（SPEC 5.1）：問勝敗／高風險情境／押金金額大／信心低 → 附轉介卡 */
export function decideReferral(input: ReferralInput): ReferralDecision {
  const reasons: string[] = [];
  if (input.asksOutcome) reasons.push("asks_outcome");
  if (input.scenario === "fire" || input.scenario === "early_termination") reasons.push(`high_risk:${input.scenario}`);
  if (input.scenario === "deposit") {
    const amount = parseAmountTWD(input.question);
    if (amount !== null && amount > REFERRAL_DEPOSIT_THRESHOLD_TWD) reasons.push("deposit_over_threshold");
  }
  if (input.confidence === "low") reasons.push("low_confidence");

  // 只有符合 SPEC 5.1 的轉介條件時才轉介；模型的 referTo 只用來決定「轉介給誰」，不能單獨觸發轉介
  const ids = new Set<ReferralId>();
  if (reasons.length) {
    for (const id of input.modelReferTo) {
      if ((REFERRAL_IDS as readonly string[]).includes(id) && id !== "emergency") ids.add(id as ReferralId);
    }
    ids.add("legal_aid");
    if (input.scenario === "deposit" || input.scenario === "early_termination" || input.scenario === "no_repair" || input.scenario === "leak") {
      ids.add("mediation");
    }
  }
  if (input.landlordType === "business" && ids.size) ids.add("consumer");

  const ordered = REFERRAL_IDS.filter((id) => ids.has(id));
  return { refer: ordered.length > 0, reasons, ids: ordered };
}
