/**
 * 上傳前在手機上處理檔案：照片縮小並轉成 JPEG（省流量、避免超過上限），PDF 原樣送。
 * 檔案只存在記憶體，不會存到手機或伺服器。
 */

/** 與 functions/src/config.ts LEASE 一致 */
export const MAX_FILES = 6;
export const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
/** 照片長邊縮到多少像素（租約文字仍清楚） */
export const MAX_SIDE = 2000;
const JPEG_QUALITY = 0.82;

export interface PreparedFile {
  name: string;
  mimeType: string;
  /** base64，不含 data: 前綴 */
  data: string;
  bytes: number;
  /** 預覽用（照片才有） */
  previewUrl: string | null;
}

function readAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** 長邊縮到 MAX_SIDE 以內的尺寸 */
export function fitSize(w: number, h: number, max = MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

async function compressImage(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const { width, height } = fitSize(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("壓縮失敗"))), "image/jpeg", JPEG_QUALITY),
  );
}

export async function prepareFile(file: File): Promise<PreparedFile> {
  if (file.type === "application/pdf") {
    return { name: file.name, mimeType: "application/pdf", data: await readAsBase64(file), bytes: file.size, previewUrl: null };
  }
  let blob: Blob = file;
  let mimeType = file.type || "image/jpeg";
  try {
    blob = await compressImage(file);
    mimeType = "image/jpeg";
  } catch {
    // 瀏覽器不支援解碼（例如部分 HEIC）時原樣送，交給後端
  }
  return { name: file.name, mimeType, data: await readAsBase64(blob), bytes: blob.size, previewUrl: URL.createObjectURL(blob) };
}
