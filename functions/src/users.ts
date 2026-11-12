import { FieldValue, type Firestore, type Timestamp } from "firebase-admin/firestore";

export type LandlordType = "individual" | "business" | "unknown";

export interface UserDoc {
  displayName: string;
  city: string | null;
  landlordType: LandlordType;
  active: boolean;
  consentAt: Timestamp | null;
}

/** users/{uid} 的存取介面；測試可替換成記憶體版 */
export interface UserRepo {
  get(uid: string): Promise<UserDoc | null>;
  /** 不存在就建立；存在則更新 displayName（若有給）與 active */
  ensure(uid: string, init: { displayName?: string; active?: boolean }): Promise<UserDoc>;
  setCity(uid: string, city: string | null): Promise<void>;
  setActive(uid: string, active: boolean): Promise<void>;
  setConsent(uid: string): Promise<void>;
}

export function firestoreUserRepo(db: Firestore): UserRepo {
  const ref = (uid: string) => db.collection("users").doc(uid);

  async function get(uid: string): Promise<UserDoc | null> {
    const snap = await ref(uid).get();
    if (!snap.exists) return null;
    const d = snap.data() ?? {};
    return {
      displayName: d.displayName ?? "",
      city: d.city ?? null,
      landlordType: d.landlordType ?? "unknown",
      active: d.active ?? true,
      consentAt: d.consentAt ?? null,
    };
  }

  return {
    get,
    async ensure(uid, init) {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref(uid));
        if (!snap.exists) {
          tx.set(ref(uid), {
            displayName: init.displayName ?? "",
            city: null,
            landlordType: "unknown",
            active: init.active ?? true,
            consentAt: null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        } else {
          const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
          if (init.displayName) patch.displayName = init.displayName;
          if (init.active !== undefined) patch.active = init.active;
          tx.update(ref(uid), patch);
        }
      });
      const doc = await get(uid);
      if (!doc) throw new Error("user ensure failed");
      return doc;
    },
    async setCity(uid, city) {
      await ref(uid).set({ city, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    },
    async setActive(uid, active) {
      await ref(uid).set({ active, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    },
    async setConsent(uid) {
      await ref(uid).set(
        { consentAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    },
  };
}
