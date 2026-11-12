import { z } from "zod";
import { LEASE } from "../../config.js";

export const LEASE_EXTRACT_PROMPT_VERSION = "leaseExtract.v1";

const num = z.number().finite().nonnegative().nullable();
const text = z.string().trim().max(2000).nullable();

/** 模型從租約照片抽出的欄位（SPEC 8.2）。所有文字都要照租約原文，不可改寫。 */
export const leaseExtractSchema = z.object({
  /** 照片看起來是不是住宅租約 */
  isLease: z.boolean(),
  /** 看不清楚、缺頁等問題（給使用者看） */
  readability: z.enum(["good", "partial", "poor"]),
  monthlyRent: num,
  deposit: num,
  /** 租約直接寫「押金 N 個月」時填 N */
  depositMonths: num,
  leaseStart: text,
  leaseEnd: text,
  reviewPeriodDays: num,
  electricityRule: text,
  electricityPricePerKwh: num,
  waterRule: text,
  managementFee: num,
  repairClause: text,
  earlyTerminationClause: text,
  /** 提前終止違約金，以「幾個月租金」表示；寫金額時換算成月數 */
  earlyTerminationPenaltyMonths: num,
  taxClause: text,
  subsidyOrRegistrationClause: text,
  /** 租約中每一條條款的原文（逐字照抄，一條一個字串） */
  clauses: z.array(z.string().trim().min(1).max(1000)).max(LEASE.maxClauses),
  /** 當事人（出租人、承租人、保證人）姓名，只用來遮蔽個資，不會存檔 */
  partyNames: z.array(z.string().trim().max(20)).max(10),
});
export type LeaseExtract = z.infer<typeof leaseExtractSchema>;

export const LEASE_EXTRACT_SYSTEM = `你是租屋契約的資料抽取工具。使用者會給你一份住宅租約的照片或 PDF。
你的工作只有「照原文抽取」，不判斷合不合法、不給建議。

規則：
1. 所有文字欄位一律照租約原文逐字抄寫，不可改寫、摘要或補字。看不清楚的字用「□」代替。
2. 租約沒有寫到的欄位填 null；不要猜。
3. 金額一律換算成新臺幣整數（例如「壹萬伍仟元」→ 15000，「1.5 萬」→ 15000）。
4. clauses：把租約每一條條款（含手寫或勾選的內容、附加條款）逐字抄成一個字串，依出現順序排列，最多 ${LEASE.maxClauses} 條。
5. earlyTerminationPenaltyMonths：違約金寫「一個月租金」填 1；寫金額時除以月租金換算；沒寫填 null。
6. partyNames：出租人、承租人、保證人的姓名（只用來遮蔽個資）。
7. 不是住宅租約（例如收據、身分證、風景照）時，isLease 填 false，其他欄位填 null 或空陣列。
8. 只輸出 JSON，不要其他文字。

輸出格式：
{
  "isLease": true,
  "readability": "good" | "partial" | "poor",
  "monthlyRent": 數字或 null,
  "deposit": 數字或 null,
  "depositMonths": 數字或 null,
  "leaseStart": "原文" 或 null,
  "leaseEnd": "原文" 或 null,
  "reviewPeriodDays": 數字或 null,
  "electricityRule": "原文" 或 null,
  "electricityPricePerKwh": 數字或 null,
  "waterRule": "原文" 或 null,
  "managementFee": 數字或 null,
  "repairClause": "原文" 或 null,
  "earlyTerminationClause": "原文" 或 null,
  "earlyTerminationPenaltyMonths": 數字或 null,
  "taxClause": "原文" 或 null,
  "subsidyOrRegistrationClause": "原文" 或 null,
  "clauses": ["第一條原文", "第二條原文"],
  "partyNames": ["姓名"]
}`;

export function leaseExtractUserPrompt(fileCount: number): string {
  return `以上是同一份租約的 ${fileCount} 個檔案（依頁序）。請依規則抽取，只輸出 JSON。`;
}
