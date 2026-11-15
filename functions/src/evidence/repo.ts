import { randomBytes } from "node:crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { CATEGORY_IDS, type Category, type EvidenceRecord, type StoredEvidence } from "./model.js";

/** users/{uid}/evidence/{id}（SPEC 3） */
export interface EvidenceRepo {
  newId(uid: string): string;
  add(uid: string, id: string, rec: EvidenceRecord): Promise<void>;
  /** 依發生時間新到舊 */
  list(uid: string, opts: { category?: Category; limit: number }): Promise<StoredEvidence[]>;
  get(uid: string, id: string): Promise<StoredEvidence | null>;
  /** 只能改描述、分類、發生時間；不存在回傳 null */
  update(uid: string, id: string, patch: { text?: string; category?: Category; occurredAt?: Date }): Promise<StoredEvidence | null>;
  /** 刪除紀錄並回傳原本內容（給呼叫端刪 Storage 檔）；不存在回傳 null */
  delete(uid: string, id: string): Promise<StoredEvidence | null>;
}

/** 匯出 PDF 的短期下載連結（下載時不經 LIFF 登入，用隨機 token 驗證） */
export interface DownloadTokenRepo {
  create(rec: { uid: string; ids: string[]; expiresAt: Date }): Promise<string>;
  get(token: string): Promise<{ uid: string; ids: string[]; expiresAt: Date } | null>;
}

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

function toDate(v: unknown): Date {
  return v instanceof Timestamp ? v.toDate() : v instanceof Date ? v : new Date(0);
}

function fromDoc(id: string, d: FirebaseFirestore.DocumentData): StoredEvidence {
  return {
    id,
    type: d.type,
    category: CATEGORY_IDS.includes(d.category) ? d.category : "other",
    text: d.text ?? "",
    fileName: d.fileName ?? null,
    mimeType: d.mimeType ?? null,
    bytes: d.bytes ?? 0,
    storagePath: d.storagePath ?? null,
    thumbPath: d.thumbPath ?? null,
    sha256: d.sha256 ?? "",
    source: d.source ?? "line",
    occurredAt: toDate(d.occurredAt),
    createdAt: toDate(d.createdAt),
  };
}

export function firestoreEvidenceRepo(db: Firestore): EvidenceRepo {
  const col = (uid: string) => db.collection("users").doc(uid).collection("evidence");
  return {
    newId: (uid) => col(uid).doc().id,
    async add(uid, id, rec) {
      await col(uid)
        .doc(id)
        .create({ ...rec, occurredAt: Timestamp.fromDate(rec.occurredAt), createdAt: Timestamp.fromDate(rec.createdAt) });
    },
    async list(uid, { category, limit }) {
      let q: FirebaseFirestore.Query = col(uid);
      if (category) q = q.where("category", "==", category);
      const snap = await q.orderBy("occurredAt", "desc").limit(limit).get();
      return snap.docs.map((d) => fromDoc(d.id, d.data()));
    },
    async get(uid, id) {
      const snap = await col(uid).doc(id).get();
      return snap.exists ? fromDoc(snap.id, snap.data()!) : null;
    },
    async update(uid, id, patch) {
      const ref = col(uid).doc(id);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const data: Record<string, unknown> = {};
        if (patch.text !== undefined) data.text = patch.text;
        if (patch.category !== undefined) data.category = patch.category;
        if (patch.occurredAt !== undefined) data.occurredAt = Timestamp.fromDate(patch.occurredAt);
        tx.update(ref, data);
        return { ...fromDoc(id, snap.data()!), ...patch };
      });
    },
    async delete(uid, id) {
      const ref = col(uid).doc(id);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        tx.delete(ref);
        return fromDoc(id, snap.data()!);
      });
    },
  };
}

export function firestoreDownloadTokenRepo(db: Firestore): DownloadTokenRepo {
  const col = db.collection("evidenceExports");
  return {
    async create(rec) {
      const token = newToken();
      await col.doc(token).create({ ...rec, expiresAt: Timestamp.fromDate(rec.expiresAt) });
      return token;
    },
    async get(token) {
      const snap = await col.doc(token).get();
      if (!snap.exists) return null;
      const d = snap.data()!;
      return { uid: d.uid, ids: d.ids ?? [], expiresAt: toDate(d.expiresAt) };
    },
  };
}
