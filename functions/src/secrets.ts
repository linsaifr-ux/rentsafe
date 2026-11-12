import { defineSecret, defineString } from "firebase-functions/params";

/** 機密：放 Secret Manager（`firebase functions:secrets:set <NAME>`），本機 emulator 用 functions/.secret.local */
export const LINE_CHANNEL_SECRET = defineSecret("LINE_CHANNEL_SECRET");
export const LINE_CHANNEL_ACCESS_TOKEN = defineSecret("LINE_CHANNEL_ACCESS_TOKEN");
export const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

/** 非機密參數：放 functions/.env.<projectId> */
/** LINE Login 頻道的 Channel ID，用來驗證 LIFF ID token 的 aud */
export const LINE_LOGIN_CHANNEL_ID = defineString("LINE_LOGIN_CHANNEL_ID");
/** LIFF app ID，用來組 https://liff.line.me/{LIFF_ID}/... 連結 */
export const LIFF_ID = defineString("LIFF_ID");
