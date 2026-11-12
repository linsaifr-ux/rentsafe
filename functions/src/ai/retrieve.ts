import type { Firestore } from "firebase-admin/firestore";
import { RETRIEVAL } from "../config.js";
import { KB_COLLECTION } from "../kb/store.js";
import type { Embedder } from "./embed.js";
import { REQUIRED_ARTICLES, type Scenario } from "./scenario.js";

export interface RetrievedChunk {
  id: string;
  lawName: string;
  articleNo: string;
  article: string;
  text: string;
  plain: string;
  plainReviewed: boolean;
  scope: string;
  sourceUrl: string;
  /** 向量距離（COSINE，越小越近）；情境必帶的條文為 null */
  distance: number | null;
}

/** kb_chunks 的查詢介面；測試可替換成記憶體版 */
export interface KbIndex {
  nearest(vector: number[], scope: string, limit: number): Promise<RetrievedChunk[]>;
  byArticle(lawName: string, articleNo: string, scope: string): Promise<RetrievedChunk | null>;
  byScope(scope: string): Promise<RetrievedChunk[]>;
}

/**
 * 檢索（SPEC 5.1）：
 * 1. 問題嵌入向量，分別查 scope=national 與 scope=city，合併取最近的前 topK 筆
 * 2. 補上情境必帶條文（SPEC 5.3）
 * 3. 火災情境補上該縣市的所有地方規定（住警器）
 */
export async function retrieve(args: {
  question: string;
  city: string | null;
  scenario: Scenario;
  embedder: Embedder;
  index: KbIndex;
  topK?: number;
}): Promise<RetrievedChunk[]> {
  const topK = args.topK ?? RETRIEVAL.topK;
  const [vector] = await args.embedder.embed([args.question], "RETRIEVAL_QUERY");
  if (!vector) throw new Error("嵌入失敗");

  const lists = await Promise.all([
    args.index.nearest(vector, "national", topK),
    args.city ? args.index.nearest(vector, args.city, topK) : Promise.resolve([]),
  ]);
  const nearest = lists
    .flat()
    .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))
    .slice(0, topK);

  const out = new Map<string, RetrievedChunk>(nearest.map((c) => [c.id, c]));
  const required = await Promise.all(
    REQUIRED_ARTICLES[args.scenario].map((r) => args.index.byArticle(r.lawName, r.articleNo, "national")),
  );
  for (const c of required) if (c && !out.has(c.id)) out.set(c.id, { ...c, distance: null });

  if (args.scenario === "fire" && args.city) {
    for (const c of await args.index.byScope(args.city)) if (!out.has(c.id)) out.set(c.id, { ...c, distance: null });
  }
  return [...out.values()];
}

function toChunk(id: string, d: FirebaseFirestore.DocumentData, distance: number | null): RetrievedChunk {
  return {
    id,
    lawName: d.lawName,
    articleNo: d.articleNo,
    article: d.article,
    text: d.text,
    plain: d.plain ?? "",
    plainReviewed: d.plainReviewed ?? false,
    scope: d.scope,
    sourceUrl: d.sourceUrl,
    distance,
  };
}

export function firestoreKbIndex(db: Firestore): KbIndex {
  const col = db.collection(KB_COLLECTION);
  return {
    async nearest(vector, scope, limit) {
      const snap = await col
        .where("scope", "==", scope)
        .findNearest({
          vectorField: "embedding",
          queryVector: vector,
          limit,
          distanceMeasure: "COSINE",
          distanceResultField: "_distance",
        })
        .get();
      return snap.docs.map((d) => toChunk(d.id, d.data(), Number(d.get("_distance"))));
    },
    async byArticle(lawName, articleNo, scope) {
      const snap = await col
        .where("lawName", "==", lawName)
        .where("articleNo", "==", articleNo)
        .where("scope", "==", scope)
        .limit(1)
        .get();
      const d = snap.docs[0];
      return d ? toChunk(d.id, d.data(), null) : null;
    },
    async byScope(scope) {
      const snap = await col.where("scope", "==", scope).limit(20).get();
      return snap.docs.map((d) => toChunk(d.id, d.data(), null));
    },
  };
}
