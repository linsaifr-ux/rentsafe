import { z } from "zod";

export const ANSWER_PROMPT_VERSION = "answer.v1";

/** SPEC 5.2 的輸出格式 */
const BANNED = ["一定", "保證", "勝訴"];

const upTo4 = z.array(z.string()).transform((a) => a.filter((s) => s.trim()).slice(0, 4));

export const answerSchema = z.object({
  summary: z
    .string()
    .min(1)
    .refine((s) => !BANNED.some((w) => s.includes(w)), { message: `summary 不得出現：${BANNED.join("、")}` }),
  citations: z.array(z.object({ lawName: z.string(), articleNo: z.string(), quote: z.string() })),
  actions: upTo4,
  evidence: upTo4,
  referTo: z.array(z.enum(["legal_aid", "tmm", "mediation", "consumer", "dispute_board", "none"])),
  confidence: z.enum(["high", "medium", "low"]),
});
export type AnswerOutput = z.infer<typeof answerSchema>;

export const ANSWER_SYSTEM = `你是「租安心」，協助台灣租屋族（多半是第一次租屋的大學生）理解法律資訊的助理。你不是律師，提供的是法律資訊，不是法律意見。

必須遵守：
1. 只能根據使用者訊息中【條文片段】回答，不可以使用你自己記得的法條或條號。片段不足以回答時，confidence 設為 "low"，並在 referTo 建議轉介。
2. 每個 citation 的 lawName 與 articleNo 必須和片段完全相同；quote 必須「逐字」複製片段中支撐結論的關鍵句，不可改寫、不可增刪任何字或標點。
3. summary 與 actions 裡如果寫到「第 X 條」，那一條必須列在 citations。
4. 不得預測訴訟或調解結果，不得估算賠償或求償金額，不得建議公開、張貼房東的個人資料或在網路上指名道姓。使用者問這些時，說明無法判斷個案並建議轉介（referTo 加 "legal_aid"）。
5. summary 不得出現「一定」「保證」「勝訴」。
6. 用繁體中文、台灣用語，國中生看得懂；summary 2–3 句。
7. 要區分「全國規定」和「該縣市規定」：片段標示 scope 為縣市名的是地方規定，只適用於該縣市；沒有該縣市片段時，只說全國規定，並建議向當地消防局或市府確認。

只輸出以下 JSON，不要其他文字：
{
  "summary": "白話結論，2–3 句",
  "citations": [{ "lawName": "法規名稱", "articleNo": "條號，例如 424 或 6-1", "quote": "逐字出自條文的關鍵句" }],
  "actions": ["可以做的具體步驟，最多 4 項"],
  "evidence": ["建議保留的證據，最多 4 項"],
  "referTo": ["legal_aid" | "tmm" | "mediation" | "consumer" | "dispute_board" | "none"],
  "confidence": "high" | "medium" | "low"
}

referTo 代號：legal_aid＝法扶基金會（免費律師諮詢）、tmm＝崔媽媽基金會（租屋諮詢）、mediation＝區公所調解委員會、consumer＝1950 消費者專線（房東是業者時）、dispute_board＝縣市不動產糾紛調處委員會；不需要轉介時填 ["none"]。`;

export interface PromptSource {
  lawName: string;
  articleNo: string;
  scope: string;
  text: string;
}

export function formatSources(sources: PromptSource[]): string {
  return sources
    .map((s) => `<條文 lawName="${s.lawName}" articleNo="${s.articleNo}" scope="${s.scope === "national" ? "全國" : s.scope}">\n${s.text}\n</條文>`)
    .join("\n");
}

export function answerUserPrompt(args: {
  question: string;
  city: string | null;
  scenarioLabel: string;
  sources: PromptSource[];
}): string {
  return `【使用者縣市】${args.city ?? "未知"}
【情境】${args.scenarioLabel}
【條文片段】
${formatSources(args.sources)}

【使用者的問題】
${args.question}`;
}

/** citeCheck 失敗後的嚴格重試（SPEC 5.1） */
export function strictRetryUserPrompt(base: string, sources: PromptSource[], problems: string[]): string {
  const allowed = sources.map((s) => `${s.lawName} 第 ${s.articleNo} 條`).join("、");
  return `${base}

【重要：上一次的回答引用有誤】
${problems.map((p) => `- ${p}`).join("\n")}
這次只能引用以下條號：${allowed}。
quote 必須從上面的條文片段逐字複製；summary 和 actions 不要提到沒有列在 citations 的條號。`;
}
