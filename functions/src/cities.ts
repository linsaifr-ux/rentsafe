/** 歡迎卡 Quick Reply 的縣市選項（SPEC 4.1）。value 存進 users.city，null 代表「其他／未設定」 */
export const CITY_OPTIONS: ReadonlyArray<{ label: string; value: string | null }> = [
  { label: "臺北", value: "臺北市" },
  { label: "新北", value: "新北市" },
  { label: "桃園", value: "桃園市" },
  { label: "臺中", value: "臺中市" },
  { label: "臺南", value: "臺南市" },
  { label: "高雄", value: "高雄市" },
  { label: "其他", value: null },
];

/** 全台 22 縣市，供 LIFF 設定頁選擇 */
export const ALL_CITIES = [
  "臺北市", "新北市", "桃園市", "臺中市", "臺南市", "高雄市",
  "基隆市", "新竹市", "嘉義市",
  "新竹縣", "苗栗縣", "彰化縣", "南投縣", "雲林縣", "嘉義縣", "屏東縣",
  "宜蘭縣", "花蓮縣", "臺東縣", "澎湖縣", "金門縣", "連江縣",
] as const;

export type City = (typeof ALL_CITIES)[number];

/** 把常見寫法（台北、台北市、臺北）正規化成正式名稱；認不得回傳 null */
export function normalizeCity(input: string | null | undefined): City | null {
  if (!input) return null;
  const s = input.trim().replace(/台/g, "臺");
  for (const c of ALL_CITIES) {
    if (s === c || s === c.slice(0, -1)) return c;
  }
  return null;
}
