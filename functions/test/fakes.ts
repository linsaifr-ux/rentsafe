import type { ContentResult, LineClient, LineProfile } from "../src/line/client.js";
import type { LineMessage } from "../src/line/types.js";
import type { UserDoc, UserRepo } from "../src/users.js";
import type { ViewingRecord, ViewingRepo } from "../src/viewing/repo.js";
import type { KbIndex } from "../src/ai/retrieve.js";
import type { DownloadTokenRepo, EvidenceRepo } from "../src/evidence/repo.js";
import type { StoredEvidence } from "../src/evidence/model.js";
import type { BlobStore } from "../src/evidence/store.js";
import type { LeaseCheckRecord, LeaseCheckRepo, StoredLeaseCheck } from "../src/lease/repo.js";

export function fakeLine(profiles: Record<string, string> = {}, contents: Record<string, ContentResult> = {}) {
  const replies: Array<{ replyToken: string; messages: LineMessage[] }> = [];
  const pushes: Array<{ to: string; messages: LineMessage[] }> = [];
  const loadings: Array<{ chatId: string; seconds: number }> = [];
  const client: LineClient = {
    async reply(replyToken, messages) {
      replies.push({ replyToken, messages });
    },
    async push(to, messages) {
      pushes.push({ to, messages });
    },
    async showLoading(chatId, seconds) {
      loadings.push({ chatId, seconds });
    },
    async getContent(messageId, opts) {
      const key = opts.preview ? `${messageId}/preview` : messageId;
      return contents[key] ?? { kind: "not_found" };
    },
    async getProfile(userId): Promise<LineProfile | null> {
      const name = profiles[userId];
      return name ? { userId, displayName: name } : null;
    },
  };
  return { client, replies, pushes, loadings };
}

export function memoryUserRepo() {
  const docs = new Map<string, UserDoc & { consented?: boolean }>();
  const repo: UserRepo = {
    async get(uid) {
      return docs.get(uid) ?? null;
    },
    async ensure(uid, init) {
      const cur = docs.get(uid);
      const next: UserDoc = cur
        ? {
            ...cur,
            displayName: init.displayName || cur.displayName,
            active: init.active ?? cur.active,
          }
        : {
            displayName: init.displayName ?? "",
            city: null,
            landlordType: "unknown",
            active: init.active ?? true,
            consentAt: null,
          };
      docs.set(uid, next);
      return next;
    },
    async setCity(uid, city) {
      const cur = await repo.ensure(uid, {});
      docs.set(uid, { ...cur, city });
    },
    async setActive(uid, active) {
      const cur = await repo.ensure(uid, {});
      docs.set(uid, { ...cur, active });
    },
    async setConsent(uid) {
      const cur = await repo.ensure(uid, {});
      const ts = { toDate: () => new Date("2026-11-12T00:00:00Z") } as UserDoc["consentAt"];
      docs.set(uid, { ...cur, consentAt: ts });
    },
  };
  return { repo, docs };
}

/** 沒有任何條文的知識庫 */
export const emptyKbIndex: KbIndex = {
  nearest: async () => [],
  byArticle: async () => null,
  byScope: async () => [],
};

export function memoryViewingRepo() {
  const records: Array<{ uid: string; rec: ViewingRecord; id: string; createdAt: string }> = [];
  const repo: ViewingRepo = {
    async add(uid, rec) {
      const id = `v${records.length + 1}`;
      records.push({ uid, rec, id, createdAt: new Date(Date.UTC(2026, 10, 12, 0, records.length)).toISOString() });
      return id;
    },
    async list(uid, limit) {
      return records
        .filter((r) => r.uid === uid)
        .reverse()
        .slice(0, limit)
        .map((r) => ({ ...r.rec, id: r.id, createdAt: r.createdAt }));
    },
    async delete(uid, id) {
      const i = records.findIndex((x) => x.uid === uid && x.id === id);
      if (i < 0) return false;
      records.splice(i, 1);
      return true;
    },
    async getMany(uid, ids) {
      return ids.flatMap((id) => {
        const r = records.find((x) => x.uid === uid && x.id === id);
        return r ? [{ ...r.rec, id: r.id, createdAt: r.createdAt }] : [];
      });
    },
  };
  return { repo, records };
}

export function memoryLeaseRepo() {
  const records: Array<{ uid: string; rec: StoredLeaseCheck }> = [];
  let seq = 0;
  const repo: LeaseCheckRepo = {
    async add(uid, rec: LeaseCheckRecord) {
      const id = `l${++seq}`;
      records.push({ uid, rec: { ...rec, id, createdAt: new Date(Date.UTC(2026, 10, 13, 0, seq)).toISOString() } });
      return id;
    },
    async list(uid, limit) {
      return records
        .filter((r) => r.uid === uid)
        .map((r) => r.rec)
        .reverse()
        .slice(0, limit);
    },
    async get(uid, id) {
      return records.find((r) => r.uid === uid && r.rec.id === id)?.rec ?? null;
    },
    async delete(uid, id) {
      const i = records.findIndex((r) => r.uid === uid && r.rec.id === id);
      if (i < 0) return false;
      records.splice(i, 1);
      return true;
    },
    async deleteByViewing(uid, viewingId) {
      const before = records.length;
      for (let i = records.length - 1; i >= 0; i--) {
        if (records[i]!.uid === uid && records[i]!.rec.viewingId === viewingId) records.splice(i, 1);
      }
      return before - records.length;
    },
  };
  return { repo, records };
}

export function memoryEvidenceRepo() {
  const records = new Map<string, StoredEvidence>(); // key: uid/id
  let seq = 0;
  const repo: EvidenceRepo = {
    newId: () => `e${++seq}`,
    async add(uid, id, rec) {
      records.set(`${uid}/${id}`, { ...rec, id });
    },
    async list(uid, { category, limit }) {
      return [...records.entries()]
        .filter(([k, r]) => k.startsWith(`${uid}/`) && (!category || r.category === category))
        .map(([, r]) => r)
        .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
        .slice(0, limit);
    },
    async get(uid, id) {
      return records.get(`${uid}/${id}`) ?? null;
    },
    async update(uid, id, patch) {
      const cur = records.get(`${uid}/${id}`);
      if (!cur) return null;
      const next = { ...cur, ...patch };
      records.set(`${uid}/${id}`, next);
      return next;
    },
    async delete(uid, id) {
      const cur = records.get(`${uid}/${id}`) ?? null;
      records.delete(`${uid}/${id}`);
      return cur;
    },
  };
  return { repo, records };
}

export function memoryBlobStore() {
  const files = new Map<string, { data: Buffer; contentType: string }>();
  const store: BlobStore = {
    async put(path, data, contentType) {
      files.set(path, { data, contentType });
    },
    async get(path) {
      return files.get(path) ?? null;
    },
    async delete(path) {
      files.delete(path);
    },
  };
  return { store, files };
}

export function memoryTokenRepo() {
  const tokens = new Map<string, { uid: string; ids: string[]; expiresAt: Date }>();
  let seq = 0;
  const repo: DownloadTokenRepo = {
    async create(rec) {
      const t = `tok${String(++seq).padStart(20, "0")}`;
      tokens.set(t, rec);
      return t;
    },
    async get(token) {
      return tokens.get(token) ?? null;
    },
  };
  return { repo, tokens };
}
