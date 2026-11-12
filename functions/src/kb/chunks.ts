import { createHash } from "node:crypto";
import { z } from "zod";
import { normalizeArticleNo } from "./articleNo.js";
import type { LawFile } from "./lawData.js";
import { articleUrl } from "./sources.js";

/** kb_chunks 的一筆（不含 embedding、fetchedAt） */
export interface KbChunk {
  id: string;
  lawName: string;
  pcode: string | null;
  article: string;
  articleNo: string;
  text: string;
  /** 白話說明；plainReviewed 為 false 時只用於檢索，不顯示給使用者 */
  plain: string;
  plainReviewed: boolean;
  scope: string; // "national" 或縣市名
  tags: string[];
  sourceUrl: string;
  /** 法規最後修正日期 */
  updatedAt: string;
  contentHash: string;
}

/** kb/plain/{pcode}.yaml */
export const plainFileSchema = z.array(
  z.object({ articleNo: z.string(), plain: z.string(), reviewed: z.boolean().default(false) }),
);
export type PlainEntry = z.infer<typeof plainFileSchema>[number];

/** kb/tags.yaml：tag → 法規 → 條號 */
export const tagsFileSchema = z.record(z.string(), z.record(z.string(), z.array(z.string())));
export type TagsFile = z.infer<typeof tagsFileSchema>;

/** 文件 ID：以 (lawName, articleNo, scope) 為鍵（SPEC 6.2） */
export function chunkId(lawName: string, articleNo: string, scope: string): string {
  const h = createHash("sha1").update(`${lawName}|${articleNo}|${scope}`).digest("hex").slice(0, 16);
  return `${scope === "national" ? "n" : "l"}_${h}`;
}

export function isRepealed(text: string): boolean {
  return /^[（(]?刪除[）)]?。?$/.test(text.trim());
}

/** 嵌入內容 =「{lawName} 第 {articleNo} 條」＋條文＋白話＋tags（SPEC 6.2） */
export function embedText(c: Pick<KbChunk, "lawName" | "articleNo" | "text" | "plain" | "tags">): string {
  return [`${c.lawName} 第 ${c.articleNo} 條`, c.text, c.plain, c.tags.join("、")].filter(Boolean).join("\n");
}

function hashOf(c: Omit<KbChunk, "contentHash" | "id">): string {
  return createHash("sha256")
    .update(JSON.stringify([c.lawName, c.articleNo, c.scope, c.text, c.plain, c.plainReviewed, c.tags, c.sourceUrl, c.updatedAt]))
    .digest("hex");
}

export function tagsFor(tags: TagsFile, lawName: string, articleNo: string): string[] {
  const out: string[] = [];
  for (const [tag, laws] of Object.entries(tags)) {
    const nos = laws[lawName]?.map((n) => normalizeArticleNo(n) ?? n) ?? [];
    if (nos.includes(articleNo)) out.push(tag);
  }
  return out.sort();
}

export function buildLawChunks(
  law: LawFile,
  plain: PlainEntry[] = [],
  tags: TagsFile = {},
): KbChunk[] {
  const plainMap = new Map(plain.map((p) => [normalizeArticleNo(p.articleNo) ?? p.articleNo, p]));
  return law.articles
    .filter((a) => !isRepealed(a.text))
    .map((a) => {
      const p = plainMap.get(a.articleNo);
      const base = {
        lawName: law.lawName,
        pcode: law.pcode,
        article: a.article,
        articleNo: a.articleNo,
        text: a.text,
        plain: p?.plain ?? "",
        plainReviewed: p?.reviewed ?? false,
        scope: "national",
        tags: tagsFor(tags, law.lawName, a.articleNo),
        sourceUrl: articleUrl(law.pcode, a.articleNo),
        updatedAt: law.modifiedDate,
      };
      return { ...base, id: chunkId(base.lawName, base.articleNo, base.scope), contentHash: hashOf(base) };
    });
}

/** 縣市規定（kb/local/*.md 解析結果） */
export interface LocalArticle {
  lawName: string;
  articleNo: string;
  text: string;
  city: string;
  sourceUrl: string;
  updatedAt: string;
  tags: string[];
}

export function buildLocalChunk(a: LocalArticle): KbChunk {
  const base = {
    lawName: a.lawName,
    pcode: null,
    article: `第 ${a.articleNo} 條`,
    articleNo: a.articleNo,
    text: a.text,
    plain: "",
    plainReviewed: false,
    scope: a.city,
    tags: [...a.tags].sort(),
    sourceUrl: a.sourceUrl,
    updatedAt: a.updatedAt,
  };
  return { ...base, id: chunkId(base.lawName, base.articleNo, base.scope), contentHash: hashOf(base) };
}

export interface ChangeReport {
  added: KbChunk[];
  modified: KbChunk[];
  deleted: string[];
  unchanged: number;
}

/** 比對現有資料（id → contentHash）與新 chunks */
export function diffChunks(existing: Map<string, string>, chunks: KbChunk[]): ChangeReport {
  const seen = new Set<string>();
  const report: ChangeReport = { added: [], modified: [], deleted: [], unchanged: 0 };
  for (const c of chunks) {
    if (seen.has(c.id)) throw new Error(`重複的條文：${c.lawName} ${c.article}（${c.scope}）`);
    seen.add(c.id);
    const old = existing.get(c.id);
    if (old === undefined) report.added.push(c);
    else if (old !== c.contentHash) report.modified.push(c);
    else report.unchanged++;
  }
  for (const id of existing.keys()) if (!seen.has(id)) report.deleted.push(id);
  return report;
}

export function formatReport(r: ChangeReport): string {
  const line = (c: KbChunk) => `  ${c.lawName} ${c.article}${c.scope === "national" ? "" : `（${c.scope}）`}`;
  return [
    `新增 ${r.added.length} 條、修改 ${r.modified.length} 條、刪除 ${r.deleted.length} 條、未變動 ${r.unchanged} 條`,
    ...(r.added.length ? ["新增：", ...r.added.map(line)] : []),
    ...(r.modified.length ? ["修改：", ...r.modified.map(line)] : []),
    ...(r.deleted.length ? ["刪除（文件 ID）：", ...r.deleted.map((id) => `  ${id}`)] : []),
  ].join("\n");
}
