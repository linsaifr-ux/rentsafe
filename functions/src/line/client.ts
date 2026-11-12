import type { LineMessage } from "./types.js";

const API = "https://api.line.me/v2/bot";

export interface LineProfile {
  userId: string;
  displayName: string;
}

export interface LineClient {
  reply(replyToken: string, messages: LineMessage[]): Promise<void>;
  push(to: string, messages: LineMessage[]): Promise<void>;
  getProfile(userId: string): Promise<LineProfile | null>;
  /** 在一對一聊天室顯示「輸入中」動畫；送出回覆後自動消失 */
  showLoading(chatId: string, seconds: number): Promise<void>;
}

export class LineApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`LINE API ${status}: ${body}`);
  }
}

export function createLineClient(accessToken: string, fetchImpl: typeof fetch = fetch): LineClient {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  async function post(path: string, body: unknown): Promise<void> {
    const res = await fetchImpl(`${API}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new LineApiError(res.status, await res.text());
  }

  return {
    // reply token 一次最多 5 則訊息
    reply: (replyToken, messages) => post("/message/reply", { replyToken, messages: messages.slice(0, 5) }),
    push: (to, messages) => post("/message/push", { to, messages: messages.slice(0, 5) }),
    showLoading: (chatId, seconds) =>
      post("/chat/loading/start", { chatId, loadingSeconds: Math.min(60, Math.max(5, Math.round(seconds / 5) * 5)) }),
    async getProfile(userId) {
      const res = await fetchImpl(`${API}/profile/${encodeURIComponent(userId)}`, { headers });
      if (!res.ok) return null;
      const data = (await res.json()) as { userId?: string; displayName?: string };
      if (!data.userId) return null;
      return { userId: data.userId, displayName: data.displayName ?? "" };
    },
  };
}
