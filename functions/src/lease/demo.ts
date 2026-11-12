/**
 * 用真的 Gemini 對一份租約跑健檢（驗收用，不寫 Firestore）。
 *
 * 用法（專案根目錄）：GEMINI_API_KEY=… npm run lease:demo -w functions -- ../demo/sample-lease.pdf
 */
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { geminiLlm } from "../ai/llm.js";
import { LLM, MODELS } from "../config.js";
import { checkLease } from "./check.js";
import { loadRuleset } from "./ruleset.js";

const MIME: Record<string, string> = { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };

async function main(): Promise<void> {
  const key = process.env.GEMINI_API_KEY;
  const paths = process.argv.slice(2);
  if (!key || paths.length === 0) {
    console.error("用法：GEMINI_API_KEY=… npm run lease:demo -w functions -- <租約檔案…>");
    process.exit(1);
  }
  const files = await Promise.all(
    paths.map(async (p) => {
      const mimeType = MIME[extname(p).toLowerCase()];
      if (!mimeType) throw new Error(`不支援的檔案：${p}`);
      return { mimeType, data: (await readFile(resolve(p))).toString("base64") };
    }),
  );
  const llm = geminiLlm(key, MODELS.vision, { retries: LLM.rateLimitRetries });
  const started = Date.now();
  const r = await checkLease(files, loadRuleset(), { llm });
  console.log(`耗時 ${((Date.now() - started) / 1000).toFixed(1)} 秒`);
  if (r.status === "not_lease") {
    console.log("不是租約");
    return;
  }
  console.log(`可讀性：${r.readability}；被丟棄的模型引文：${r.droppedMatches}`);
  console.log("欄位：", JSON.stringify({ ...r.fields, clauses: `${r.fields.clauses.length} 條` }, null, 2));
  for (const f of r.findings) {
    console.log(`\n[${f.level === "red" ? "紅" : "黃"}] ${f.ruleId}｜${f.title}`);
    if (f.detail) console.log(`  ${f.detail}`);
    for (const q of f.quotes) console.log(`  原文：「${q}」`);
  }
  console.log(`\n沒發現問題：${r.passed.map((p) => p.ruleId).join(", ")}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
