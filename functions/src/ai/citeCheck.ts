/**
 * 引用驗證（SPEC 5.3）——核心元件，改動前要先告知專案負責人。
 *
 * 規則：
 * 1. 每個 citation 的 (lawName, articleNo) 必須存在於本次檢索結果中。
 * 2. quote 必須是該條文 text 的子字串（比對前移除全形／半形空白與換行）；quote 不得為空。
 * 3. summary 與 actions 內出現的「第 X 條」必須能對應到「通過驗證」的 citations。
 *    - 阿拉伯數字（含全形）：SPEC 指定的正則 第\s*([0-9０-９]+(?:之[0-9０-９]+|-[0-9]+)?)\s*條
 *    - 另外也檢查國字條號（第四百二十四條），避免繞過檢查。
 * 4. 任一條不通過 → 驗證失敗。
 */
import { normalizeArticleNo, toHalfWidthDigits } from "../kb/articleNo.js";

export interface Citation {
  lawName: string;
  articleNo: string;
  quote: string;
}

export interface SourceArticle {
  lawName: string;
  articleNo: string;
  text: string;
}

export interface AnswerForCheck {
  summary: string;
  citations: Citation[];
  actions: string[];
}

export type CiteError =
  | { type: "not_retrieved"; index: number; citation: Citation }
  | { type: "empty_quote"; index: number; citation: Citation }
  | { type: "quote_mismatch"; index: number; citation: Citation }
  | { type: "unbacked_reference"; field: "summary" | "actions"; ref: string; articleNo: string };

export interface CiteCheckResult {
  ok: boolean;
  errors: CiteError[];
  /** 通過驗證的 citations（articleNo 已正規化） */
  valid: Citation[];
  /** 沒通過驗證的 citations 的索引 */
  invalidIndexes: number[];
}

/** SPEC 5.3 規則 3 指定的正則 */
export const ARTICLE_REF_RE = /第\s*([0-9０-９]+(?:之[0-9０-９]+|-[0-9]+)?)\s*條/g;

/** 國字條號：第四百二十四條、第六條之一 */
const CN_ARTICLE_REF_RE = /第\s*([零〇一二三四五六七八九十百千兩]+)\s*條(?:\s*之\s*([零〇一二三四五六七八九十兩]+))?/g;

const CN_DIGIT: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** 國字數字轉阿拉伯數字（支援到千位）；格式不合回傳 null */
export function chineseToNumber(s: string): number | null {
  let total = 0;
  let digit: number | null = null;
  for (const ch of s) {
    if (ch in CN_DIGIT) {
      digit = CN_DIGIT[ch]!;
    } else if (ch in CN_UNIT) {
      total += (digit ?? 1) * CN_UNIT[ch]!;
      digit = null;
    } else {
      return null;
    }
  }
  return total + (digit ?? 0);
}

/** 移除全形／半形空白與換行 */
export function stripSpaces(s: string): string {
  return s.replace(/[\s\u3000]+/g, "");
}

function lawKey(lawName: string, articleNo: string): string {
  return `${stripSpaces(lawName)}|${articleNo}`;
}

/** 找出文字中所有條號引用（回傳原文片段與正規化條號） */
export function findArticleRefs(text: string): Array<{ ref: string; articleNo: string }> {
  const out: Array<{ ref: string; articleNo: string }> = [];
  for (const m of text.matchAll(ARTICLE_REF_RE)) {
    const no = normalizeArticleNo(toHalfWidthDigits(m[1]!));
    if (no) out.push({ ref: m[0], articleNo: no });
  }
  for (const m of text.matchAll(CN_ARTICLE_REF_RE)) {
    const main = chineseToNumber(m[1]!);
    const sub = m[2] ? chineseToNumber(m[2]) : null;
    if (main === null || (m[2] && sub === null)) continue;
    out.push({ ref: m[0], articleNo: sub ? `${main}-${sub}` : String(main) });
  }
  return out;
}

export function citeCheck(answer: AnswerForCheck, sources: SourceArticle[]): CiteCheckResult {
  const byKey = new Map<string, SourceArticle>();
  for (const s of sources) {
    const no = normalizeArticleNo(s.articleNo);
    if (no) byKey.set(lawKey(s.lawName, no), s);
  }

  const errors: CiteError[] = [];
  const valid: Citation[] = [];
  const invalidIndexes: number[] = [];

  answer.citations.forEach((citation, index) => {
    const no = normalizeArticleNo(citation.articleNo);
    const src = no ? byKey.get(lawKey(citation.lawName, no)) : undefined;
    if (!src || !no) {
      errors.push({ type: "not_retrieved", index, citation });
      invalidIndexes.push(index);
      return;
    }
    const quote = stripSpaces(citation.quote);
    if (!quote) {
      errors.push({ type: "empty_quote", index, citation });
      invalidIndexes.push(index);
      return;
    }
    if (!stripSpaces(src.text).includes(quote)) {
      errors.push({ type: "quote_mismatch", index, citation });
      invalidIndexes.push(index);
      return;
    }
    valid.push({ lawName: src.lawName, articleNo: no, quote: citation.quote });
  });

  const citedNos = new Set(valid.map((c) => c.articleNo));
  const checkField = (field: "summary" | "actions", text: string) => {
    for (const { ref, articleNo } of findArticleRefs(text)) {
      if (!citedNos.has(articleNo)) errors.push({ type: "unbacked_reference", field, ref, articleNo });
    }
  };
  checkField("summary", answer.summary);
  for (const a of answer.actions) checkField("actions", a);

  return { ok: errors.length === 0, errors, valid, invalidIndexes };
}

export const UNVERIFIED_NOTE = "部分內容未能對應條文，請洽專業人士確認。";

/**
 * 重試仍失敗時的降級處理（SPEC 5.1）：
 * 移除未驗證的 citations；summary／actions 中對不上的條號改成「相關規定」；末尾加註。
 */
export function stripUnverified<T extends AnswerForCheck>(answer: T, result: CiteCheckResult): T & { note: string | null } {
  if (result.ok) return { ...answer, citations: result.valid, note: null };
  const citedNos = new Set(result.valid.map((c) => c.articleNo));
  const scrub = (text: string) => {
    let out = text;
    for (const { ref, articleNo } of findArticleRefs(text)) {
      if (!citedNos.has(articleNo)) out = out.split(ref).join("相關規定");
    }
    return out;
  };
  return {
    ...answer,
    summary: scrub(answer.summary),
    actions: answer.actions.map(scrub),
    citations: result.valid,
    note: UNVERIFIED_NOTE,
  };
}
