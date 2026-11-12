/**
 * 從全國法規資料庫下載官方開放資料，過濾出 sources.ts 指定的條文，存成 kb/laws/{pcode}.json。
 *
 * 用法：npm run kb:fetch -w functions
 *
 * 只下載、不嵌入、不寫 Firestore；結果請 git diff 檢查後再 commit。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { unzipSync, strFromU8 } from "fflate";
import { extractLaw, rawLawFile } from "./lawData.js";
import { LAW_DATA_URL, LAW_SOURCES } from "./sources.js";

const KB_LAWS_DIR = fileURLToPath(new URL("../../../kb/laws/", import.meta.url));

async function main(): Promise<void> {
  console.log(`下載 ${LAW_DATA_URL} …`);
  const res = await fetch(LAW_DATA_URL);
  if (!res.ok) throw new Error(`下載失敗：${res.status}`);
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const entry = Object.keys(files).find((n) => n.endsWith(".json"));
  if (!entry) throw new Error("zip 內沒有 JSON 檔");
  const text = strFromU8(files[entry]!).replace(/^\uFEFF/, "");
  const data = rawLawFile.parse(JSON.parse(text));
  console.log(`官方資料更新時間：${data.UpdateDate}，共 ${data.Laws.length} 部法規`);

  await mkdir(KB_LAWS_DIR, { recursive: true });
  const fetchedAt = new Date().toISOString();
  for (const src of LAW_SOURCES) {
    const law = extractLaw(data, src, fetchedAt);
    const path = `${KB_LAWS_DIR}${src.pcode}.json`;
    await writeFile(path, JSON.stringify(law, null, 2) + "\n");
    console.log(`✔ ${law.lawName}（${law.pcode}）${law.articles.length} 條，最後異動 ${law.modifiedDate}`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
