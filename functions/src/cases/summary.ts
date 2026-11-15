import { REQUIRED_ARTICLES } from "../ai/scenario.js";
import type { KbIndex } from "../ai/retrieve.js";
import type { QaRecord } from "../ai/qaLog.js";
import { loadReferrals, type Referral } from "../ai/referral.js";
import { CASES, DISCLAIMER } from "../config.js";
import { CATEGORIES, TYPE_LABEL, taiwanDateTime, type StoredEvidence } from "../evidence/model.js";
import { maskPii } from "../lease/pii.js";
import type { LandlordType } from "../users.js";
import { fireAlarmRule } from "../viewing/fireRule.js";
import { allSteps, STAGE_LABEL, type Flow } from "./flows.js";
import type { StoredCase } from "./repo.js";

export const LANDLORD_LABEL: Record<LandlordType, string> = {
  individual: "個人房東",
  business: "業者（包租代管、二房東業者）",
  unknown: "不確定",
};

export interface SummaryArticle {
  lawName: string;
  articleNo: string;
  text: string;
  sourceUrl: string;
  scope: string;
}

/** 一頁案件摘要（SPEC 11）。只整理事實與官方條文，不寫勝敗評估、不估算金額 */
export interface CaseSummary {
  generatedAt: string;
  scenario: string;
  scenarioLabel: string;
  facts: { occurredOn: string | null; city: string | null; landlord: string; story: string };
  timeline: Array<{ at: string; text: string }>;
  evidence: Array<{ id: string; occurredAt: string; type: string; category: string; text: string; sha256: string }>;
  articles: SummaryArticle[];
  wants: string[];
  missing: string[];
  referrals: Array<{ name: string; contact: string; hours: string | null; note: string }>;
  disclaimer: string;
}

/**
 * 相關條文：情境必帶條文（SPEC 5.3）＋ 問答中通過 citeCheck 的引用；
 * 一律從知識庫（官方原文）取文字，查不到的不列。火災另附當地住警器規定。
 */
export async function caseArticles(
  kb: KbIndex,
  scenario: StoredCase["scenario"],
  city: string | null,
  qa: Array<Pick<QaRecord, "scenario" | "citations" | "citeCheck">> = [],
): Promise<SummaryArticle[]> {
  const wanted = [...REQUIRED_ARTICLES[scenario]];
  for (const q of qa) {
    if (q.scenario !== scenario || !q.citeCheck?.finalOk || q.citeCheck.degraded) continue;
    wanted.push(...q.citations);
  }
  const seen = new Set<string>();
  const out: SummaryArticle[] = [];
  for (const w of wanted) {
    const k = `${w.lawName}|${w.articleNo}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const c = await kb.byArticle(w.lawName, w.articleNo, "national");
    if (c) out.push({ lawName: c.lawName, articleNo: c.articleNo, text: c.text, sourceUrl: c.sourceUrl, scope: "national" });
  }
  if (scenario === "fire" && city) {
    const rule = await fireAlarmRule(kb, city);
    for (const a of rule.local) out.push({ ...a, scope: city });
  }
  return out;
}

/** 轉介：情境預設的單位；房東是業者時加上消費者服務專線 1950，不是業者就不列（SPEC 11） */
export function caseReferrals(flow: Flow, landlordType: LandlordType): Referral[] {
  const ids = [...flow.referrals.filter((id) => id !== "consumer"), ...(landlordType === "business" ? (["consumer"] as const) : [])];
  const all = loadReferrals();
  return ids.flatMap((id) => all.filter((r) => r.id === id));
}

export function buildCaseSummary(args: {
  c: StoredCase;
  flow: Flow;
  evidence: StoredEvidence[];
  qa: Array<QaRecord & { createdAt: Date }>;
  articles: SummaryArticle[];
  now: Date;
}): CaseSummary {
  const { c, flow, now } = args;
  const a = c.answers;
  const steps = allSteps(flow);
  const done = new Set(c.checklistDone);

  const evidence = [...args.evidence].sort((x, y) => x.occurredAt.getTime() - y.occurredAt.getTime()).slice(0, CASES.evidenceMax);
  const qa = args.qa.filter((q) => q.scenario === c.scenario && q.createdAt.getTime() >= c.createdAt.getTime()).slice(0, CASES.qaMax);

  const timeline: Array<{ t: number; text: string }> = [];
  if (a.occurredOn) timeline.push({ t: Date.parse(`${a.occurredOn}T00:00:00+08:00`), text: `發生${flow.label}` });
  for (const e of evidence) {
    timeline.push({ t: e.occurredAt.getTime(), text: `存證：${TYPE_LABEL[e.type]}${e.text ? `「${e.text}」` : ""}` });
  }
  for (const s of steps) {
    const at = c.doneAt[s.key];
    if (done.has(s.key) && at && s.item.link !== "/case") timeline.push({ t: Date.parse(at), text: `完成：${s.item.text}` });
  }
  for (const q of qa) timeline.push({ t: q.createdAt.getTime(), text: `詢問租安心：${clip(maskPii(q.question), 60)}` });
  timeline.sort((x, y) => x.t - y.t);

  const missing: string[] = [];
  if (!a.occurredOn) missing.push("發生日期");
  if (!a.city) missing.push("租屋處所在縣市");
  if (a.landlordType === "unknown") missing.push("房東是個人還是業者");
  if (!a.story.trim()) missing.push("事情經過");
  if (a.wants.length === 0) missing.push("你希望的結果");
  if (evidence.length === 0) missing.push("還沒有加入任何證據（照片、對話紀錄、收據）");
  for (const s of steps) if (s.item.key && !done.has(s.key)) missing.push(`${STAGE_LABEL[s.stage]}：${s.item.text}`);

  const referrals = caseReferrals(flow, a.landlordType).map((r) => ({ name: r.name, contact: r.contact, hours: r.hours, note: r.note }));

  return {
    generatedAt: now.toISOString(),
    scenario: c.scenario,
    scenarioLabel: flow.label,
    facts: { occurredOn: a.occurredOn, city: a.city, landlord: LANDLORD_LABEL[a.landlordType], story: a.story },
    timeline: timeline.map((x) => ({ at: new Date(x.t).toISOString(), text: x.text })),
    evidence: evidence.map((e) => ({
      id: e.id,
      occurredAt: e.occurredAt.toISOString(),
      type: TYPE_LABEL[e.type],
      category: CATEGORIES[e.category],
      text: e.text,
      sha256: e.sha256,
    })),
    articles: args.articles,
    wants: a.wants,
    missing,
    referrals,
    disclaimer: DISCLAIMER,
  };
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

const twDate = (iso: string) => taiwanDateTime(new Date(iso));

/** 可複製的純文字版（打電話、傳訊息給法扶或調解委員時用） */
export function summaryText(s: CaseSummary): string {
  const lines: string[] = [];
  const sec = (title: string) => lines.push("", `【${title}】`);
  lines.push(`租屋案件摘要：${s.scenarioLabel}`, `產生時間：${twDate(s.generatedAt)}（台灣時間）`);
  sec("基本事實");
  lines.push(`發生日期：${s.facts.occurredOn ?? "未填"}`, `縣市：${s.facts.city ?? "未填"}`, `房東：${s.facts.landlord}`);
  if (s.facts.story) lines.push(`經過：${s.facts.story}`);
  sec("時間軸");
  if (s.timeline.length === 0) lines.push("（尚無）");
  for (const t of s.timeline) lines.push(`${twDate(t.at)}\u3000${t.text}`);
  sec("已有證據");
  if (s.evidence.length === 0) lines.push("（尚無）");
  s.evidence.forEach((e, i) => lines.push(`${i + 1}. ${twDate(e.occurredAt)} ${e.type}・${e.category}${e.text ? `：${e.text}` : ""}（SHA-256 ${e.sha256.slice(0, 16)}…）`));
  sec("可能相關條文（全國法規資料庫）");
  if (s.articles.length === 0) lines.push("（待查）");
  for (const a of s.articles) lines.push(`${a.lawName} 第 ${a.articleNo} 條：${a.sourceUrl}`);
  sec("我希望的結果");
  lines.push(s.wants.length ? s.wants.join("、") : "（未填）");
  if (s.missing.length) {
    sec("尚缺資料");
    for (const m of s.missing) lines.push(`・${m}`);
  }
  lines.push("", s.disclaimer);
  return lines.join("\n");
}
