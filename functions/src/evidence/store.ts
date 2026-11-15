import type { getStorage } from "firebase-admin/storage";

type Bucket = ReturnType<ReturnType<typeof getStorage>["bucket"]>;

/** 檔案儲存介面；測試可替換成記憶體版 */
export interface BlobStore {
  put(path: string, data: Buffer, contentType: string): Promise<void>;
  get(path: string): Promise<{ data: Buffer; contentType: string } | null>;
  delete(path: string): Promise<void>;
}

export function firebaseBlobStore(bucket: Bucket): BlobStore {
  return {
    async put(path, data, contentType) {
      // 不公開、不快取；只有後端用 Admin 權限讀取
      await bucket.file(path).save(data, { resumable: false, contentType, metadata: { cacheControl: "private, no-store" } });
    },
    async get(path) {
      const file = bucket.file(path);
      try {
        const [[data], [meta]] = await Promise.all([file.download(), file.getMetadata()]);
        return { data, contentType: meta.contentType ?? "application/octet-stream" };
      } catch (err) {
        if ((err as { code?: number }).code === 404) return null;
        throw err;
      }
    },
    async delete(path) {
      await bucket.file(path).delete({ ignoreNotFound: true });
    },
  };
}
