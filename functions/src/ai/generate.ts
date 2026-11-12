import { generateJson, type Llm } from "./llm.js";
import {
  ANSWER_SYSTEM,
  answerSchema,
  answerUserPrompt,
  strictRetryUserPrompt,
  type AnswerOutput,
  type PromptSource,
} from "./prompts/answer.v1.js";

export { ANSWER_PROMPT_VERSION } from "./prompts/answer.v1.js";

export interface GenerateArgs {
  question: string;
  city: string | null;
  scenarioLabel: string;
  sources: PromptSource[];
}

/** 生成回答（JSON 輸出，zod 驗證，格式錯誤重試 1 次） */
export async function generateAnswer(llm: Llm, args: GenerateArgs): Promise<AnswerOutput> {
  return generateJson(llm, { system: ANSWER_SYSTEM, user: answerUserPrompt(args) }, answerSchema);
}

/** 引用驗證失敗後，用「只能引用以下條號」的嚴格 prompt 再生成一次 */
export async function generateAnswerStrict(llm: Llm, args: GenerateArgs, problems: string[]): Promise<AnswerOutput> {
  const user = strictRetryUserPrompt(answerUserPrompt(args), args.sources, problems);
  return generateJson(llm, { system: ANSWER_SYSTEM, user, temperature: 0 }, answerSchema);
}
