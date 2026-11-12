import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { Finding, MaskedFields } from "./check.js";

/** users/{uid}/leaseChecks/{id}（SPEC 3）：只存遮蔽後欄位與 findings，不存原圖 */
export interface LeaseCheckRecord {
  fields: MaskedFields;
  findings: Finding[];
  promptVersion: string;
  latencyMs: number;
}

export interface LeaseCheckRepo {
  add(uid: string, rec: LeaseCheckRecord): Promise<string>;
}

export function firestoreLeaseCheckRepo(db: Firestore): LeaseCheckRepo {
  return {
    async add(uid, rec) {
      const ref = await db.collection("users").doc(uid).collection("leaseChecks").add({ ...rec, createdAt: FieldValue.serverTimestamp() });
      return ref.id;
    },
  };
}
