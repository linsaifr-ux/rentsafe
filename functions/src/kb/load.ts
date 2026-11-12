import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { buildLawChunks, buildLocalChunk, plainFileSchema, tagsFileSchema, type KbChunk } from "./chunks.js";
import { lawFileSchema } from "./lawData.js";
import { parseLocalMarkdown } from "./local.js";

export const KB_DIR = fileURLToPath(new URL("../../../kb/", import.meta.url));

async function listFiles(dir: string, ext: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(ext)).sort();
  } catch {
    return [];
  }
}

export interface LoadResult {
  chunks: KbChunk[];
  pendingLocal: string[];
}

/** 讀取 kb/ 底下所有來源，組成 chunks */
export async function loadKb(kbDir = KB_DIR): Promise<LoadResult> {
  const tagsRaw = await readFile(join(kbDir, "tags.yaml"), "utf8").catch(() => "{}");
  const tags = tagsFileSchema.parse(parseYaml(tagsRaw) ?? {});

  const chunks: KbChunk[] = [];
  for (const f of await listFiles(join(kbDir, "laws"), ".json")) {
    const law = lawFileSchema.parse(JSON.parse(await readFile(join(kbDir, "laws", f), "utf8")));
    const plainRaw = await readFile(join(kbDir, "plain", `${law.pcode}.yaml`), "utf8").catch(() => null);
    const plain = plainRaw ? plainFileSchema.parse(parseYaml(plainRaw) ?? []) : [];
    chunks.push(...buildLawChunks(law, plain, tags));
  }

  const pendingLocal: string[] = [];
  for (const f of await listFiles(join(kbDir, "local"), ".md")) {
    if (f.toLowerCase() === "readme.md") continue;
    const parsed = parseLocalMarkdown(await readFile(join(kbDir, "local", f), "utf8"), f);
    if (parsed.status !== "verified") {
      pendingLocal.push(f);
      continue;
    }
    chunks.push(...parsed.articles.map(buildLocalChunk));
  }
  return { chunks, pendingLocal };
}
