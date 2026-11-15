import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { LandlordType } from "../users.js";
import { CASE_SCENARIOS, type CaseScenario } from "./flows.js";
import type { CaseSummary } from "./summary.js";

/** 使用者填的基本事實（SPEC 11 輸入：cases 的答案） */
export interface CaseAnswers {
  /** 發生日期 YYYY-MM-DD */
  occurredOn: string | null;
  city: string | null;
  landlordType: LandlordType;
  /** 經過簡述（已遮蔽個資） */
  story: string;
  /** 想要的結果 */
  wants: string[];
}

export interface CaseRecord {
  scenario: CaseScenario;
  answers: CaseAnswers;
  /** 勾選完成的步驟（stepKey） */
  checklistDone: string[];
  /** 每個步驟完成的時間（ISO），給摘要時間軸用 */
  doneAt: Record<string, string>;
  /** 使用者選進這個案件的存證 */
  evidenceIds: string[];
  summary: CaseSummary | null;
}

export interface StoredCase extends CaseRecord {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CasePatch = Partial<Pick<CaseRecord, "answers" | "checklistDone" | "doneAt" | "evidenceIds" | "summary">>;

/** users/{uid}/cases/{id}（SPEC 3） */
export interface CaseRepo {
  add(uid: string, rec: CaseRecord, now: Date): Promise<StoredCase>;
  /** 依更新時間新到舊 */
  list(uid: string, limit: number): Promise<StoredCase[]>;
  get(uid: string, id: string): Promise<StoredCase | null>;
  update(uid: string, id: string, patch: CasePatch, now: Date): Promise<StoredCase | null>;
  delete(uid: string, id: string): Promise<boolean>;
}

function toDate(v: unknown): Date {
  return v instanceof Timestamp ? v.toDate() : v instanceof Date ? v : new Date(0);
}

function fromDoc(id: string, d: FirebaseFirestore.DocumentData): StoredCase {
  const a = (d.answers ?? {}) as Partial<CaseAnswers>;
  return {
    id,
    scenario: CASE_SCENARIOS.includes(d.scenario) ? d.scenario : "no_repair",
    answers: {
      occurredOn: a.occurredOn ?? null,
      city: a.city ?? null,
      landlordType: a.landlordType ?? "unknown",
      story: a.story ?? "",
      wants: a.wants ?? [],
    },
    checklistDone: d.checklistDone ?? [],
    doneAt: d.doneAt ?? {},
    evidenceIds: d.evidenceIds ?? [],
    summary: d.summary ?? null,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

export function firestoreCaseRepo(db: Firestore): CaseRepo {
  const col = (uid: string) => db.collection("users").doc(uid).collection("cases");
  return {
    async add(uid, rec, now) {
      const ref = col(uid).doc();
      const ts = Timestamp.fromDate(now);
      await ref.create({ ...rec, createdAt: ts, updatedAt: ts });
      return { ...rec, id: ref.id, createdAt: now, updatedAt: now };
    },
    async list(uid, limit) {
      const snap = await col(uid).orderBy("updatedAt", "desc").limit(limit).get();
      return snap.docs.map((d) => fromDoc(d.id, d.data()));
    },
    async get(uid, id) {
      const snap = await col(uid).doc(id).get();
      return snap.exists ? fromDoc(snap.id, snap.data()!) : null;
    },
    async update(uid, id, patch, now) {
      const ref = col(uid).doc(id);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        tx.update(ref, { ...patch, updatedAt: Timestamp.fromDate(now) });
        return { ...fromDoc(id, snap.data()!), ...patch, updatedAt: now };
      });
    },
    async delete(uid, id) {
      const ref = col(uid).doc(id);
      const snap = await ref.get();
      if (!snap.exists) return false;
      await ref.delete();
      return true;
    },
  };
}
