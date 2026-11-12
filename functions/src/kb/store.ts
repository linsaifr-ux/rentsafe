import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { KbChunk } from "./chunks.js";

export const KB_COLLECTION = "kb_chunks";

export interface KbStore {
  /** id → contentHash */
  listHashes(): Promise<Map<string, string>>;
  upsert(items: Array<{ chunk: KbChunk; embedding: number[] }>): Promise<void>;
  delete(ids: string[]): Promise<void>;
}

export function firestoreKbStore(db: Firestore): KbStore {
  const col = db.collection(KB_COLLECTION);
  return {
    async listHashes() {
      const snap = await col.select("contentHash").get();
      return new Map(snap.docs.map((d) => [d.id, String(d.get("contentHash") ?? "")]));
    },
    async upsert(items) {
      for (let i = 0; i < items.length; i += 400) {
        const batch = db.batch();
        for (const { chunk, embedding } of items.slice(i, i + 400)) {
          const { id, ...data } = chunk;
          batch.set(col.doc(id), {
            ...data,
            embedding: FieldValue.vector(embedding),
            fetchedAt: FieldValue.serverTimestamp(),
          });
        }
        await batch.commit();
      }
    },
    async delete(ids) {
      for (let i = 0; i < ids.length; i += 400) {
        const batch = db.batch();
        for (const id of ids.slice(i, i + 400)) batch.delete(col.doc(id));
        await batch.commit();
      }
    },
  };
}
