/**
 * 跑測試集、輸出指標（SPEC 14）。
 *
 * 用法（專案根目錄）：
 *   GEMINI_API_KEY=xxx npm run eval                       # 預設 eval/questions.seed.jsonl
 *   GEMINI_API_KEY=xxx npm run eval -- eval/questions.jsonl
 *
 * 直接使用 kb/ 的條文＋Gemini 嵌入建立記憶體索引，不需要 Firestore。
 * 結果寫到 eval/results/<時間>.json 與 .md。
 * 注意：會實際呼叫 Gemini（每題約 3–4 次），會產生少量費用。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { geminiEmbedder } from "../functions/src/ai/embed.js";
import { geminiLlm } from "../functions/src/ai/llm.js";
import { memoryKbIndex } from "../functions/src/ai/memoryIndex.js";
import { answerQuestion, PROMPT_VERSION } from "../functions/src/ai/orchestrator.js";
import { normalizeCity } from "../functions/src/cities.js";
import { LLM, MODELS } from "../functions/src/config.js";
import { kbKeySet, parseJsonl, summarize, type QuestionOutcome } from "../functions/src/eval/metrics.js";
import { loadKb } from "../functions/src/kb/load.js";
import { memoryRateLimiter } from "../functions/src/rateLimit.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

async function main(): Promise<void> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("請設定 GEMINI_API_KEY");
  const file = process.argv[2] ?? "eval/questions.seed.jsonl";
  const questions = parseJsonl(await readFile(new URL(file, `file://${ROOT}`), "utf8"));

  const { chunks } = await loadKb();
  const retry = { retries: LLM.rateLimitRetries, onWait: (ms: number) => console.log(`Gemini 限流，等待 ${Math.round(ms / 1000)} 秒後重試…`) };
  const embedder = geminiEmbedder(key, retry);
  const index = await memoryKbIndex(chunks, embedder);
  const llm = geminiLlm(key, MODELS.chat, retry);
  const kbKeys = kbKeySet(chunks);

  const outcomes: QuestionOutcome[] = [];
  for (const q of questions) {
    const started = Date.now();
    const base = { id: q.id, reviewed: q.reviewedBy !== null, expected: q.expectedArticles, mustRefer: q.mustRefer };
    try {
      const { result, trace } = await answerQuestion(
        {
          uid: "eval",
          text: q.question,
          user: { displayName: "eval", city: normalizeCity(q.city), landlordType: "unknown", active: true, consentAt: null },
        },
        { llm, embedder, index, limiter: memoryRateLimiter() },
      );
      const rawCited = trace?.firstPass ? [...trace.firstPass.valid, ...trace.firstPass.errors.flatMap((e) => ("citation" in e ? [e.citation] : []))] : [];
      outcomes.push({
        ...base,
        kind: result.kind,
        cited: result.kind === "answer" ? result.citations.map((c) => ({ lawName: c.lawName, articleNo: c.articleNo })) : [],
        rawCited: rawCited.map((c) => ({ lawName: c.lawName, articleNo: c.articleNo })),
        referred: result.kind === "emergency" || (result.kind === "answer" && result.referrals.length > 0),
        latencyMs: Date.now() - started,
      });
      console.log(`✔ ${q.id} ${result.kind}`);
    } catch (err) {
      outcomes.push({ ...base, kind: "error", cited: [], rawCited: [], referred: false, latencyMs: Date.now() - started, error: String(err) });
      console.log(`✘ ${q.id} ${String(err)}`);
    }
  }

  const summary = summarize(outcomes, kbKeys);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = new URL("eval/results/", `file://${ROOT}`);
  await mkdir(outDir, { recursive: true });
  const meta = { file, promptVersion: PROMPT_VERSION, models: MODELS, runAt: new Date().toISOString() };
  await writeFile(new URL(`${stamp}.json`, outDir), JSON.stringify({ meta, summary, outcomes }, null, 2));

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const md = [
    `# Eval ${meta.runAt}`,
    "",
    `- 題庫：${file}（${summary.total} 題，已複核 ${summary.reviewed} 題；錯誤 ${summary.errors} 題）`,
    `- Prompt：${PROMPT_VERSION}；模型：${MODELS.chat}／${MODELS.embedding}`,
    "",
    "| 指標 | 數值 |",
    "| --- | --- |",
    `| 引用正確率（recall） | ${pct(summary.citationRecall)} |`,
    `| 引用精確率（precision） | ${pct(summary.citationPrecision)} |`,
    `| 幻覺率（citeCheck 前） | ${pct(summary.hallucinationRate)} |`,
    `| 轉介正確率 | ${pct(summary.referralRecall)} |`,
    `| 延遲 P50／P95 | ${summary.latencyP50} ms／${summary.latencyP95} ms |`,
    "",
    summary.reviewed < summary.total ? "> 注意：未複核的題目不計入最終報告（SPEC 14）。本次結果僅供開發參考。" : "",
  ].join("\n");
  await writeFile(new URL(`${stamp}.md`, outDir), md + "\n");
  console.log(`\n${md}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
