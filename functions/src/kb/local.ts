import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { normalizeCity } from "../cities.js";
import { normalizeArticleNo } from "./articleNo.js";
import type { LocalArticle } from "./chunks.js";

/**
 * kb/local/*.md 格式：
 *
 * ---
 * city: 新北市
 * lawName: 新北市火災預防自治條例
 * sourceUrl: https://（官方法規網址）
 * checkedAt: 2026-11-12          # 查證日期
 * updatedAt: 2026-06-01          # 法規最後修正日期
 * status: verified               # verified 才會匯入；pending＝待查
 * tags: [火災, 住警器]
 * ---
 *
 * ## 第 5 條
 * （逐字貼上官方條文）
 */
const frontmatter = z.object({
  city: z.string(),
  lawName: z.string(),
  sourceUrl: z.url().optional(),
  checkedAt: z.string(),
  updatedAt: z.string(),
  status: z.enum(["verified", "pending"]),
  tags: z.array(z.string()).default([]),
});

export interface LocalFile {
  status: "verified" | "pending";
  articles: LocalArticle[];
}

export function parseLocalMarkdown(md: string, fileName = "?"): LocalFile {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`${fileName}：缺少 frontmatter`);
  const fmRaw = parseYaml(m[1]!) as Record<string, unknown>;
  // YAML 會把日期解析成 Date，轉回字串
  for (const k of ["checkedAt", "updatedAt"]) {
    const v = fmRaw[k];
    if (v instanceof Date) fmRaw[k] = v.toISOString().slice(0, 10);
  }
  const fm = frontmatter.parse(fmRaw);
  const city = normalizeCity(fm.city);
  if (!city) throw new Error(`${fileName}：無法辨識縣市 ${fm.city}`);
  if (fm.status === "pending") return { status: "pending", articles: [] };
  if (!fm.sourceUrl) throw new Error(`${fileName}：verified 必須有 sourceUrl`);
  const sourceUrl = fm.sourceUrl;

  const articles: LocalArticle[] = [];
  const sections = m[2]!.split(/^##\s+/m).slice(1);
  for (const sec of sections) {
    const [heading = "", ...rest] = sec.split("\n");
    const articleNo = normalizeArticleNo(heading.trim());
    if (!articleNo) throw new Error(`${fileName}：無法解析條號「${heading}」`);
    const text = rest.join("\n").trim();
    if (!text) throw new Error(`${fileName}：第 ${articleNo} 條沒有內容`);
    articles.push({
      lawName: fm.lawName,
      articleNo,
      text,
      city,
      sourceUrl,
      updatedAt: fm.updatedAt,
      tags: fm.tags,
    });
  }
  if (articles.length === 0) throw new Error(`${fileName}：verified 但沒有條文`);
  return { status: fm.status, articles };
}
