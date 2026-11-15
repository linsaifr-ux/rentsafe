import liff from "@line/liff";

export class LiffConfigError extends Error {}

let ready: Promise<void> | null = null;

/** 初始化 LIFF；未登入時導向 LINE Login（會離開頁面）。重複呼叫只會初始化一次。 */
export function initLiff(): Promise<void> {
  ready ??= (async () => {
    const liffId = import.meta.env.VITE_LIFF_ID as string | undefined;
    if (!liffId) throw new LiffConfigError("尚未設定 VITE_LIFF_ID");
    await liff.init({ liffId });
    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: window.location.href });
      await new Promise(() => undefined); // 等待導向，不繼續執行
    }
  })();
  return ready;
}

/** 取得 LIFF ID token（後端會向 LINE 驗證） */
export function getIdToken(): string | null {
  return liff.getIDToken();
}

/** ID token 過期時重新登入 */
export function relogin(): void {
  liff.login({ redirectUri: window.location.href });
}

export function isInLineClient(): boolean {
  return liff.isInClient();
}

export function closeWindow(): void {
  if (liff.isInClient()) liff.closeWindow();
}

/** 用外部瀏覽器開網址（LINE 內建瀏覽器常無法下載檔案） */
export function openExternal(url: string): void {
  if (liff.isInClient()) liff.openWindow({ url, external: true });
  else window.open(url, "_blank", "noopener");
}

/**
 * 「問這一步」：把問題當成使用者的訊息送進聊天室，交給法條問答回覆，再關掉 LIFF。
 * 只有在 LINE 裡、從和官方帳號的聊天室開啟時才送得出去（需要 chat_message.write 權限）；
 * 送不出去回傳 false，畫面改成請使用者複製問題。
 */
export async function askInChat(text: string): Promise<boolean> {
  try {
    if (!liff.isInClient()) return false;
    const ctx = liff.getContext();
    if (!ctx || ctx.type !== "utou") return false;
    await liff.sendMessages([{ type: "text", text }]);
    liff.closeWindow();
    return true;
  } catch {
    return false;
  }
}
