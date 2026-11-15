import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { AuthError } from "../src/api/auth.js";
import type { ApiDeps } from "../src/api/http.js";
import { handleApi } from "../src/api/router.js";
import { categoryQuickReply, evidenceCard } from "../src/evidence/card.js";
import { taiwanDateTime } from "../src/evidence/model.js";
import { buildEvidencePdf } from "../src/evidence/pdf.js";
import { MSG, saveFromLine, storeEvidence } from "../src/evidence/save.js";
import { createLineClient } from "../src/line/client.js";
import { parsePostback } from "../src/line/postback.js";
import { handleEvent } from "../src/line/webhook.js";
import type { LineEvent } from "../src/line/types.js";
import { memoryRateLimiter } from "../src/rateLimit.js";
import { emptyKbIndex, fakeLine, memoryBlobStore, memoryEvidenceRepo, memoryLeaseRepo, memoryTokenRepo, memoryUserRepo, memoryViewingRepo } from "./fakes.js";

const NOW = new Date("2026-11-14T02:30:05Z");
const hash = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function msgEvent(message: Record<string, unknown>): Extract<LineEvent, { type: "message" }> {
  return { type: "message", timestamp: Date.parse("2026-11-14T02:30:00Z"), source: { type: "user", userId: "U1" }, replyToken: "r", message: { id: "m1", ...message } } as Extract<LineEvent, { type: "message" }>;
}

function lineDeps(contents: Parameters<typeof fakeLine>[1] = {}) {
  const ev = memoryEvidenceRepo();
  const blobs = memoryBlobStore();
  const line = fakeLine({}, contents);
  return { ev, blobs, deps: { repo: ev.repo, store: blobs.store, line: line.client, limiter: memoryRateLimiter(), liffId: "LIFF", now: () => NOW, retryMs: 0 } };
}

describe("taiwanDateTime", () => {
  it("轉成台灣時間", () => {
    expect(taiwanDateTime(new Date("2026-11-13T16:05:09Z"))).toBe("2026/11/14 00:05:09");
  });
});

describe("saveFromLine：聊天室收件", () => {
  it("圖片：存原檔＋預覽縮圖，雜湊正確，回時間戳卡片", async () => {
    const { ev, blobs, deps } = lineDeps({
      m1: { kind: "ok", content: { data: JPEG, contentType: "image/jpeg" } },
      "m1/preview": { kind: "ok", content: { data: Buffer.from("thumb"), contentType: "image/jpeg" } },
    });
    const out = await saveFromLine({ uid: "U1", event: msgEvent({ type: "image" }) }, deps);
    const rec = ev.records.get("U1/e1")!;
    expect(rec.type).toBe("photo");
    expect(rec.sha256).toBe(hash(JPEG));
    expect(rec.createdAt).toEqual(NOW);
    expect(rec.occurredAt.toISOString()).toBe("2026-11-14T02:30:00.000Z");
    expect(blobs.files.get("users/U1/evidence/e1")?.data).toEqual(JPEG);
    expect(blobs.files.has("users/U1/evidence/e1_thumb.jpg")).toBe(true);
    const card = JSON.stringify(out[0]);
    expect(card).toContain("已存證");
    expect(card).toContain("2026/11/14 10:30:05");
    expect(card).toContain(hash(JPEG));
    expect(card).toContain("evCat");
  });

  it("檔案保留檔名；太大、過期、轉檔中各有提示，不存資料", async () => {
    const ok = lineDeps({ m1: { kind: "ok", content: { data: Buffer.from("%PDF"), contentType: "application/pdf" } } });
    await saveFromLine({ uid: "U1", event: msgEvent({ type: "file", fileName: "租約.pdf" }) }, ok.deps);
    expect(ok.ev.records.get("U1/e1")).toMatchObject({ type: "document", fileName: "租約.pdf", thumbPath: null });

    for (const [content, msg] of [
      [{ kind: "too_large" }, MSG.tooLarge],
      [{ kind: "not_found" }, MSG.expired],
      [{ kind: "not_ready" }, MSG.notReady],
    ] as const) {
      const d = lineDeps({ m1: content });
      expect(await saveFromLine({ uid: "U1", event: msgEvent({ type: "video" }) }, d.deps)).toEqual([msg]);
      expect(d.ev.records.size).toBe(0);
    }
  });

  it("#存證 文字：存成文字紀錄並遮蔽個資；只有標籤沒內容時提示", async () => {
    const { ev, deps } = lineDeps();
    await saveFromLine({ uid: "U1", event: msgEvent({ type: "text", text: "#存證 房東電話 0912-345-678 說下週修" }) }, deps);
    const rec = ev.records.get("U1/e1")!;
    expect(rec.type).toBe("note");
    expect(rec.text).not.toContain("0912");
    expect(rec.sha256).toBe(hash(rec.text));
    expect(rec.storagePath).toBeNull();
    expect(await saveFromLine({ uid: "U1", event: msgEvent({ type: "text", text: "#存證   " }) }, deps)).toEqual([MSG.noteEmpty]);
  });

  it("寫紀錄失敗時刪掉已上傳的檔案", async () => {
    const { ev, blobs, deps } = lineDeps();
    ev.repo.add = async () => {
      throw new Error("boom");
    };
    await expect(
      storeEvidence("U1", { type: "photo", category: "other", text: "", fileName: null, mimeType: "image/jpeg", data: JPEG, thumb: JPEG, source: "line" }, deps),
    ).rejects.toThrow("boom");
    expect(blobs.files.size).toBe(0);
  });
});

describe("webhook 接存證", () => {
  it("圖片走 saveEvidence；改分類 postback 走 setEvidenceCategory", async () => {
    const calls: string[] = [];
    const deps = {
      line: fakeLine().client,
      users: memoryUserRepo().repo,
      liffId: "LIFF",
      saveEvidence: async () => (calls.push("save"), []),
      setEvidenceCategory: async (a: { id: string; category: string }) => (calls.push(`cat:${a.id}:${a.category}`), []),
    };
    await handleEvent(msgEvent({ type: "image" }), deps);
    const data = (categoryQuickReply("e9").items[0]!.action as { data: string }).data;
    expect(parsePostback(data)).toEqual({ action: "evCat", id: "e9", category: "repair" });
    await handleEvent({ type: "postback", timestamp: 0, source: { type: "user", userId: "U1" }, postback: { data } } as LineEvent, deps);
    expect(calls).toEqual(["save", "cat:e9:repair"]);
  });

  it("卡片 altText 與按鈕", () => {
    const card = evidenceCard(
      { id: "e1", type: "note", category: "repair", text: "漏水", fileName: null, mimeType: null, bytes: 6, storagePath: null, thumbPath: null, sha256: "ab", source: "line", occurredAt: NOW, createdAt: NOW },
      "LIFF",
    );
    expect(card.altText).toBe("已存證：文字紀錄（2026/11/14 10:30:05）");
    expect(JSON.stringify(card)).toContain("https://liff.line.me/LIFF/evidence");
  });
});

describe("LINE getContent", () => {
  it("202 回 not_ready；超過上限回 too_large", async () => {
    const mk = (status: number, len: number) =>
      createLineClient("t", (async () => new Response(status === 202 ? null : "x".repeat(len), { status, headers: { "content-length": String(len), "content-type": "image/jpeg" } })) as unknown as typeof fetch);
    expect(await mk(202, 0).getContent("m", { maxBytes: 10 })).toEqual({ kind: "not_ready" });
    expect(await mk(200, 20).getContent("m", { maxBytes: 10 })).toEqual({ kind: "too_large" });
    expect((await mk(200, 3).getContent("m", { maxBytes: 10 })).kind).toBe("ok");
  });
});

describe("存證廊 API", () => {
  function setup() {
    const ev = memoryEvidenceRepo();
    const blobs = memoryBlobStore();
    const tokens = memoryTokenRepo();
    let now = NOW;
    const deps: ApiDeps = {
      verify: async (t) => {
        if (t === "good") return { uid: "U1", name: "小美" };
        if (t === "other") return { uid: "U2", name: "阿明" };
        throw new AuthError("bad");
      },
      users: memoryUserRepo().repo,
      limiter: memoryRateLimiter(),
      kb: emptyKbIndex,
      viewings: memoryViewingRepo().repo,
      lease: undefined,
      evidence: { repo: ev.repo, store: blobs.store, tokens: tokens.repo, now: () => now },
    };
    void memoryLeaseRepo;
    const api = (path: string, body?: unknown, token = "good", method = "POST") =>
      handleApi({ method, path: `/api${path}`, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, deps);
    return { api, ev, blobs, tokens, setNow: (d: Date) => (now = d) };
  }

  it("上傳照片＋縮圖、列表、讀檔；別人讀不到", async () => {
    const { api } = setup();
    const up = await api("/evidence/upload", { mimeType: "image/jpeg", data: JPEG.toString("base64"), thumb: "dGh1bWI=", text: "浴室漏水", category: "repair" });
    expect(up.status).toBe(200);
    const item = (up.body as { item: { id: string; sha256: string; hasThumb: boolean } }).item;
    expect(item.sha256).toBe(hash(JPEG));
    expect(item.hasThumb).toBe(true);
    expect(JSON.stringify(up.body)).not.toContain("users/U1");

    const list = await api("/evidence/list", { category: "repair" });
    expect((list.body as { items: unknown[] }).items).toHaveLength(1);
    expect(((await api("/evidence/list", { category: "rent" })).body as { items: unknown[] }).items).toHaveLength(0);

    const file = await api("/evidence/file", { id: item.id });
    expect(file.raw?.data).toEqual(JPEG);
    expect(file.raw?.contentType).toBe("image/jpeg");
    expect((await api("/evidence/file", { id: item.id, thumb: true })).raw?.data.toString()).toBe("thumb");
    expect((await api("/evidence/file", { id: item.id }, "other")).status).toBe(404);
  });

  it("改描述、分類、發生時間；文字紀錄內容不能改；未來時間拒絕", async () => {
    const { api } = setup();
    const up = await api("/evidence/upload", { mimeType: "application/pdf", data: "JVBERg==", fileName: "租約.pdf" });
    const id = (up.body as { item: { id: string } }).item.id;
    const upd = await api("/evidence/update", { id, text: "簽約當天拿到的租約", category: "rent", occurredAt: "2026-11-01T10:00:00+08:00" });
    expect(upd.status).toBe(200);
    expect((upd.body as { item: { category: string; occurredAt: string; createdAt: string } }).item).toMatchObject({
      category: "rent",
      occurredAt: "2026-11-01T02:00:00.000Z",
      createdAt: NOW.toISOString(),
    });
    expect((await api("/evidence/update", { id, occurredAt: "2027-01-01T00:00:00+08:00" })).status).toBe(400);

    const note = await api("/evidence/note", { text: "房東答應月底前修" });
    const nid = (note.body as { item: { id: string } }).item.id;
    expect((await api("/evidence/update", { id: nid, text: "改掉內容" })).status).toBe(400);
    expect((await api("/evidence/update", { id: nid, category: "repair" })).status).toBe(200);
    expect((await api("/evidence/update", { id: nid, category: "repair" }, "other")).status).toBe(404);
  });

  it("刪除會一併刪掉檔案與縮圖", async () => {
    const { api, blobs } = setup();
    const up = await api("/evidence/upload", { mimeType: "image/jpeg", data: JPEG.toString("base64"), thumb: "dGh1bWI=" });
    const id = (up.body as { item: { id: string } }).item.id;
    expect(blobs.files.size).toBe(2);
    expect((await api("/evidence/delete", { id }, "other")).status).toBe(404);
    expect((await api("/evidence/delete", { id })).status).toBe(200);
    expect(blobs.files.size).toBe(0);
  });

  it("每日匯出上限用完回 429 daily_limit（與每分鐘限流區分）", async () => {
    const { api } = setup();
    await api("/evidence/note", { text: "房東答應月底前修" });
    for (let i = 0; i < 20; i++) expect((await api("/evidence/export", {})).status).toBe(200);
    const res = await api("/evidence/export", {});
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "daily_limit" });
  });

  it("上傳太大回 413", async () => {
    const { api } = setup();
    const big = Buffer.alloc(10 * 1024 * 1024 + 10).toString("base64");
    expect((await api("/evidence/upload", { mimeType: "video/mp4", data: big })).status).toBe(413);
  });

  it("匯出：產生下載連結，不用登入即可下載 PDF；過期後 410", async () => {
    const { api, setNow } = setup();
    expect((await api("/evidence/export", {})).status).toBe(400);
    await api("/evidence/note", { text: "房東答應月底前修" });
    const ex = await api("/evidence/export", {});
    const { url, count } = ex.body as { url: string; count: number };
    expect(count).toBe(1);
    expect(url).toMatch(/^\/api\/evidence\/download\//);
    const dl = await api(url.replace(/^\/api/, ""), undefined, "", "GET");
    expect(dl.status).toBe(200);
    expect(dl.raw?.contentType).toBe("application/pdf");
    expect(dl.raw?.data.subarray(0, 4).toString()).toBe("%PDF");
    expect(dl.raw?.filename).toBe("evidence-20261114.pdf");
    setNow(new Date(NOW.getTime() + 11 * 60_000));
    expect((await api(url.replace(/^\/api/, ""), undefined, "", "GET")).status).toBe(410);
    expect((await api("/evidence/download/short", undefined, "", "GET")).status).toBe(404);
  });
});

describe("buildEvidencePdf", () => {
  it("中文字型可嵌入，含雜湊值文字", async () => {
    const pdf = await buildEvidencePdf(
      [{ id: "e1", type: "note", category: "repair", text: "漏水", fileName: null, mimeType: null, bytes: 6, storagePath: null, thumbPath: null, sha256: "a".repeat(64), source: "line", occurredAt: NOW, createdAt: NOW }],
      new Map(),
      { generatedAt: NOW },
    );
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(5000);
  });

  it("頁尾不會多產生空白頁：1 筆 1 頁，多筆依內容分頁", async () => {
    const pages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
    const item = (i: number) => ({ id: `e${i}`, type: "note" as const, category: "repair" as const, text: "漏水", fileName: null, mimeType: null, bytes: 6, storagePath: null, thumbPath: null, sha256: "a".repeat(64), source: "line" as const, occurredAt: NOW, createdAt: NOW });
    expect(pages(await buildEvidencePdf([item(1)], new Map(), { generatedAt: NOW }))).toBe(1);
    expect(pages(await buildEvidencePdf([], new Map(), { generatedAt: NOW }))).toBe(1);
    const many = await buildEvidencePdf(Array.from({ length: 12 }, (_, i) => item(i)), new Map(), { generatedAt: NOW });
    expect(pages(many)).toBeGreaterThan(1);
    expect(pages(many)).toBeLessThanOrEqual(3);
  });
});
