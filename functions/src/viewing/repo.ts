import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { Answer } from "./checklist.js";

/** users/{uid}/viewings/{id}（SPEC 3） */
export interface ViewingRecord {
  city: string | null;
  housingType: string;
  answers: Record<string, Answer>;
  score: number;
  redFlags: string[];
  questions: string[];
}

export interface ViewingRepo {
  /** 回傳新紀錄的 id */
  add(uid: string, rec: ViewingRecord): Promise<string>;
}

export function firestoreViewingRepo(db: Firestore): ViewingRepo {
  return {
    async add(uid, rec) {
      const ref = await db.collection("users").doc(uid).collection("viewings").add({ ...rec, createdAt: FieldValue.serverTimestamp() });
      return ref.id;
    },
  };
}
