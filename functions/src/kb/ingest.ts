/**
 * 知識庫匯入：kb/ → 嵌入 → Firestore kb_chunks（SPEC 6.2）。
 *
 * 用法（專案根目錄）：
 *   npm run kb:ingest -- --dry-run              只輸出變更報告，不嵌入、不寫入
 *   GEMINI_API_KEY=xxx npm run kb:ingest        正式匯入（需 gcloud 登入或 GOOGLE_APPLICATION_CREDENTIALS）
 *   npm run kb:ingest -- --fake-embed           用假嵌入（只限 emulator 測試）
 *
 * 目標專案：GCLOUD_PROJECT 環境變數，或 .firebaserc 的 default。
 * 若設定 FIRESTORE_EMULATOR_HOST 則寫入 emulator。
 * 以 (lawName, articleNo, scope) 為鍵覆寫；只有新增或修改的條文才重新嵌入。
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { fakeEmbedder, geminiEmbedder, type Embedder } from "../ai/embed.js";
import { LLM } from "../config.js";
import { diffChunks, embedText, formatReport, type ChangeReport } from "./chunks.js";
import { loadKb } from "./load.js";
import { firestoreKbStore, type KbStore } from "./store.js";

export async function runIngest(opts: {
  store: KbStore;
  embedder: Embedder | null;
  dryRun: boolean;
  kbDir?: string;
}): Promise<{ report: ChangeReport; pendingLocal: string[] }> {
  const { chunks, pendingLocal } = await loadKb(opts.kbDir);
  const report = diffChunks(await opts.store.listHashes(), chunks);
  if (opts.dryRun) return { report, pendingLocal };
  if (!opts.embedder) throw new Error("需要 embedder");

  const toWrite = [...report.added, ...report.modified];
  if (toWrite.length) {
    const vectors = await opts.embedder.embed(toWrite.map(embedText), "RETRIEVAL_DOCUMENT");
    await opts.store.upsert(toWrite.map((chunk, i) => ({ chunk, embedding: vectors[i]! })));
  }
  if (report.deleted.length) await opts.store.delete(report.deleted);
  return { report, pendingLocal };
}

async function defaultProject(): Promise<string | undefined> {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  try {
    const rc = JSON.parse(await readFile(fileURLToPath(new URL("../../../.firebaserc", import.meta.url)), "utf8"));
    return rc.projects?.default;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const fake = args.has("--fake-embed");
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;

  if (fake && !emulator) throw new Error("--fake-embed 只能搭配 emulator（請設定 FIRESTORE_EMULATOR_HOST）");
  const projectId = await defaultProject();
  if (!projectId || projectId.includes("REPLACE-ME")) {
    throw new Error("找不到 Firebase 專案 ID：請設定 GCLOUD_PROJECT 或填寫 .firebaserc");
  }
  console.log(`專案：${projectId}${emulator ? `（emulator ${emulator}）` : ""}${dryRun ? "［dry-run］" : ""}`);

  initializeApp({ projectId });
  let embedder: Embedder | null = null;
  if (!dryRun) {
    if (fake) embedder = fakeEmbedder();
    else {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new Error("請設定 GEMINI_API_KEY 環境變數");
      embedder = geminiEmbedder(key, { retries: LLM.rateLimitRetries, onWait: (ms) => console.log(`Gemini 限流，等待 ${Math.round(ms / 1000)} 秒後重試…`) });
    }
  }

  const { report, pendingLocal } = await runIngest({ store: firestoreKbStore(getFirestore()), embedder, dryRun });
  console.log(formatReport(report));
  if (pendingLocal.length) console.log(`待查證、未匯入的縣市資料：${pendingLocal.join("、")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
