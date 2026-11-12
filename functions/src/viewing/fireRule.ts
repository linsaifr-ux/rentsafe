import type { KbIndex } from "../ai/retrieve.js";
import { compareArticleNo } from "../kb/articleNo.js";

/** 住警器規定的一條條文（全部來自 kb_chunks，也就是 kb/ 的官方原文） */
export interface FireRuleArticle {
  lawName: string;
  articleNo: string;
  text: string;
  sourceUrl: string;
}

export interface FireAlarmRule {
  city: string | null;
  /** 全國規定：消防法第 6 條 */
  national: FireRuleArticle | null;
  /** 當地自治條例；縣市資料待查時為空陣列 */
  local: FireRuleArticle[];
  /** 當地規定待查時的提醒（SPEC 6.3） */
  note: string | null;
}

export const LOCAL_PENDING_NOTE = "這個縣市的住警器規定還在查證中，以下只列全國規定；詳細規定請洽當地消防局確認。";
export const NO_CITY_NOTE = "還沒選縣市，以下只列全國規定；選了縣市後會一併顯示當地規定。";

const toArticle = (c: { lawName: string; articleNo: string; text: string; sourceUrl: string }): FireRuleArticle => ({
  lawName: c.lawName,
  articleNo: c.articleNo,
  text: c.text,
  sourceUrl: c.sourceUrl,
});

/** 查詢全國與當地的住警器規定（SPEC 6.3、7） */
export async function fireAlarmRule(kb: KbIndex, city: string | null): Promise<FireAlarmRule> {
  const nat = await kb.byArticle("消防法", "6", "national");
  const local = city
    ? (await kb.byScope(city)).map(toArticle).sort((a, b) => a.lawName.localeCompare(b.lawName) || compareArticleNo(a.articleNo, b.articleNo))
    : [];
  return {
    city,
    national: nat ? toArticle(nat) : null,
    local,
    note: !city ? NO_CITY_NOTE : local.length === 0 ? LOCAL_PENDING_NOTE : null,
  };
}
