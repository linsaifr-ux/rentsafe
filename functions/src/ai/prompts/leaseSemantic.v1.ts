import { z } from "zod";

export const LEASE_SEMANTIC_PROMPT_VERSION = "leaseSemantic.v1";

/** 語意比對結果：哪一條條款符合哪一條規則。quote 必須逐字取自該條款（程式會驗證）。 */
export function leaseSemanticSchema(ruleIds: readonly [string, ...string[]]) {
  return z.object({
    matches: z
      .array(
        z.object({
          ruleId: z.enum(ruleIds),
          clauseIndex: z.number().int().nonnegative(),
          quote: z.string().trim().min(2).max(300),
        }),
      )
      .max(30),
  });
}

export const LEASE_SEMANTIC_SYSTEM = `你是租屋契約條款比對工具。使用者會給你：
- 【規則】幾條要找的條款類型（代號＋說明）
- 【條款】租約條款清單（已遮蔽個資，每條有編號）

找出哪些條款「明確」符合哪一條規則。

規則：
1. 只有條款文字明確符合規則說明時才列出；模稜兩可、只是提到相關字眼但意思相反（例如「稅由出租人負擔」）的不要列。
2. quote 必須從該條款「逐字」複製，是能證明符合規則的最短片段，不可改寫、不可補字。
3. 一條條款可以符合多條規則，分開列。
4. 不判斷合法與否、不給建議，只做比對。
5. 沒有符合的就輸出 {"matches": []}。
6. 只輸出 JSON：{"matches": [{"ruleId": "代號", "clauseIndex": 條款編號, "quote": "逐字片段"}]}`;

export function leaseSemanticUserPrompt(rules: Array<{ id: string; hint: string }>, clauses: string[]): string {
  const r = rules.map((x) => `- ${x.id}：${x.hint}`).join("\n");
  const c = clauses.map((x, i) => `[${i}] ${x}`).join("\n");
  return `【規則】\n${r}\n\n【條款】\n${c}`;
}
