import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { depositMonthsOf, type Finding, type MaskedFields } from "./check.js";

/** users/{uid}/leaseChecks/{id}（SPEC 3）：只存遮蔽後欄位與 findings，不存原圖 */
export interface LeaseCheckRecord {
  /** 屬於哪一間看房紀錄；null＝只有租約 */
  viewingId: string | null;
  label: string;
  readability: "good" | "partial" | "poor";
  fields: MaskedFields;
  findings: Finding[];
  passed: Array<{ ruleId: string; title: string }>;
  promptVersion: string;
  latencyMs: number;
}

export interface StoredLeaseCheck extends LeaseCheckRecord {
  id: string;
  createdAt: string | null;
}

/** 列表與比較用的摘要 */
export interface LeaseSummary {
  id: string;
  red: number;
  yellow: number;
  monthlyRent: number | null;
  deposit: number | null;
  depositMonths: number | null;
  createdAt: string | null;
}

export function leaseSummary(l: StoredLeaseCheck): LeaseSummary {
  return {
    id: l.id,
    red: l.findings.filter((f) => f.level === "red").length,
    yellow: l.findings.filter((f) => f.level === "yellow").length,
    monthlyRent: l.fields.monthlyRent,
    deposit: l.fields.deposit,
    depositMonths: depositMonthsOf(l.fields),
    createdAt: l.createdAt,
  };
}

export interface LeaseCheckRepo {
  add(uid: string, rec: LeaseCheckRecord): Promise<string>;
  /** 新到舊，最多 limit 筆 */
  list(uid: string, limit: number): Promise<StoredLeaseCheck[]>;
  get(uid: string, id: string): Promise<StoredLeaseCheck | null>;
  /** 永久刪除一筆；不存在回傳 false */
  delete(uid: string, id: string): Promise<boolean>;
  /** 刪除某間看房紀錄底下的所有租約健檢，回傳刪了幾筆 */
  deleteByViewing(uid: string, viewingId: string): Promise<number>;
}

function fromDoc(id: string, d: FirebaseFirestore.DocumentData): StoredLeaseCheck {
  return {
    id,
    viewingId: d.viewingId ?? null,
    label: typeof d.label === "string" && d.label ? d.label : "租約健檢",
    readability: d.readability ?? "good",
    fields: d.fields,
    findings: d.findings ?? [],
    passed: d.passed ?? [],
    promptVersion: d.promptVersion ?? "",
    latencyMs: d.latencyMs ?? 0,
    createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toDate().toISOString() : null,
  };
}

export function firestoreLeaseCheckRepo(db: Firestore): LeaseCheckRepo {
  const col = (uid: string) => db.collection("users").doc(uid).collection("leaseChecks");
  return {
    async add(uid, rec) {
      const ref = await col(uid).add({ ...rec, createdAt: FieldValue.serverTimestamp() });
      return ref.id;
    },
    async list(uid, limit) {
      const snap = await col(uid).orderBy("createdAt", "desc").limit(limit).get();
      return snap.docs.map((d) => fromDoc(d.id, d.data()));
    },
    async get(uid, id) {
      const snap = await col(uid).doc(id).get();
      return snap.exists ? fromDoc(snap.id, snap.data()!) : null;
    },
    async delete(uid, id) {
      const ref = col(uid).doc(id);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return false;
        tx.delete(ref);
        return true;
      });
    },
    async deleteByViewing(uid, viewingId) {
      const snap = await col(uid).where("viewingId", "==", viewingId).get();
      if (snap.empty) return 0;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      return snap.size;
    },
  };
}
