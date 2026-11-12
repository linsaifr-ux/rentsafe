/**
 * 條號工具。內部一律用「424」「6-1」這種格式（articleNo），
 * 顯示用「第 424 條」「第 6-1 條」（article）。
 */

const FULLWIDTH_DIGITS = /[０-９]/g;

export function toHalfWidthDigits(s: string): string {
  return s.replace(FULLWIDTH_DIGITS, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
}

/**
 * 把各種寫法正規化成 articleNo：
 * 「第 424 條」「第424條」「424」「第 6-1 條」「第6條之1」「6之1」「第４２４條」→ "424" / "6-1"
 * 無法辨識回傳 null。
 */
export function normalizeArticleNo(input: string): string | null {
  const s = toHalfWidthDigits(input).replace(/\s+/g, "");
  const m = s.match(/^(?:第)?(\d+)(?:(?:-|之)(\d+))?(?:條)?(?:之(\d+))?$/);
  if (!m) return null;
  const sub = m[2] ?? m[3];
  return sub ? `${Number(m[1])}-${Number(sub)}` : String(Number(m[1]));
}

export function displayArticle(articleNo: string): string {
  return `第 ${articleNo} 條`;
}

/** 比較兩個條號的先後（"6" < "6-1" < "7"） */
export function compareArticleNo(a: string, b: string): number {
  const [a1 = 0, a2 = 0] = a.split("-").map(Number);
  const [b1 = 0, b2 = 0] = b.split("-").map(Number);
  return a1 - b1 || a2 - b2;
}
