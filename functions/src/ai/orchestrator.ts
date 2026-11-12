/**
 * F5 法條問答主流程（SPEC 5.1）：
 * safety → classify → retrieve → generate → citeCheck（失敗嚴格重試 1 次，仍失敗則降級）→ referral
 */
import { RATE_LIMITS } from "../config.js";
import { DAY, type RateLimiter } from "../rateLimit.js";
import type { UserDoc } from "../users.js";
import { citeCheck, stripUnverified, type CiteCheckResult, type CiteError } from "./citeCheck.js";
import { classify, CLASSIFY_PROMPT_VERSION } from "./classify.js";
import type { Embedder } from "./embed.js";
import { ANSWER_PROMPT_VERSION, generateAnswer, generateAnswerStrict } from "./generate.js";
import type { Llm } from "./llm.js";
import type { AnswerOutput } from "./prompts/answer.v1.js";
import type { QaLog } from "./qaLog.js";
import { decideReferral, loadReferrals, type Referral } from "./referral.js";
import { retrieve, type KbIndex, type RetrievedChunk } from "./retrieve.js";
import { detectEmergency, type EmergencyKind } from "./safety.js";
import { SCENARIO_LABEL, type Scenario } from "./scenario.js";

export const PROMPT_VERSION = `${CLASSIFY_PROMPT_VERSION}+${ANSWER_PROMPT_VERSION}`;

export interface CitedArticle {
  lawName: string;
  articleNo: string;
  quote: string;
  sourceUrl: string;
  scope: string;
  /** 已審閱的白話說明；未審閱則為 null（SPEC 6.2） */
  plain: string | null;
}

export type QaResult =
  | { kind: "emergency"; emergencyKind: EmergencyKind }
  | { kind: "rate_limited"; scope: "user" | "global" }
  | { kind: "clarify"; question: string; askCity: boolean }
  | {
      kind: "answer";
      summary: string;
      citations: CitedArticle[];
      actions: string[];
      evidence: string[];
      referrals: Referral[];
      confidence: AnswerOutput["confidence"];
      note: string | null;
      scenario: Scenario;
      city: string | null;
    };

export interface QaDeps {
  llm: Llm;
  embedder: Embedder;
  index: KbIndex;
  limiter: RateLimiter;
  qaLog?: QaLog;
  now?: () => number;
}

export interface QaTrace {
  firstPass: CiteCheckResult | null;
  secondPass: CiteCheckResult | null;
  retrieved: RetrievedChunk[];
  /** citeCheck 前，模型第一次輸出中引用「不在檢索結果」的條號數（供幻覺率評估） */
  firstPassCitations: number;
  firstPassNotRetrieved: number;
}

function describeError(e: CiteError): string {
  switch (e.type) {
    case "not_retrieved":
      return `「${e.citation.lawName} 第 ${e.citation.articleNo} 條」不在提供的條文片段中`;
    case "empty_quote":
      return `「${e.citation.lawName} 第 ${e.citation.articleNo} 條」的 quote 是空的`;
    case "quote_mismatch":
      return `「${e.citation.lawName} 第 ${e.citation.articleNo} 條」的 quote 不是逐字出自條文`;
    case "unbacked_reference":
      return `${e.field === "summary" ? "summary" : "actions"} 提到「${e.ref}」，但 citations 沒有這一條`;
  }
}

export async function answerQuestion(
  input: { uid: string; text: string; user: UserDoc },
  deps: QaDeps,
): Promise<{ result: QaResult; trace: QaTrace | null }> {
  const now = deps.now ?? Date.now;
  const started = now();
  const question = input.text.trim();
  const log = async (rec: Omit<Parameters<QaLog["add"]>[1], "question" | "latencyMs" | "promptVersion">) =>
    deps.qaLog?.add(input.uid, { question, latencyMs: now() - started, promptVersion: PROMPT_VERSION, ...rec }).catch(() => undefined);

  // 1. 緊急狀況：不受限流影響，也不呼叫模型
  const safety = detectEmergency(question);
  if (safety.emergency && safety.kind) {
    await log({ outcome: "emergency", answer: null, citations: [], referred: true, scenario: null, citeCheck: null });
    return { result: { kind: "emergency", emergencyKind: safety.kind }, trace: null };
  }

  // 2. 限流：每人每日、全系統每日
  if (!(await deps.limiter.hit(`qa/${input.uid}`, RATE_LIMITS.qaPerUserPerDay, DAY))) {
    return { result: { kind: "rate_limited", scope: "user" }, trace: null };
  }
  if (!(await deps.limiter.hit("qa/global", RATE_LIMITS.qaGlobalPerDay, DAY))) {
    return { result: { kind: "rate_limited", scope: "global" }, trace: null };
  }

  // 3. 分類
  const cls = await classify(deps.llm, question, input.user.city);
  if (cls.needsClarification) {
    const askCity = /縣市|哪個城市|哪裡租|住在哪/.test(cls.needsClarification);
    await log({ outcome: "clarify", answer: cls.needsClarification, citations: [], referred: false, scenario: cls.scenario, citeCheck: null });
    return { result: { kind: "clarify", question: cls.needsClarification, askCity }, trace: null };
  }
  const city = cls.city ?? input.user.city;
  const landlordType = cls.landlordType !== "unknown" ? cls.landlordType : input.user.landlordType;

  // 4. 檢索
  const retrieved = await retrieve({ question, city, scenario: cls.scenario, embedder: deps.embedder, index: deps.index });
  const sources = retrieved.map((c) => ({ lawName: c.lawName, articleNo: c.articleNo, scope: c.scope, text: c.text }));
  const genArgs = { question, city, scenarioLabel: SCENARIO_LABEL[cls.scenario], sources };

  // 5. 生成 + 6. 引用驗證
  let answer = await generateAnswer(deps.llm, genArgs);
  const firstPass = citeCheck(answer, sources);
  let secondPass: CiteCheckResult | null = null;
  let final = firstPass;
  if (!firstPass.ok) {
    answer = await generateAnswerStrict(deps.llm, genArgs, firstPass.errors.map(describeError));
    secondPass = citeCheck(answer, sources);
    final = secondPass;
  }
  const checked = stripUnverified(answer, final);

  // 7. 轉介
  const decision = decideReferral({
    scenario: cls.scenario,
    asksOutcome: cls.asksOutcome,
    landlordType,
    question,
    modelReferTo: answer.referTo,
    confidence: answer.confidence,
  });
  const allReferrals = loadReferrals();
  const referrals = decision.ids.map((id) => allReferrals.find((r) => r.id === id)!).filter(Boolean);

  const byKey = new Map(retrieved.map((c) => [`${c.lawName}|${c.articleNo}`, c]));
  const citations: CitedArticle[] = checked.citations.map((c) => {
    const src = byKey.get(`${c.lawName}|${c.articleNo}`)!;
    return {
      lawName: c.lawName,
      articleNo: c.articleNo,
      quote: c.quote,
      sourceUrl: src.sourceUrl,
      scope: src.scope,
      plain: src.plainReviewed && src.plain ? src.plain : null,
    };
  });

  await log({
    outcome: "answer",
    answer: checked.summary,
    citations: citations.map((c) => ({ lawName: c.lawName, articleNo: c.articleNo })),
    referred: decision.refer,
    scenario: cls.scenario,
    citeCheck: { firstPassOk: firstPass.ok, retried: !firstPass.ok, finalOk: final.ok, degraded: checked.note !== null },
  });

  return {
    result: {
      kind: "answer",
      summary: checked.summary,
      citations,
      actions: checked.actions,
      evidence: answer.evidence,
      referrals,
      confidence: answer.confidence,
      note: checked.note,
      scenario: cls.scenario,
      city,
    },
    trace: {
      firstPass,
      secondPass,
      retrieved,
      firstPassCitations: firstPass.valid.length + firstPass.invalidIndexes.length,
      firstPassNotRetrieved: firstPass.errors.filter((e) => e.type === "not_retrieved").length,
    },
  };
}
