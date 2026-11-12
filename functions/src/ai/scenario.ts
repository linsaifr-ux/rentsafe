/** 問答情境（SPEC 3、5.3） */
export const SCENARIOS = [
  "fire",
  "leak",
  "no_repair",
  "deposit",
  "early_termination",
  "sold_house",
  "rent_arrears",
  "other",
] as const;
export type Scenario = (typeof SCENARIOS)[number];

export const SCENARIO_LABEL: Record<Scenario, string> = {
  fire: "火災",
  leak: "漏水",
  no_repair: "房東不修繕",
  deposit: "押金",
  early_termination: "提前解約",
  sold_house: "房屋被賣",
  rent_arrears: "欠租",
  other: "其他",
};

/**
 * 情境必帶條文（SPEC 5.3 表）。確保檢索不漏。
 * 「該縣市住警器規定」由 retrieve 依 city 另外帶入 scope=city 的 chunk。
 * 「定型化契約相關條目」待 kb/contract-rules.yaml（Phase 5）建立後補上。
 */
export const REQUIRED_ARTICLES: Record<Scenario, Array<{ lawName: string; articleNo: string }>> = {
  fire: [
    { lawName: "民法", articleNo: "423" },
    { lawName: "民法", articleNo: "424" },
    { lawName: "民法", articleNo: "434" },
    { lawName: "消防法", articleNo: "6" },
  ],
  no_repair: [
    { lawName: "民法", articleNo: "423" },
    { lawName: "民法", articleNo: "429" },
    { lawName: "民法", articleNo: "430" },
  ],
  leak: [
    { lawName: "民法", articleNo: "423" },
    { lawName: "民法", articleNo: "429" },
    { lawName: "民法", articleNo: "430" },
  ],
  deposit: [{ lawName: "租賃住宅市場發展及管理條例", articleNo: "7" }],
  early_termination: [
    { lawName: "民法", articleNo: "450" },
    { lawName: "民法", articleNo: "453" },
  ],
  sold_house: [{ lawName: "民法", articleNo: "425" }],
  rent_arrears: [{ lawName: "民法", articleNo: "440" }],
  other: [],
};
