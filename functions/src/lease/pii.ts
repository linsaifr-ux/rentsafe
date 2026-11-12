/**
 * 個資遮蔽（SPEC 8.1）。租約抽取結果在送語意比對、存檔、顯示之前一律先經過這裡。
 *
 * 遮蔽：身分證字號、手機與市話、門牌號碼（路／街之後到「號」「樓」的數字）、帳號等長數字串、
 *       當事人姓名（模型抽出的姓名＋「出租人：」「承租人：」後面的名字）。
 */

export const MASK = {
  id: "〔身分證字號〕",
  phone: "〔電話〕",
  account: "〔帳號〕",
  name: "〔姓名〕",
  number: "○",
} as const;

const ID_RE = /[A-Z][12]\d{8}/g;
const MOBILE_RE = /09\d{2}-?\d{3}-?\d{3}/g;
/** 市話：前後不能接數字或連字號（避免吃掉帳號的一部分） */
const LANDLINE_RE = /(?<![\d-])\(?0\d{1,2}\)?[-\s]?\d{3,4}-?\d{4}(?![\d-])/g;
/** 10 位以上連續數字（可含 - 或空白）：銀行帳號、統一編號以外的長號碼 */
const LONG_NUMBER_RE = /\d(?:[\d-\s]{8,})\d/g;
/** 地址片段：路／街／大道 之後到「號」（可再接樓、室），中間不跨標點 */
const ADDRESS_RE = /(?:路|街|大道)[^，,。；;\n]{0,30}?號(?:[^，,。；;\n]{0,12}?(?:樓|室))?/g;
/** 地址片段內的數字（阿拉伯或國字） */
const DIGITS_RE = /[0-9０-９]+|[一二三四五六七八九十百]+(?=\s*(?:巷|弄|號|樓|室|之|鄰))/g;
/** 「出租人：王小明」這類標示後的姓名（2–4 個中文字） */
const LABELED_NAME_RE = /((?:出租人|承租人|房東|房客|甲方|乙方|立契約書人|保證人|連帶保證人|姓名|戶名)\s*[（(]?[甲乙]?方?[)）]?\s*[:：]\s*)([一-鿿]{2,4})/g;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 遮蔽一段文字。names：另外已知的姓名（例如模型抽出的當事人） */
export function maskPii(text: string, names: string[] = []): string {
  let out = text.replace(ID_RE, MASK.id).replace(MOBILE_RE, MASK.phone);
  out = out.replace(LABELED_NAME_RE, (_m, label: string) => `${label}${MASK.name}`);
  for (const n of [...new Set(names.map((x) => x.trim()))].filter((x) => x.length >= 2).sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(escapeRe(n), "g"), MASK.name);
  }
  out = out.replace(LANDLINE_RE, (m) => (m.replace(/\D/g, "").length >= 9 ? MASK.phone : m));
  out = out.replace(LONG_NUMBER_RE, (m) => (m.replace(/\D/g, "").length >= 10 ? MASK.account : m));
  out = out.replace(ADDRESS_RE, (addr) => addr.replace(DIGITS_RE, MASK.number));
  return out;
}

/** 深度遮蔽物件裡所有字串（數字不動） */
export function maskDeep<T>(value: T, names: string[] = []): T {
  if (typeof value === "string") return maskPii(value, names) as T;
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, names)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v, names)])) as T;
  }
  return value;
}
