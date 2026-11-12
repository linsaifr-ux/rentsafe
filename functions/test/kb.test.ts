import { describe, expect, it } from "vitest";
import { fakeEmbedder, l2normalize } from "../src/ai/embed.js";
import { compareArticleNo, normalizeArticleNo } from "../src/kb/articleNo.js";
import {
  buildLawChunks,
  buildLocalChunk,
  chunkId,
  diffChunks,
  embedText,
  formatReport,
  isRepealed,
  type KbChunk,
} from "../src/kb/chunks.js";
import { runIngest } from "../src/kb/ingest.js";
import { extractLaw, normalizeText, type LawFile, type RawLawFile } from "../src/kb/lawData.js";
import { loadKb } from "../src/kb/load.js";
import { parseLocalMarkdown } from "../src/kb/local.js";
import type { KbStore } from "../src/kb/store.js";

describe("normalizeArticleNo", () => {
  it.each([
    ["第 424 條", "424"],
    ["第424條", "424"],
    ["424", "424"],
    ["第 463-1 條", "463-1"],
    ["第6條之1", "6-1"],
    ["6之1", "6-1"],
    ["第４２４條", "424"],
    ["第 0424 條", "424"],
  ])("%s → %s", (input, out) => {
    expect(normalizeArticleNo(input)).toBe(out);
  });

  it("無法辨識回傳 null", () => {
    expect(normalizeArticleNo("第 一 條")).toBeNull();
    expect(normalizeArticleNo("abc")).toBeNull();
  });

  it("排序：6 < 6-1 < 7 < 463-1", () => {
    expect(["7", "463-1", "6-1", "6"].sort(compareArticleNo)).toEqual(["6", "6-1", "7", "463-1"]);
  });
});

const raw: RawLawFile = {
  UpdateDate: "2026/10/30",
  Laws: [
    {
      LawName: "民法",
      LawURL: "https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=B0000001",
      LawModifiedDate: "20260817",
      LawAbandonNote: "",
      LawArticles: [
        { ArticleType: "A", ArticleNo: "第 420 條", ArticleContent: "範圍外" },
        { ArticleType: "C", ArticleNo: "", ArticleContent: "      第 五 節 租賃" },
        { ArticleType: "A", ArticleNo: "第 421 條", ArticleContent: "第一項。\r\n第二項。" },
        { ArticleType: "A", ArticleNo: "第 422-1 條", ArticleContent: "之一條文" },
        { ArticleType: "A", ArticleNo: "第 463-1 條", ArticleContent: "最後一條" },
        { ArticleType: "A", ArticleNo: "第 464 條", ArticleContent: "範圍外" },
      ],
    },
  ],
};

describe("extractLaw", () => {
  const src = { lawName: "民法", pcode: "B0000001", range: { from: "421", to: "463-1" }, note: "" };

  it("依範圍過濾、記錄章節、統一換行", () => {
    const law = extractLaw(raw, src, "2026-11-12T00:00:00Z");
    expect(law.articles.map((a) => a.articleNo)).toEqual(["421", "422-1", "463-1"]);
    expect(law.articles[0]).toEqual({ articleNo: "421", article: "第 421 條", chapter: "第 五 節 租賃", text: "第一項。\n第二項。" });
    expect(law.modifiedDate).toBe("2026-08-17");
    expect(law.sourceUrl).toBe("https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=B0000001");
  });

  it("pcode 不符、法規不存在、已廢止、指定條文不存在時報錯", () => {
    expect(() => extractLaw(raw, { ...src, pcode: "X" }, "")).toThrow("pcode 不符");
    expect(() => extractLaw(raw, { ...src, lawName: "刑法" }, "")).toThrow("找不到法規");
    const abandoned = { ...raw, Laws: [{ ...raw.Laws[0]!, LawAbandonNote: "廢" }] };
    expect(() => extractLaw(abandoned, src, "")).toThrow("已廢止");
    expect(() => extractLaw(raw, { lawName: "民法", pcode: "B0000001", only: ["999"], note: "" }, "")).toThrow();
  });

  it("normalizeText 只動換行與頭尾空白", () => {
    expect(normalizeText("  甲，乙。\r\n丙。 ")).toBe("甲，乙。\n丙。");
  });
});

const lawFile: LawFile = {
  lawName: "民法",
  pcode: "B0000001",
  sourceUrl: "https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=B0000001",
  modifiedDate: "2026-08-17",
  dataUpdateDate: "x",
  fetchedAt: "x",
  articles: [
    { articleNo: "423", article: "第 423 條", chapter: null, text: "出租人應以合於所約定使用收益之租賃物，交付承租人。" },
    { articleNo: "424", article: "第 424 條", chapter: null, text: "危及安全或健康時，仍得終止契約。" },
    { articleNo: "437", article: "第 437 條", chapter: null, text: "（刪除）" },
  ],
};

describe("buildLawChunks", () => {
  const chunks = buildLawChunks(
    lawFile,
    [{ articleNo: "第 424 條", plain: "房子危險可以解約", reviewed: true }],
    { 火災: { 民法: ["423", "424"] }, 修繕: { 民法: ["423"] } },
  );

  it("略過已刪除條文", () => {
    expect(chunks.map((c) => c.articleNo)).toEqual(["423", "424"]);
    expect(isRepealed("（刪除）")).toBe(true);
    expect(isRepealed("刪除")).toBe(true);
    expect(isRepealed("本條刪除後另定之")).toBe(false);
  });

  it("帶入白話、tags、條文網址與 scope", () => {
    const c424 = chunks.find((c) => c.articleNo === "424")!;
    expect(c424).toMatchObject({
      lawName: "民法",
      article: "第 424 條",
      plain: "房子危險可以解約",
      plainReviewed: true,
      scope: "national",
      tags: ["火災"],
      sourceUrl: "https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=B0000001&flno=424",
      updatedAt: "2026-08-17",
    });
    expect(chunks[0]?.tags).toEqual(["修繕", "火災"]);
    expect(chunks[0]?.plain).toBe("");
  });

  it("嵌入內容包含法規條號、條文、白話、tags", () => {
    const t = embedText(chunks.find((c) => c.articleNo === "424")!);
    expect(t).toBe("民法 第 424 條\n危及安全或健康時，仍得終止契約。\n房子危險可以解約\n火災");
  });

  it("ID 由 (lawName, articleNo, scope) 決定且穩定", () => {
    expect(chunks[0]?.id).toBe(chunkId("民法", "423", "national"));
    expect(chunkId("民法", "423", "national")).not.toBe(chunkId("民法", "423", "新北市"));
  });
});

describe("diffChunks", () => {
  const [a, b] = buildLawChunks(lawFile);
  it("分出新增、修改、刪除、未變動", () => {
    const existing = new Map([
      [a!.id, a!.contentHash],
      [b!.id, "old-hash"],
      ["gone", "x"],
    ]);
    const r = diffChunks(existing, [a!, b!]);
    expect(r.added).toEqual([]);
    expect(r.modified.map((c) => c.id)).toEqual([b!.id]);
    expect(r.deleted).toEqual(["gone"]);
    expect(r.unchanged).toBe(1);
    expect(formatReport(r)).toContain("新增 0 條、修改 1 條、刪除 1 條、未變動 1 條");
  });

  it("重複條文報錯", () => {
    expect(() => diffChunks(new Map(), [a!, a!])).toThrow("重複");
  });
});

describe("parseLocalMarkdown", () => {
  const md = `---
city: 台北
lawName: 臺北市火災預防自治條例
sourceUrl: https://example.gov.tw/law
checkedAt: 2026-11-12
updatedAt: 2026-01-01
status: verified
tags: [火災]
---

## 第 5 條
第一行。
第二行。

## 第5條之1
另一條。
`;

  it("解析 frontmatter 與條文", () => {
    const r = parseLocalMarkdown(md);
    expect(r.status).toBe("verified");
    expect(r.articles).toEqual([
      { lawName: "臺北市火災預防自治條例", articleNo: "5", text: "第一行。\n第二行。", city: "臺北市", sourceUrl: "https://example.gov.tw/law", updatedAt: "2026-01-01", tags: ["火災"] },
      { lawName: "臺北市火災預防自治條例", articleNo: "5-1", text: "另一條。", city: "臺北市", sourceUrl: "https://example.gov.tw/law", updatedAt: "2026-01-01", tags: ["火災"] },
    ]);
    expect(buildLocalChunk(r.articles[0]!).scope).toBe("臺北市");
  });

  it("pending 不產生條文；verified 缺網址或缺條文報錯", () => {
    expect(parseLocalMarkdown(md.replace("status: verified", "status: pending")).articles).toEqual([]);
    expect(() => parseLocalMarkdown(md.replace("sourceUrl: https://example.gov.tw/law\n", ""))).toThrow("sourceUrl");
    expect(() => parseLocalMarkdown(md.split("## 第 5 條")[0]!)).toThrow("沒有條文");
    expect(() => parseLocalMarkdown("no frontmatter")).toThrow("frontmatter");
  });
});

function memoryStore() {
  const docs = new Map<string, { chunk: KbChunk; embedding: number[] }>();
  const store: KbStore = {
    async listHashes() {
      return new Map([...docs].map(([id, d]) => [id, d.chunk.contentHash]));
    },
    async upsert(items) {
      for (const it of items) docs.set(it.chunk.id, it);
    },
    async delete(ids) {
      for (const id of ids) docs.delete(id);
    },
  };
  return { store, docs };
}

describe("runIngest（實際 kb/ 資料）", () => {
  it("載入官方條文，SPEC 5.3 必帶條文都在", async () => {
    const { chunks, pendingLocal } = await loadKb();
    const has = (law: string, no: string) => chunks.some((c) => c.lawName === law && c.articleNo === no);
    for (const no of ["423", "424", "425", "429", "430", "434", "440", "450", "453"]) expect(has("民法", no)).toBe(true);
    expect(has("消防法", "6")).toBe(true);
    expect(has("租賃住宅市場發展及管理條例", "7")).toBe(true);
    expect(pendingLocal.length).toBe(6);
  });

  it("dry-run 不寫入；第一次全部新增；重跑全部未變動", async () => {
    const { store, docs } = memoryStore();
    const dry = await runIngest({ store, embedder: null, dryRun: true });
    expect(dry.report.added.length).toBeGreaterThan(100);
    expect(docs.size).toBe(0);

    let embedCalls = 0;
    const fe = fakeEmbedder();
    const counting = {
      embed: async (t: string[], task: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY") => {
        embedCalls += t.length;
        return fe.embed(t, task);
      },
    };
    const first = await runIngest({ store, embedder: counting, dryRun: false });
    expect(docs.size).toBe(first.report.added.length);
    expect(embedCalls).toBe(docs.size);

    const second = await runIngest({ store, embedder: counting, dryRun: false });
    expect(second.report.added.length + second.report.modified.length + second.report.deleted.length).toBe(0);
    expect(embedCalls).toBe(docs.size); // 沒有重新嵌入
  });
});

describe("embed", () => {
  it("l2normalize 長度為 1", () => {
    const v = l2normalize([3, 4]);
    expect(v).toEqual([0.6, 0.8]);
    expect(l2normalize([0, 0])).toEqual([0, 0]);
  });

  it("fakeEmbedder 輸出指定維度、相似文字較接近", async () => {
    const [a, b, c] = await fakeEmbedder(64).embed(["房東不修漏水", "房東不修理漏水", "押金上限兩個月"], "RETRIEVAL_QUERY");
    const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i]!, 0);
    expect(a).toHaveLength(64);
    expect(dot(a!, b!)).toBeGreaterThan(dot(a!, c!));
  });
});
