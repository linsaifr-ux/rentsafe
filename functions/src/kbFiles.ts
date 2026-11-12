import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

/**
 * 執行期需要的 kb/*.yaml。
 * - 開發／測試（src/）：直接讀專案根目錄的 kb/
 * - 部署（lib/）：build 時複製到 functions/kb-data/（見 scripts/copy-kb.mjs）
 */
const CANDIDATES = [new URL("../kb-data/", import.meta.url), new URL("../../kb/", import.meta.url)];

export function kbFilePath(name: string): string {
  for (const base of CANDIDATES) {
    const p = fileURLToPath(new URL(name, base));
    if (existsSync(p)) return p;
  }
  throw new Error(`找不到 kb 檔案：${name}`);
}

const cache = new Map<string, unknown>();

export function readKbYaml(name: string): unknown {
  if (!cache.has(name)) cache.set(name, parseYaml(readFileSync(kbFilePath(name), "utf8")));
  return cache.get(name);
}
