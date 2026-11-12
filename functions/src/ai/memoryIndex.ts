import { embedText, type KbChunk } from "../kb/chunks.js";
import type { Embedder } from "./embed.js";
import type { KbIndex, RetrievedChunk } from "./retrieve.js";

/**
 * 記憶體版 KbIndex：直接用 kb/ 的 chunks 加上嵌入，不需要 Firestore。
 * 用於單元測試與 eval（向量已 L2 正規化，COSINE 距離 = 1 − 內積）。
 */
export async function memoryKbIndex(chunks: KbChunk[], embedder: Embedder): Promise<KbIndex> {
  const vecs = await embedder.embed(chunks.map(embedText), "RETRIEVAL_DOCUMENT");
  const rows = chunks.map((c, i) => ({ c, v: vecs[i]! }));
  const toR = (c: KbChunk, distance: number | null): RetrievedChunk => ({
    id: c.id,
    lawName: c.lawName,
    articleNo: c.articleNo,
    article: c.article,
    text: c.text,
    plain: c.plain,
    plainReviewed: c.plainReviewed,
    scope: c.scope,
    sourceUrl: c.sourceUrl,
    distance,
  });
  return {
    async nearest(v, scope, limit) {
      return rows
        .filter((r) => r.c.scope === scope)
        .map((r) => toR(r.c, 1 - r.v.reduce((s, x, i) => s + x * v[i]!, 0)))
        .sort((a, b) => a.distance! - b.distance!)
        .slice(0, limit);
    },
    async byArticle(lawName, articleNo, scope) {
      const r = rows.find((x) => x.c.lawName === lawName && x.c.articleNo === articleNo && x.c.scope === scope);
      return r ? toR(r.c, null) : null;
    },
    async byScope(scope) {
      return rows.filter((r) => r.c.scope === scope).map((r) => toR(r.c, null));
    },
  };
}
