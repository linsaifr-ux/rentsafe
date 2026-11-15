/** F3 存證廊的資料型別（SPEC 3、9） */

export const CATEGORIES = { repair: "修繕", rent: "租金", dispute: "爭議", safety: "安全", other: "其他" } as const;
export type Category = keyof typeof CATEGORIES;
export const CATEGORY_IDS = Object.keys(CATEGORIES) as Category[];

export type EvidenceType = "photo" | "video" | "audio" | "document" | "note";
export const TYPE_LABEL: Record<EvidenceType, string> = { photo: "照片", video: "影片", audio: "錄音", document: "檔案", note: "文字紀錄" };

export interface EvidenceRecord {
  type: EvidenceType;
  category: Category;
  /** 使用者描述（已遮蔽個資）；文字紀錄的內容也放這裡 */
  text: string;
  fileName: string | null;
  mimeType: string | null;
  bytes: number;
  /** Cloud Storage 路徑（原檔）；文字紀錄為 null */
  storagePath: string | null;
  /** 縮圖路徑（照片、影片才有） */
  thumbPath: string | null;
  /** 原檔（文字紀錄則為文字內容）的 SHA-256，證明之後沒有被修改 */
  sha256: string;
  source: "line" | "liff";
  /** 事件發生時間：預設＝傳送時間，使用者可修改 */
  occurredAt: Date;
  /** 系統收到時間：不可修改，作為證據時間戳 */
  createdAt: Date;
}

export interface StoredEvidence extends EvidenceRecord {
  id: string;
}

/** Storage 路徑都放在 users/{uid}/ 底下，刪除資料時可一次清掉 */
export function evidencePaths(uid: string, id: string) {
  return { file: `users/${uid}/evidence/${id}`, thumb: `users/${uid}/evidence/${id}_thumb.jpg` };
}

/** 台灣時間 yyyy/MM/dd HH:mm:ss */
export function taiwanDateTime(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}/${get("month")}/${get("day")} ${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}:${get("second")}`;
}
