/**
 * 要匯入知識庫的法規清單（SPEC 6.1）。
 *
 * 資料來源：全國法規資料庫開放資料 API
 *   https://law.moj.gov.tw/api/ch/law/json （zip，內含 ChLaw.json，所有中央法律）
 * pcode 均由 2026-11-12 下載的官方資料比對 LawName 與 LawURL 取得，不是憑記憶填寫。
 */

export const LAW_DATA_URL = "https://law.moj.gov.tw/api/ch/law/json";

export interface LawSource {
  lawName: string;
  pcode: string;
  /** 只匯入這個範圍的條號（含頭尾）；未設定＝全部條文 */
  range?: { from: string; to: string };
  /** 只匯入列出的條號；與 range 擇一 */
  only?: string[];
  note: string;
}

export const LAW_SOURCES: LawSource[] = [
  {
    lawName: "民法",
    pcode: "B0000001",
    range: { from: "421", to: "463-1" },
    note: "債編各論 第五節 租賃",
  },
  {
    lawName: "租賃住宅市場發展及管理條例",
    pcode: "D0060125",
    note: "租賃專法，全條",
  },
  {
    lawName: "消防法",
    pcode: "D0120001",
    only: ["6"],
    note: "住宅用火災警報器設置義務",
  },
  {
    lawName: "鄉鎮市調解條例",
    pcode: "I0020003",
    note: "調解程序；條文少，全條匯入（SPEC 寫重點條文，待法律背景成員確認是否縮減）",
  },
];

export function lawUrl(pcode: string): string {
  return `https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=${pcode}`;
}

export function articleUrl(pcode: string, articleNo: string): string {
  return `https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=${pcode}&flno=${encodeURIComponent(articleNo)}`;
}
