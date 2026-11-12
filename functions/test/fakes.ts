import type { LineClient, LineProfile } from "../src/line/client.js";
import type { LineMessage } from "../src/line/types.js";
import type { UserDoc, UserRepo } from "../src/users.js";

export function fakeLine(profiles: Record<string, string> = {}) {
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
