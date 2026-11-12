/**
 * F2 租約健檢主流程（SPEC 8.1）：
 * extract（模型讀圖）→ pii 遮蔽 → 數值規則 → 語意比對（只送遮蔽後條款，引文程式驗證）→ findings
 *
 * 原圖只在這個函式的參數裡（記憶體），不寫入任何儲存。
 */
import { stripSpaces } from "../ai/citeCheck.js";
import { generateJson, type Llm, type LlmFile } from "../ai/llm.js";
import {
  LEASE_EXTRACT_PROMPT_VERSION,
  LEASE_EXTRACT_SYSTEM,
  leaseExtractSchema,
  leaseExtractUserPrompt,
  type LeaseExtract,
} from "../ai/prompts/leaseExtract.v1.js";
import {
  LEASE_SEMANTIC_PROMPT_VERSION,
  LEASE_SEMANTIC_SYSTEM,
  leaseSemanticSchema,
  leaseSemanticUserPrompt,
} from "../ai/prompts/leaseSemantic.v1.js";
import { LAW_SOURCES, articleUrl } from "../kb/sources.js";
import { maskDeep } from "./pii.js";
import { semanticRules, type LeaseRule, type RuleBasis, type Ruleset } from "./ruleset.js";

export const LEASE_PROMPT_VERSION = `${LEASE_EXTRACT_PROMPT_VERSION}+${LEASE_SEMANTIC_PROMPT_VERSION}`;

/** 遮蔽後、可以存檔與顯示的欄位（不含姓名清單） */
export type MaskedFields = Omit<LeaseExtract, "partyNames" | "isLease">;

export interface BasisView {
  kind: "standard" | "law";
  /** 例：「內政部《住宅租賃定型化契約應記載及不得記載事項》應記載事項第五點」「民法第 427 條」 */
  label: string;
  /** 官方原文摘錄（standard 才有） */
  quote: string | null;
  url: string | null;
}

export interface Finding {
  ruleId: string;
  level: "red" | "yellow";
  title: string;
  explanation: string;
  /** 這份租約的具體情況，例如「押金約 3 個月租金」 */
  detail: string | null;
  /** 租約原文片段（已遮蔽，且經程式驗證確實出現在條款中） */
  quotes: string[];
  negotiate: string;
  basis: BasisView[];
}

export type LeaseCheckResult =
  | { status: "not_lease"; readability: LeaseExtract["readability"] }
  | {
      status: "ok";
      readability: LeaseExtract["readability"];
      fields: MaskedFields;
      findings: Finding[];
      /** 檢查過、沒發現問題的規則 */
      passed: Array<{ ruleId: string; title: string }>;
      /** 模型引文對不上條款而被丟棄的比對數（除錯用） */
      droppedMatches: number;
    };

export interface LeaseCheckDeps {
  llm: Llm;
}

const LEVEL_ORDER = { red: 0, yellow: 1 } as const;

function basisView(b: RuleBasis, rs: Ruleset): BasisView {
  if (b.kind === "standard") {
    return { kind: "standard", label: `${rs.standard.issuer}《${rs.standard.name}》${b.point}`, quote: b.quote, url: rs.standard.sourceUrl };
  }
  const src = LAW_SOURCES.find((s) => s.lawName === b.lawName);
  return { kind: "law", label: `${b.lawName}第 ${b.articleNo} 條`, quote: null, url: src ? articleUrl(src.pcode, b.articleNo) : null };
}

const fmt = (n: number) => n.toLocaleString("zh-TW");
const round1 = (n: number) => Math.round(n * 10) / 10;

/** 押金月數：有押金與月租金時用算的，否則用租約直接寫的月數 */
export function depositMonthsOf(f: Pick<LeaseExtract, "deposit" | "monthlyRent" | "depositMonths">): number | null {
  if (f.deposit && f.monthlyRent) return f.deposit / f.monthlyRent;
  return f.depositMonths ?? null;
}

/** 數值與必要欄位規則；回傳 ruleId → detail */
export function numericChecks(f: LeaseExtract): Map<string, string> {
  const hits = new Map<string, string>();
  const months = depositMonthsOf(f);
  if (months !== null && months > 2 + 1e-6) {
    const money = f.deposit && f.monthlyRent ? `（押金 ${fmt(f.deposit)} 元、月租 ${fmt(f.monthlyRent)} 元）` : "";
    hits.set("deposit_max", `這份租約押金約 ${round1(months)} 個月租金${money}。`);
  }
  if (f.electricityPricePerKwh !== null) {
    hits.set("electricity_rate", `這份租約寫每度 ${f.electricityPricePerKwh} 元，要對照電費單上的當期每度平均電價。`);
  } else if (!f.electricityRule) {
    hits.set("electricity_rate", "這份租約沒有寫電費怎麼算。");
  }
  if (f.reviewPeriodDays !== null && f.reviewPeriodDays < 3) {
    hits.set("review_period", `這份租約的審閱期是 ${f.reviewPeriodDays} 天。`);
  }
  if (f.earlyTerminationPenaltyMonths !== null && f.earlyTerminationPenaltyMonths > 1 + 1e-6) {
    hits.set("early_termination_penalty", `這份租約的提前解約違約金約 ${round1(f.earlyTerminationPenaltyMonths)} 個月租金。`);
  }
  const missing: string[] = [];
  if (!f.leaseStart && !f.leaseEnd) missing.push("租期");
  if (f.monthlyRent === null) missing.push("租金");
  if (f.deposit === null && f.depositMonths === null) missing.push("押金");
  if (!f.repairClause) missing.push("修繕");
  if (missing.length) hits.set("missing_fields", `這份租約沒寫清楚：${missing.join("、")}。`);
  return hits;
}

/** 驗證模型引文：必須（忽略空白）是該條款的子字串 */
export function validQuote(clauses: string[], index: number, quote: string): boolean {
  const c = clauses[index];
  const q = stripSpaces(quote);
  return Boolean(c && q.length >= 2 && stripSpaces(c).includes(q));
}

export async function checkLease(files: LlmFile[], rs: Ruleset, deps: LeaseCheckDeps): Promise<LeaseCheckResult> {
  // 1. 抽取（模型看原圖）
  const raw = await generateJson(
    deps.llm,
    { system: LEASE_EXTRACT_SYSTEM, user: leaseExtractUserPrompt(files.length), files, temperature: 0 },
    leaseExtractSchema,
  );
  if (!raw.isLease) return { status: "not_lease", readability: raw.readability };

  // 2. 遮蔽個資（之後的步驟只用遮蔽後的資料）
  const { partyNames, isLease, ...rest } = raw;
  void isLease;
  const fields: MaskedFields = maskDeep(rest, partyNames);

  // 3. 數值規則（數字不受遮蔽影響）
  const numeric = numericChecks(raw);

  // 4. 語意比對（只送遮蔽後條款）
  const sem = semanticRules(rs);
  const quotes = new Map<string, string[]>();
  let droppedMatches = 0;
  if (sem.length && fields.clauses.length) {
    const ids = sem.map((r) => r.id) as [string, ...string[]];
    const out = await generateJson(
      deps.llm,
      {
        system: LEASE_SEMANTIC_SYSTEM,
        user: leaseSemanticUserPrompt(
          sem.map((r) => ({ id: r.id, hint: r.hint! })),
          fields.clauses,
        ),
        temperature: 0,
      },
      leaseSemanticSchema(ids),
    );
    for (const m of out.matches) {
      if (!validQuote(fields.clauses, m.clauseIndex, m.quote)) {
        droppedMatches++;
        continue;
      }
      const list = quotes.get(m.ruleId) ?? [];
      if (!list.includes(m.quote)) list.push(m.quote);
      quotes.set(m.ruleId, list);
    }
  }

  // 5. 合併
  const findings: Finding[] = [];
  const passed: Array<{ ruleId: string; title: string }> = [];
  for (const rule of rs.rules) {
    const detail = numeric.get(rule.id) ?? null;
    const q = quotes.get(rule.id) ?? [];
    if (detail === null && q.length === 0) {
      passed.push({ ruleId: rule.id, title: rule.title });
      continue;
    }
    findings.push(toFinding(rule, rs, detail, q));
  }
  findings.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  return { status: "ok", readability: raw.readability, fields, findings, passed, droppedMatches };
}

function toFinding(rule: LeaseRule, rs: Ruleset, detail: string | null, quotes: string[]): Finding {
  return {
    ruleId: rule.id,
    level: rule.level,
    title: rule.title,
    explanation: rule.explanation,
    detail,
    quotes,
    negotiate: rule.negotiate,
    basis: rule.basis.map((b) => basisView(b, rs)),
  };
}
