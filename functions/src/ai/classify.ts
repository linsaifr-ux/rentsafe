import { normalizeCity } from "../cities.js";
import { generateJson, type Llm } from "./llm.js";
import { CLASSIFY_SYSTEM, classifySchema, classifyUserPrompt, type ClassifyResult } from "./prompts/classify.v1.js";

export { CLASSIFY_PROMPT_VERSION } from "./prompts/classify.v1.js";

/** 情境、縣市、房東類型判斷（一次 LLM 呼叫，JSON 輸出） */
export async function classify(llm: Llm, question: string, knownCity: string | null): Promise<ClassifyResult> {
  const out = await generateJson(llm, { system: CLASSIFY_SYSTEM, user: classifyUserPrompt(question, knownCity), temperature: 0 }, classifySchema);
  // 縣市一律正規化；認不得就當成沒提到
  return { ...out, city: normalizeCity(out.city) };
}
