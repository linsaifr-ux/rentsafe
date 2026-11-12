import { z } from "zod";
import { compareArticleNo, normalizeArticleNo } from "./articleNo.js";
import { lawUrl, type LawSource } from "./sources.js";

/** 全國法規資料庫 ChLaw.json 的格式（只驗證用到的欄位） */
const rawArticle = z.object({
  ArticleType: z.string(),
  ArticleNo: z.string(),
  ArticleContent: z.string(),
});
const rawLaw = z
  .object({
    LawName: z.string(),
    LawURL: z.string(),
    LawModifiedDate: z.string(),
    LawAbandonNote: z.string().optional().nullable(),
    LawArticles: z.array(rawArticle),
  })
  .loose();
export const rawLawFile = z.object({ UpdateDate: z.string(), Laws: z.array(rawLaw) });
export type RawLawFile = z.infer<typeof rawLawFile>;

/** 存在 kb/laws/{pcode}.json 的格式（進版本控制） */
export const lawFileSchema = z.object({
  lawName: z.string(),
  pcode: z.string(),
  sourceUrl: z.string(),
  /** 法規最後異動日期 YYYY-MM-DD */
  modifiedDate: z.string(),
  /** 官方資料檔的更新時間（原字串） */
  dataUpdateDate: z.string(),
  fetchedAt: z.string(),
  articles: z.array(
    z.object({
      articleNo: z.string(),
      article: z.string(),
      chapter: z.string().nullable(),
      text: z.string(),
    }),
  ),
});
export type LawFile = z.infer<typeof lawFileSchema>;

function formatDate(yyyymmdd: string): string {
  const m = yyyymmdd.match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : yyyymmdd;
}

/** 條文內容正規化：統一換行，去掉頭尾空白；不改動任何文字（引用驗證要逐字比對） */
export function normalizeText(s: string): string {
  return s.replace(/\r\n?/g, "\n").trim();
}

function inScope(articleNo: string, src: LawSource): boolean {
  if (src.only) return src.only.includes(articleNo);
  if (src.range) {
    return compareArticleNo(articleNo, src.range.from) >= 0 && compareArticleNo(articleNo, src.range.to) <= 0;
  }
  return true;
}

/** 從官方資料取出一部法規的指定條文 */
export function extractLaw(data: RawLawFile, src: LawSource, fetchedAt: string): LawFile {
  const law = data.Laws.find((l) => l.LawName === src.lawName);
  if (!law) throw new Error(`官方資料找不到法規：${src.lawName}`);
  if (!law.LawURL.includes(`pcode=${src.pcode}`)) {
    throw new Error(`${src.lawName} 的 pcode 不符：預期 ${src.pcode}，官方網址 ${law.LawURL}`);
  }
  if (law.LawAbandonNote && law.LawAbandonNote.trim()) {
    throw new Error(`${src.lawName} 已廢止：${law.LawAbandonNote}`);
  }

  const articles: LawFile["articles"] = [];
  let chapter: string | null = null;
  for (const a of law.LawArticles) {
    if (a.ArticleType === "C") {
      chapter = a.ArticleContent.replace(/\s+/g, " ").trim();
      continue;
    }
    if (a.ArticleType !== "A") continue;
    const articleNo = normalizeArticleNo(a.ArticleNo);
    if (!articleNo) throw new Error(`${src.lawName} 無法解析條號：${a.ArticleNo}`);
    if (!inScope(articleNo, src)) continue;
    articles.push({ articleNo, article: `第 ${articleNo} 條`, chapter, text: normalizeText(a.ArticleContent) });
  }
  if (articles.length === 0) throw new Error(`${src.lawName} 沒有符合範圍的條文`);
  if (src.only) {
    const missing = src.only.filter((n) => !articles.some((a) => a.articleNo === n));
    if (missing.length) throw new Error(`${src.lawName} 找不到條文：${missing.join(", ")}`);
  }

  return {
    lawName: src.lawName,
    pcode: src.pcode,
    sourceUrl: lawUrl(src.pcode),
    modifiedDate: formatDate(law.LawModifiedDate),
    dataUpdateDate: data.UpdateDate,
    fetchedAt,
    articles,
  };
}
