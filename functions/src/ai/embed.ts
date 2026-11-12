import { createHash } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { EMBEDDING_DIMENSIONS, MODELS } from "../config.js";

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

export function geminiEmbedder(apiKey: string): Embedder {
  const ai = new GoogleGenAI({ apiKey });
  return {
    async embed(texts, task) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH) {
        const batch = texts.slice(i, i + BATCH);
        const res = await ai.models.embedContent({
          model: MODELS.embedding,
          contents: batch,
          config: { taskType: task, outputDimensionality: EMBEDDING_DIMENSIONS },
        });
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
