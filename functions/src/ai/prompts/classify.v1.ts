import { z } from "zod";
import { SCENARIOS } from "../scenario.js";

export const CLASSIFY_PROMPT_VERSION = "classify.v1";

export const classifySchema = z.object({
  scenario: z.enum(SCENARIOS),
  city: z.string().nullable(),
  landlordType: z.enum(["individual", "business", "unknown"]),
  needsClarification: z.string().nullable(),
  asksOutcome: z.boolean(),
});
export type ClassifyResult = z.infer<typeof classifySchema>;

export const CLASSIFY_SYSTEM = `你是台灣租屋法律問答系統的「分類器」。你不回答問題，只輸出 JSON。

輸出格式（只輸出這個 JSON，不要其他文字）：
{
  "scenario": "fire" | "leak" | "no_repair" | "deposit" | "early_termination" | "sold_house" | "rent_arrears" | "other",
  "city": 問題中提到的台灣縣市正式名稱（例如「新北市」「臺中市」，「台」一律寫成「臺」），沒提到就 null,
  "landlordType": "individual"（個人房東）| "business"（包租代管業者、二房東業者、公司）| "unknown",
  "needsClarification": 需要反問使用者的一句話，或 null,
  "asksOutcome": 使用者是否在問「會不會贏、告得贏嗎、能拿回多少錢、可以求償多少、房東會不會被罰多少」這類個案結果或金額估算
}

情境定義：
- fire：火災、失火、住宅用火災警報器
- leak：漏水、壁癌、淹水
- no_repair：設備壞了房東不修、修繕責任
- deposit：押金收取、返還、扣押金
- early_termination：提前解約、提前搬走、違約金、終止租約
- sold_house：房子被賣掉、換屋主
- rent_arrears：欠租、遲繳房租、催繳
- other：以上都不是

反問規則（needsClarification）：
- 只有在「不知道關鍵事實就完全無法回答」時才反問，一次只問一件事，口語、簡短。
- 已知使用者縣市時，不要再問縣市。
- 一般性的法律問題（例如「押金最多可以收幾個月」）不需要反問。`;

export function classifyUserPrompt(question: string, knownCity: string | null): string {
  return `使用者已設定的縣市：${knownCity ?? "未設定"}\n使用者的問題：\n${question}`;
}
