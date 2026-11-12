import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * 驗證 LINE webhook 的 x-line-signature。
 * 簽章 = Base64(HMAC-SHA256(channelSecret, 原始 request body))。
 * 必須用「原始」body 計算，不能用 JSON.parse 後再序列化的內容。
 */
export function verifyLineSignature(
  rawBody: Buffer | string,
  signature: string | undefined,
  channelSecret: string,
): boolean {
  if (!signature || !channelSecret) return false;
  const expected = createHmac("sha256", channelSecret).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, "base64");
  } catch {
    return false;
  }
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}
