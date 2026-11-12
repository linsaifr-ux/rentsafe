import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";

/** 固定時間窗計數器。hit 回傳 true＝放行，false＝超過上限。 */
export interface RateLimiter {
  hit(key: string, limit: number, windowMs: number): Promise<boolean>;
}

export const MINUTE = 60_000;
/** 以台灣時間（UTC+8）切日 */
export const DAY = 86_400_000;
const TW_OFFSET = 8 * 3_600_000;

export function windowStart(now: number, windowMs: number): number {
  const shift = windowMs === DAY ? TW_OFFSET : 0;
  return Math.floor((now + shift) / windowMs) * windowMs - shift;
}

export function memoryRateLimiter(now: () => number = Date.now): RateLimiter {
  const counts = new Map<string, number>();
  return {
    async hit(key, limit, windowMs) {
      const k = `${key}:${windowStart(now(), windowMs)}`;
      const n = (counts.get(k) ?? 0) + 1;
      counts.set(k, n);
      return n <= limit;
    },
  };
}

/**
 * Firestore 版：rateLimits/{key}_{windowStart}。
 * 文件帶 expireAt，可在 Console 設定 TTL 政策自動清除。
 */
export function firestoreRateLimiter(db: Firestore, now: () => number = Date.now): RateLimiter {
  return {
    async hit(key, limit, windowMs) {
      const start = windowStart(now(), windowMs);
      const ref = db.collection("rateLimits").doc(`${key.replace(/\//g, "_")}_${start}`);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const count = (snap.exists ? (snap.get("count") as number) : 0) + 1;
        if (count > limit) return false;
        tx.set(ref, {
          count,
          expireAt: Timestamp.fromMillis(start + windowMs * 2),
          updatedAt: FieldValue.serverTimestamp(),
        });
        return true;
      });
    },
  };
}
