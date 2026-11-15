import type { LineMessage } from "./types.js";

const API = "https://api.line.me/v2/bot";
const DATA_API = "https://api-data.line.me/v2/bot";

export interface LineContent {
  data: Buffer;
  contentType: string;
}

/** 下載內容的結果：ok、還在轉檔（影片、錄音）、太大、找不到 */
export type ContentResult = { kind: "ok"; content: LineContent } | { kind: "not_ready" } | { kind: "too_large" } | { kind: "not_found" };

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
  /** 下載使用者傳來的圖片／影片／錄音／檔案（preview＝LINE 產生的預覽圖，只有圖片和影片有） */
  getContent(messageId: string, opts: { preview?: boolean; maxBytes: number }): Promise<ContentResult>;
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
    async getContent(messageId, { preview = false, maxBytes }) {
      const url = `${DATA_API}/message/${encodeURIComponent(messageId)}/content${preview ? "/preview" : ""}`;
      const res = await fetchImpl(url, { headers: { Authorization: headers.Authorization } });
      if (res.status === 202) return { kind: "not_ready" };
      if (res.status === 404) return { kind: "not_found" };
      if (!res.ok) throw new LineApiError(res.status, await res.text());
      const declared = Number(res.headers.get("content-length") ?? "0");
      if (declared > maxBytes) return { kind: "too_large" };
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length > maxBytes) return { kind: "too_large" };
      return { kind: "ok", content: { data, contentType: res.headers.get("content-type") ?? "application/octet-stream" } };
    },
    async getProfile(userId) {
      const res = await fetchImpl(`${API}/profile/${encodeURIComponent(userId)}`, { headers });
      if (!res.ok) return null;
      const data = (await res.json()) as { userId?: string; displayName?: string };
      if (!data.userId) return null;
      return { userId: data.userId, displayName: data.displayName ?? "" };
    },
  };
}
