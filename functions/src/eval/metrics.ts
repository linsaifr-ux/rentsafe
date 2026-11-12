import { z } from "zod";
import { normalizeArticleNo } from "../kb/articleNo.js";

/** eval/questions*.jsonl 一行一題（SPEC 14） */
export const evalQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  city: z.string().nullable(),
  expectedArticles: z.array(z.object({ lawName: z.string(), articleNo: z.string() })),
  mustRefer: z.boolean(),
  notes: z.string().optional(),
  reviewedBy: z.string().nullable(),
});
export type EvalQuestion = z.infer<typeof evalQuestionSchema>;

export function parseJsonl(text: string): EvalQuestion[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => {
      try {
        return evalQuestionSchema.parse(JSON.parse(l));
      } catch (err) {
        throw new Error(`第 ${i + 1} 行格式錯誤：${String(err)}`, { cause: err });
      }
    });
}

export type ArticleRef = { lawName: string; articleNo: string };
const key = (a: ArticleRef) => `${a.lawName}|${normalizeArticleNo(a.articleNo) ?? a.articleNo}`;

export interface QuestionOutcome {
  id: string;
  reviewed: boolean;
  kind: string;
  expected: ArticleRef[];
  /** 最終（citeCheck 後）回答的引用 */
  cited: ArticleRef[];
  /** citeCheck 前，模型第一次輸出的引用 */
  rawCited: ArticleRef[];
  mustRefer: boolean;
  referred: boolean;
  latencyMs: number;
  error?: string;
}

export interface QuestionScore {
  recall: number;
  /** 沒有任何引用時為 null */
  precision: number | null;
  /** 第一次輸出中，引用知識庫不存在條文的數量 */
  hallucinated: number;
}

export function scoreQuestion(o: QuestionOutcome, kbKeys: Set<string>): QuestionScore {
  const exp = new Set(o.expected.map(key));
  const cited = new Set(o.cited.map(key));
  const hit = [...cited].filter((k) => exp.has(k)).length;
  return {
    recall: exp.size ? hit / exp.size : 1,
    precision: cited.size ? hit / cited.size : null,
    hallucinated: o.rawCited.filter((c) => !kbKeys.has(key(c))).length,
  };
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx]!;
}

export interface EvalSummary {
  total: number;
  reviewed: number;
  errors: number;
  /** 平均 recall（引用正確率，SPEC 14） */
  citationRecall: number;
  /** 平均 precision（只計有引用的題目） */
  citationPrecision: number;
  /** 幻覺率：第一次輸出引用知識庫不存在條文 ÷ 第一次輸出引用總數 */
  hallucinationRate: number;
  /** 轉介正確率：mustRefer 題目被轉介的比例 */
  referralRecall: number;
  latencyP50: number;
  latencyP95: number;
}

export function summarize(outcomes: QuestionOutcome[], kbKeys: Set<string>): EvalSummary {
  const ok = outcomes.filter((o) => !o.error);
  const scores = ok.map((o) => scoreQuestion(o, kbKeys));
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const precisions = scores.map((s) => s.precision).filter((p): p is number => p !== null);
  const rawTotal = ok.reduce((n, o) => n + o.rawCited.length, 0);
  const must = ok.filter((o) => o.mustRefer);
  return {
    total: outcomes.length,
    reviewed: outcomes.filter((o) => o.reviewed).length,
    errors: outcomes.length - ok.length,
    citationRecall: avg(scores.map((s) => s.recall)),
    citationPrecision: avg(precisions),
    hallucinationRate: rawTotal ? scores.reduce((n, s) => n + s.hallucinated, 0) / rawTotal : 0,
    referralRecall: must.length ? must.filter((o) => o.referred).length / must.length : 1,
    latencyP50: percentile(ok.map((o) => o.latencyMs), 50),
    latencyP95: percentile(ok.map((o) => o.latencyMs), 95),
  };
}

export function kbKeySet(chunks: ArticleRef[]): Set<string> {
  return new Set(chunks.map(key));
}
