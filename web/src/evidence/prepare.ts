/**
 * 存證上傳前的處理：原檔不壓縮（雜湊要對應原檔），另外產生一張小縮圖給時間軸和 PDF 用。
 */
import { fitSize, readAsBase64 } from "../lease/prepare.ts";

/** 與 functions/src/config.ts EVIDENCE.maxUploadBytes 一致 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const THUMB_SIDE = 480;

export interface PreparedEvidence {
  name: string;
  mimeType: string;
  data: string;
  thumb: string | null;
  bytes: number;
  previewUrl: string | null;
  /** 檔案的修改時間（照片通常接近拍攝時間），當作發生時間的預設值 */
  lastModified: Date | null;
}

async function makeThumb(file: File): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(file);
    const { width, height } = fitSize(bmp.width, bmp.height, THUMB_SIDE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, width, height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.8));
    return blob ? await readAsBase64(blob) : null;
  } catch {
    return null; // 瀏覽器不支援解碼（例如部分 HEIC）就不做縮圖
  }
}

export async function prepareEvidence(file: File): Promise<PreparedEvidence> {
  const mimeType = file.type || "application/octet-stream";
  const isImage = mimeType.startsWith("image/");
  return {
    name: file.name,
    mimeType,
    data: await readAsBase64(file),
    thumb: isImage ? await makeThumb(file) : null,
    bytes: file.size,
    previewUrl: isImage ? URL.createObjectURL(file) : null,
    lastModified: file.lastModified ? new Date(file.lastModified) : null,
  };
}
