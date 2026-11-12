import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import type { Answer } from "./checklist.js";

/** users/{uid}/viewings/{id}（SPEC 3） */
export interface ViewingRecord {
  /** 租屋處名稱或地址（使用者填寫，未填自動命名） */
  label: string;
  city: string | null;
  housingType: string;
  answers: Record<string, Answer>;
  score: number;
  redFlags: string[];
  questions: string[];
}

export interface StoredViewing extends ViewingRecord {
  id: string;
  /** ISO 字串；剛寫入、伺服器時間還沒回填時為 null */
  createdAt: string | null;
}

export interface ViewingRepo {
  /** 回傳新紀錄的 id */
  add(uid: string, rec: ViewingRecord): Promise<string>;
  /** 新到舊，最多 limit 筆 */
  list(uid: string, limit: number): Promise<StoredViewing[]>;
  /** 依 id 讀取；不存在的 id 略過，順序與輸入相同 */
  getMany(uid: string, ids: string[]): Promise<StoredViewing[]>;
}

function fromDoc(id: string, d: FirebaseFirestore.DocumentData): StoredViewing {
  const created = d.createdAt instanceof Timestamp ? d.createdAt.toDate().toISOString() : null;
  return {
    id,
    label: typeof d.label === "string" && d.label ? d.label : "未命名的租屋處",
    city: d.city ?? null,
    housingType: d.housingType,
    answers: d.answers ?? {},
    score: d.score,
    redFlags: d.redFlags ?? [],
    questions: d.questions ?? [],
    createdAt: created,
  };
}

export function firestoreViewingRepo(db: Firestore): ViewingRepo {
  const col = (uid: string) => db.collection("users").doc(uid).collection("viewings");
  return {
    async add(uid, rec) {
      const ref = await col(uid).add({ ...rec, createdAt: FieldValue.serverTimestamp() });
      return ref.id;
    },
    async list(uid, limit) {
      const snap = await col(uid).orderBy("createdAt", "desc").limit(limit).get();
      return snap.docs.map((d) => fromDoc(d.id, d.data()));
    },
    async getMany(uid, ids) {
      if (ids.length === 0) return [];
      const snaps = await db.getAll(...ids.map((id) => col(uid).doc(id)));
      return snaps.filter((s) => s.exists).map((s) => fromDoc(s.id, s.data()!));
    },
  };
}
