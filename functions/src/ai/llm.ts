import { GoogleGenAI } from "@google/genai";
import { type RetryOptions, withRateLimitRetry } from "./embed.js";
import type { z } from "zod";
import { LLM, MODELS } from "../config.js";

/** 一起送給模型的檔案（圖片或 PDF），base64 不含 data: 前綴 */
export interface LlmFile {
  mimeType: string;
  data: string;
}

export interface LlmRequest {
  system: string;
  user: string;
  temperature?: number;
  /** 圖片或 PDF（租約健檢用）；只在記憶體中傳遞，不落地 */
  files?: LlmFile[];
}

/** 回傳模型輸出的原始文字（要求 JSON） */
export interface Llm {
  generate(req: LlmRequest): Promise<string>;
}

export class LlmJsonError extends Error {
  constructor(
    message: string,
    readonly attempts: string[],
  ) {
    super(message);
  }
}

/** 去掉模型偶爾包上的 ```json 圍欄 */
export function extractJson(text: string): string {
  const m = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1]! : text.trim();
}

/**
 * 呼叫模型並用 zod 驗證 JSON；失敗時把錯誤告訴模型重試（預設 1 次，見 config.LLM.jsonRetries）。
 */
export async function generateJson<T>(
  llm: Llm,
  req: LlmRequest,
  schema: z.ZodType<T>,
  retries: number = LLM.jsonRetries,
): Promise<T> {
  const attempts: string[] = [];
  let user = req.user;
  for (let i = 0; i <= retries; i++) {
    const raw = await llm.generate({ ...req, user });
    attempts.push(raw);
    let problem: string;
    try {
      const parsed = schema.safeParse(JSON.parse(extractJson(raw)));
      if (parsed.success) return parsed.data;
      problem = parsed.error.issues.map((x) => `${x.path.join(".") || "(root)"}: ${x.message}`).join("; ");
    } catch (err) {
      problem = `不是合法的 JSON：${String(err)}`;
    }
    user = `${req.user}\n\n[上一次的輸出不符合格式：${problem}。請只輸出符合格式的 JSON。]`;
  }
  throw new LlmJsonError("LLM JSON 驗證失敗", attempts);
}

export function geminiLlm(apiKey: string, model: string = MODELS.chat, opts: RetryOptions = {}): Llm {
  const ai = new GoogleGenAI({ apiKey });
  return {
    async generate({ system, user, temperature, files }) {
      const contents = files?.length
        ? [{ role: "user", parts: [...files.map((f) => ({ inlineData: { mimeType: f.mimeType, data: f.data } })), { text: user }] }]
        : user;
      const res = await withRateLimitRetry(
        () =>
          ai.models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: system,
              responseMimeType: "application/json",
              temperature: temperature ?? LLM.temperature,
            },
          }),
        { retries: opts.retries ?? 0, onWait: opts.onWait },
      );
      const text = res.text;
      if (!text) throw new Error("模型沒有回傳內容");
      return text;
    },
  };
}
