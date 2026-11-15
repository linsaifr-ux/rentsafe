/**
 * 全專案的可調參數集中在這裡：模型名稱、檢索參數、限流數字。
 * 其他檔案一律從這裡讀，不得寫死。
 */

/** 部署區域 */
export const REGION = "asia-east1";

/**
 * Gemini 模型名稱。
 * 查證：https://ai.google.dev/gemini-api/docs/models（2026-11-12）
 * Gemini 模型更新很快，Phase 3 / Phase 5 實作前請再次確認。
 */
export const MODELS = {
  /** 對話用（classify、generate） */
  chat: "gemini-3.8-flash",
  /** 租約影像抽取（需支援圖片輸入） */
  vision: "gemini-3.8-flash",
  /** 嵌入（純文字） */
  embedding: "gemini-embedding-001",
} as const;

/** 嵌入維度；須與 firestore.indexes.json 的向量索引維度一致 */
export const EMBEDDING_DIMENSIONS = 768;

/** 檢索參數（SPEC 5.1） */
export const RETRIEVAL = {
  topK: 8,
} as const;

/** LLM 呼叫參數 */
export const LLM = {
  /** JSON zod 驗證失敗時的重試次數 */
  jsonRetries: 1,
  temperature: 0.2,
  /** 被 Gemini 限流（429）時最多重試幾次（只用於 ingest、eval 等命令列工具；線上回覆不等待） */
  rateLimitRetries: 3,
  /** 429 回應沒有附等待秒數時的預設等待（毫秒） */
  rateLimitDefaultWaitMs: 30_000,
} as const;

/** 限流（SPEC 4.1、4.2） */
/** 看房健檢（SPEC 7） */
export const VIEWING = {
  /** 租屋處名稱或地址最多幾個字 */
  labelMaxLength: 60,
  /** 「我的看房紀錄」最多列出幾筆 */
  historyLimit: 50,
  /** 一次最多比較幾間 */
  compareMax: 3,
} as const;

/** 租約健檢（SPEC 8） */
export const LEASE = {
  /** 一次最多幾個檔案（照片或 PDF） */
  maxFiles: 6,
  /** 所有檔案解碼後合計上限（位元組）；前端會先壓縮照片 */
  maxTotalBytes: 8 * 1024 * 1024,
  /** 接受的檔案類型 */
  mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"],
  /** 抽取的條款最多幾條（送語意比對） */
  maxClauses: 80,
} as const;

/** 存證廊（SPEC 9） */
export const EVIDENCE = {
  /** 聊天室收到的檔案上限（LINE 允許更大，超過就請使用者自行保留原檔） */
  maxFileBytes: 20 * 1024 * 1024,
  /** LIFF 上傳的原檔上限（base64 後約 1.34 倍，仍在 Hosting 請求上限內） */
  maxUploadBytes: 10 * 1024 * 1024,
  /** 縮圖上限（前端或 LINE 預覽圖） */
  maxThumbBytes: 400 * 1024,
  /** 描述最多幾個字 */
  textMaxLength: 500,
  /** 時間軸最多列幾筆 */
  listLimit: 300,
  /** 一份證據清單 PDF 最多幾筆 */
  exportMax: 60,
  /** 匯出下載連結有效時間 */
  downloadTtlMs: 10 * 60 * 1000,
  /** LINE 影片、錄音轉檔還沒完成時，最多等幾次、每次間隔 */
  contentRetries: 4,
  contentRetryMs: 700,
} as const;

export const RATE_LIMITS = {
  perUserPerMinute: 30,
  /** 存證廊讀照片、縮圖（時間軸一次會載入多張）另外計算 */
  filePerUserPerMinute: 120,
  qaPerUserPerDay: 50,
  leaseCheckPerUserPerDay: 10,
  pushPerUserPerDay: 3,
  evidencePerUserPerDay: 200,
  evidenceExportPerUserPerDay: 20,
  /** 全系統每日 F5 問答上限（每題約 3–4 次 Gemini 呼叫），防止費用失控 */
  qaGlobalPerDay: 1000,
} as const;

/** 問法條時聊天室「輸入中」動畫秒數（LINE 規定 5–60 且為 5 的倍數；回覆送出後動畫會自動消失） */
export const LINE_LOADING_SECONDS = 60;

/** 轉介門檻：押金爭議金額（新台幣），超過附轉介卡（SPEC 5.1） */
export const REFERRAL_DEPOSIT_THRESHOLD_TWD = 20_000;

/** 免責聲明（SPEC 12） */
export const DISCLAIMER = "本服務提供法律資訊，不是法律意見；個案請洽法扶專線或律師。";
