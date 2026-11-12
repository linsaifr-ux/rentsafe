import { LAW_SOURCES, articleUrl } from "../kb/sources.js";
import type { Answer, Checklist, ChecklistItem } from "./checklist.js";

/** 結果最多列出幾個「要問房東的問題」（SPEC 7） */
export const MAX_LANDLORD_QUESTIONS = 5;

export interface ViewingInput {
  housingType: string;
  answers: Record<string, Answer>;
}

export interface CitationLink {
  lawName: string;
  articleNo: string;
  url: string | null;
}

export interface RedFlag {
  id: string;
  question: string;
  why: string;
  weight: number;
  citations: CitationLink[];
}

export interface ViewingScore {
  /** 0–100，越高越安全 */
  score: number;
  redFlags: RedFlag[];
  /** 回答「不確定」的題目 id */
  unknown: string[];
  /** 要問房東的話，紅燈優先、權重高的優先，最多 5 個 */
  questions: string[];
  /** 房型提醒（例如地下室） */
  warning: string | null;
  /** 實際用來計分的回答（含房型自動帶入的答案） */
  answers: Record<string, Answer>;
}

export function citationLink(lawName: string, articleNo: string): CitationLink {
  const src = LAW_SOURCES.find((s) => s.lawName === lawName);
  return { lawName, articleNo, url: src ? articleUrl(src.pcode, articleNo) : null };
}

/**
 * 純規則計分（SPEC 7：不呼叫模型）。
 * 安全答案得滿分、不確定（或沒回答）得一半、紅燈 0 分，依權重加總換算成 0–100。
 */
export function scoreViewing(checklist: Checklist, input: ViewingInput): ViewingScore {
  const housing = checklist.housingTypes.find((h) => h.id === input.housingType);
  if (!housing) throw new Error(`未知的房型：${input.housingType}`);
  const answers: Record<string, Answer> = {};
  for (const it of checklist.items) answers[it.id] = input.answers[it.id] ?? "unknown";
  Object.assign(answers, housing.presetAnswers);

  let total = 0;
  let earned = 0;
  const red: ChecklistItem[] = [];
  const unsure: ChecklistItem[] = [];
  for (const it of checklist.items) {
    const a = answers[it.id]!;
    total += it.weight;
    if (a === "unknown") {
      earned += it.weight / 2;
      unsure.push(it);
    } else if (a === it.redFlagIf) {
      red.push(it);
    } else {
      earned += it.weight;
    }
  }

  const byWeight = (a: ChecklistItem, b: ChecklistItem) => b.weight - a.weight;
  red.sort(byWeight);
  unsure.sort(byWeight);
  const questions = [...red, ...unsure].slice(0, MAX_LANDLORD_QUESTIONS).map((it) => it.askLandlord);

  return {
    score: total ? Math.round((earned / total) * 100) : 100,
    redFlags: red.map((it) => ({
      id: it.id,
      question: it.question,
      why: it.why,
      weight: it.weight,
      citations: it.citations.map((c) => citationLink(c.lawName, c.articleNo)),
    })),
    unknown: unsure.map((it) => it.id),
    questions,
    warning: housing.warning ?? null,
    answers,
  };
}
