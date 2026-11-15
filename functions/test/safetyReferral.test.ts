import { describe, expect, it } from "vitest";
import { decideReferral, loadReferrals, parseAmountTWD, type ReferralInput } from "../src/ai/referral.js";
import { detectEmergency } from "../src/ai/safety.js";

describe("detectEmergency", () => {
  it.each([
    ["救命！房間裡都是煙", "fire"],
    ["現在隔壁著火了怎麼辦", "fire"],
    ["樓下正在冒煙", "fire"],
    ["房間燒起來了", "fire"],
    ["我聞到瓦斯味", "fire"],
    ["室友昏倒了", "injury"],
    ["剛剛熱水器漏氣我頭好暈好像一氧化碳中毒", "injury"],
    ["房東拿刀在門口", "threat"],
    ["房東現在在門口威脅我", "threat"],
    ["我現在被鎖在門外", "locked_out"],
    ["房東剛剛把鎖換了我進不去", "locked_out"],
    ["火災了！", "fire"],
    ["上個月失火，剛剛又冒煙了", "fire"],
    ["之前失火過，現在一直有燒焦味", "fire"],
  ])("緊急：%s", (text, kind) => {
    expect(detectEmergency(text)).toEqual({ emergency: true, kind });
  });

  it.each([
    "上個月租屋處失火，房東要我賠償",
    "我打前陣子發生火災了，現在房子不能住，房東應該要讓房客在租約內住在飯店並支付所有費用嗎？",
    "昨天租屋處失火，現在不能住，租金還要繳嗎",
    "火災之後押金可以拿回來嗎",
    "火災是房客的責任嗎",
    "天花板漏水房東都不修",
    "押金可以收幾個月？",
    "房東說要換鎖，這樣可以嗎",
    "之前房東威脅要扣押金，這合法嗎",
    "提前解約要付多少違約金",
    "第一次租屋要注意什麼",
  ])("非緊急：%s", (text) => {
    expect(detectEmergency(text).emergency).toBe(false);
  });
});

describe("parseAmountTWD", () => {
  it.each([
    ["押金 3萬 不還", 30_000],
    ["押金三萬", 30_000],
    ["押金 1.5 萬", 15_000],
    ["押金25000元", 25_000],
    ["押金 25,000", 25_000],
    ["租金一萬二押金兩萬四", 24_000], // 取最大
    ["押金兩萬", 20_000],
    ["押金兩個月", null],
  ])("%s → %s", (text, amount) => {
    expect(parseAmountTWD(text)).toBe(amount);
  });
});

describe("decideReferral", () => {
  const base: ReferralInput = {
    scenario: "other",
    asksOutcome: false,
    landlordType: "unknown",
    question: "",
    modelReferTo: [],
    confidence: "high",
  };

  it("一般問題、信心高 → 不轉介", () => {
    expect(decideReferral(base)).toEqual({ refer: false, reasons: [], ids: [] });
  });

  it("問勝敗或賠多少 → 轉介法扶", () => {
    const d = decideReferral({ ...base, asksOutcome: true });
    expect(d.refer).toBe(true);
    expect(d.ids).toContain("legal_aid");
    expect(d.reasons).toContain("asks_outcome");
  });

  it("火災、提前終止屬高風險 → 轉介", () => {
    expect(decideReferral({ ...base, scenario: "fire" }).refer).toBe(true);
    expect(decideReferral({ ...base, scenario: "early_termination" }).ids).toEqual(["legal_aid", "mediation"]);
  });

  it("押金超過 2 萬才轉介", () => {
    expect(decideReferral({ ...base, scenario: "deposit", question: "押金兩萬" }).refer).toBe(false);
    expect(decideReferral({ ...base, scenario: "deposit", question: "押金 3 萬不還" }).reasons).toContain("deposit_over_threshold");
  });

  it("信心低 → 轉介", () => {
    expect(decideReferral({ ...base, confidence: "low" }).reasons).toEqual(["low_confidence"]);
  });

  it("房東是業者時加上 1950", () => {
    expect(decideReferral({ ...base, asksOutcome: true, landlordType: "business" }).ids).toEqual(["legal_aid", "consumer"]);
  });

  it("符合轉介條件時採納模型建議，但忽略未知代號與 emergency", () => {
    expect(decideReferral({ ...base, asksOutcome: true, modelReferTo: ["tmm", "none", "hacker", "emergency"] }).ids).toEqual([
      "legal_aid",
      "tmm",
    ]);
  });

  it("不符合轉介條件時，模型建議轉介也不轉介", () => {
    expect(decideReferral({ ...base, modelReferTo: ["tmm", "dispute_board"] })).toEqual({ refer: false, reasons: [], ids: [] });
  });
});

describe("referrals.yaml", () => {
  it("格式正確，包含 SPEC 11 的六個單位", () => {
    expect(loadReferrals().map((r) => r.id)).toEqual(["legal_aid", "tmm", "mediation", "dispute_board", "consumer", "emergency"]);
  });
});
