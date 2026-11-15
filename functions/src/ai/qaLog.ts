import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";

/** users/{uid}/qa/{id}（SPEC 3），供除錯與評估；使用者可刪 */
export interface QaRecord {
  question: string;
  outcome: "answer" | "clarify" | "emergency" | "rate_limited" | "error";
  answer: string | null;
  citations: Array<{ lawName: string; articleNo: string }>;
  referred: boolean;
  latencyMs: number;
  promptVersion: string;
  scenario: string | null;
  citeCheck: { firstPassOk: boolean; retried: boolean; finalOk: boolean; degraded: boolean } | null;
}

export interface QaLog {
  add(uid: string, rec: QaRecord): Promise<void>;
  /** 最近的問答（新到舊），給案件摘要用（SPEC 11） */
  recent?(uid: string, limit: number): Promise<Array<QaRecord & { createdAt: Date }>>;
}

export function firestoreQaLog(db: Firestore): QaLog {
  return {
    async add(uid, rec) {
      await db.collection("users").doc(uid).collection("qa").add({ ...rec, createdAt: FieldValue.serverTimestamp() });
    },
    async recent(uid, limit) {
      const snap = await db.collection("users").doc(uid).collection("qa").orderBy("createdAt", "desc").limit(limit).get();
      return snap.docs.map((d) => {
        const x = d.data();
        return { ...(x as QaRecord), createdAt: x.createdAt instanceof Timestamp ? x.createdAt.toDate() : new Date(0) };
      });
    },
  };
}
