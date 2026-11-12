import { createHash } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { EMBEDDING_DIMENSIONS, LLM, MODELS } from "../config.js";

export type EmbedTask = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export interface Embedder {
  embed(texts: string[], task: EmbedTask): Promise<number[][]>;
}

/** L2 正規化（gemini-embedding-001 輸出維度小於 3072 時官方建議正規化） */
export function l2normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n === 0 ? v : v.map((x) => x / n);
}

const BATCH = 50;

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 判斷是否為 Gemini 限流錯誤（HTTP 429 / RESOURCE_EXHAUSTED） */
export function isRateLimitError(err: unknown): boolean {
  const e = err as { status?: unknown; code?: unknown; message?: unknown } | null;
  if (e && (e.status === 429 || e.code === 429)) return true;
  const msg = e && typeof e.message === "string" ? e.message : String(err);
  return /\b429\b|RESOURCE_EXHAUSTED/.test(msg);
}

/** 從錯誤訊息取出建議等待時間（"retryDelay":"52s" 或 retry in 52.3s）；找不到回傳 null */
export function retryDelayMs(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/"retryDelay"\s*:\s*"([\d.]+)s"/) ?? msg.match(/retry in ([\d.]+)s/i);
  return m ? Math.ceil(Number(m[1]) * 1000) : null;
}

/** 遇到 429 時依建議時間等待後重試，其他錯誤直接拋出 */
export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; sleep?: (ms: number) => Promise<void>; onWait?: (ms: number) => void } = {},
): Promise<T> {
  const retries = opts.retries ?? LLM.rateLimitRetries;
  const sleep = opts.sleep ?? sleepMs;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRateLimitError(err)) throw err;
      const wait = (retryDelayMs(err) ?? LLM.rateLimitDefaultWaitMs) + 1000;
      opts.onWait?.(wait);
      await sleep(wait);
    }
  }
}

/** 限流重試設定；預設不重試（線上請求不能等太久），命令列工具傳 { retries: LLM.rateLimitRetries } */
export interface RetryOptions {
  retries?: number;
  onWait?: (ms: number) => void;
}

export function geminiEmbedder(apiKey: string, opts: RetryOptions = {}): Embedder {
  const ai = new GoogleGenAI({ apiKey });
  return {
    async embed(texts, task) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH) {
        const batch = texts.slice(i, i + BATCH);
        const res = await withRateLimitRetry(
          () =>
            ai.models.embedContent({
              model: MODELS.embedding,
              contents: batch,
              config: { taskType: task, outputDimensionality: EMBEDDING_DIMENSIONS },
            }),
          { retries: opts.retries ?? 0, onWait: opts.onWait },
        );
        const embs = res.embeddings ?? [];
        if (embs.length !== batch.length) throw new Error(`嵌入數量不符：${embs.length}/${batch.length}`);
        for (const e of embs) {
          if (!e.values || e.values.length !== EMBEDDING_DIMENSIONS) throw new Error("嵌入維度不符");
          out.push(l2normalize(e.values));
        }
      }
      return out;
    },
  };
}

/**
 * 測試／emulator 用的假嵌入：以字元 bigram 雜湊成向量，相似文字會有相近向量。
 * 不呼叫任何外部 API。
 */
export function fakeEmbedder(dim = EMBEDDING_DIMENSIONS): Embedder {
  return {
    async embed(texts) {
      return texts.map((t) => {
        const v = new Array<number>(dim).fill(0);
        const s = t.replace(/\s+/g, "");
        for (let i = 0; i < s.length - 1; i++) {
          const h = createHash("md5").update(s.slice(i, i + 2)).digest();
          v[h.readUInt32BE(0) % dim]! += 1;
        }
        return l2normalize(v);
      });
    },
  };
}
