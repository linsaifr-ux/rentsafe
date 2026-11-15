import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectEmergency } from "../src/ai/safety.js";
import type { QaLog, QaRecord } from "../src/ai/qaLog.js";
import { REQUIRED_ARTICLES } from "../src/ai/scenario.js";
import { handleApi } from "../src/api/router.js";
import type { ApiDeps } from "../src/api/http.js";
import { AuthError } from "../src/api/auth.js";
import { allSteps, CASE_SCENARIOS, loadFlows, STAGES } from "../src/cases/flows.js";
import { buildCasePdf } from "../src/cases/pdf.js";
import type { CaseSummary } from "../src/cases/summary.js";
import { kbFilePath } from "../src/kbFiles.js";
import { memoryRateLimiter } from "../src/rateLimit.js";
import {
  articlesKbIndex,
  memoryBlobStore,
  memoryCaseRepo,
  memoryEvidenceRepo,
  memoryTokenRepo,
  memoryUserRepo,
  memoryViewingRepo,
} from "./fakes.js";

const NOW = new Date("2026-11-15T04:00:00Z");

describe("emergency-flows.yaml", () => {
  const flows = loadFlows();

  it("五個情境都在，每個都有四段", () => {
    expect(flows.map((f) => f.id).sort()).toEqual([...CASE_SCENARIOS].sort());
    for (const f of flows) for (const s of STAGES) expect(f.stages[s].items.length).toBeGreaterThan(0);
  });

  it("「問這一步」的問題不會被當成緊急狀況", () => {
    for (const f of flows) for (const s of STAGES) expect(detectEmergency(f.stages[s].ask), `${f.id}.${s}`).toEqual({ emergency: false, kind: null });
  });

  it("不寫條號（條文由程式從官方原文帶出）", () => {
    const raw = readFileSync(kbFilePath("emergency-flows.yaml"), "utf8").replace(/^#.*$/gm, "");
    expect(raw).not.toMatch(/第\s*[0-9一二三四五六七八九十百]+\s*條/);
  });

  it("步驟 ID 不重複、連結只用允許的格式、外部來源是官方網站", () => {
    for (const f of flows) {
      const keys = allSteps(f).map((s) => s.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const { item } of allSteps(f)) {
        if (item.link) expect(item.link).toMatch(/^(\/(evidence|case)|tel:\d+|#(articles|fireRule))$/);
        for (const src of item.sources ?? []) expect(new URL(src.url).hostname).toMatch(/\.gov\.tw$/);
      }
    }
  });

  it("火災情境依 SPEC 10 有 119、拍照存證、火災證明、案件摘要", () => {
    const fire = flows.find((f) => f.id === "fire")!;
    const keys = allSteps(fire).map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(["now.call119", "today.photo", "week.fire_cert", "next.summary"]));
  });
});

function memoryQa(records: Array<QaRecord & { createdAt: Date }>): QaLog {
  return { add: async () => undefined, recent: async () => records };
}

const qaRec = (over: Partial<QaRecord & { createdAt: Date }>): QaRecord & { createdAt: Date } => ({
  question: "火災之後房東要我賠錢怎麼辦，我電話 0912345678",
  outcome: "answer",
  answer: "…",
  citations: [{ lawName: "民法", articleNo: "434" }],
  referred: false,
  latencyMs: 1,
  promptVersion: "answer.v1",
  scenario: "fire",
  citeCheck: { firstPassOk: true, retried: false, finalOk: true, degraded: false },
  createdAt: new Date(NOW.getTime() + 60_000),
  ...over,
});

function setup(qa: Array<QaRecord & { createdAt: Date }> = []) {
  const cases = memoryCaseRepo();
  const ev = memoryEvidenceRepo();
  const tokens = memoryTokenRepo();
  const users = memoryUserRepo();
  let now = NOW;
  const deps: ApiDeps = {
    verify: async (t) => {
      if (t === "good") return { uid: "U1", name: "小美" };
      if (t === "other") return { uid: "U2", name: "阿明" };
      throw new AuthError("bad");
    },
    users: users.repo,
    limiter: memoryRateLimiter(),
    kb: articlesKbIndex([
      { lawName: "民法", articleNo: "423", text: "出租人應以合於所約定使用收益之租賃物，交付承租人。" },
      { lawName: "民法", articleNo: "434", text: "（測試用條文）" },
      { lawName: "某市火災預防自治條例", articleNo: "5", text: "（測試用地方條文）", scope: "新北市" },
    ]),
    viewings: memoryViewingRepo().repo,
    evidence: { repo: ev.repo, store: memoryBlobStore().store, tokens: memoryTokenRepo().repo, now: () => now },
    cases: { repo: cases.repo, tokens: tokens.repo, qa: memoryQa(qa), now: () => now },
  };
  const api = (path: string, body?: unknown, token = "good", method = "POST") =>
    handleApi({ method, path: `/api${path}`, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, deps);
  return { api, cases, ev, users, setNow: (d: Date) => (now = d) };
}

async function addEvidence(ev: ReturnType<typeof memoryEvidenceRepo>, id: string, text: string) {
  await ev.repo.add("U1", id, {
    type: "photo",
    category: "safety",
    text,
    fileName: null,
    mimeType: "image/jpeg",
    bytes: 10,
    storagePath: null,
    thumbPath: null,
    sha256: "b".repeat(64),
    source: "liff",
    occurredAt: new Date("2026-11-14T10:00:00Z"),
    createdAt: NOW,
  });
}

type CaseBody = { case: { id: string; answers: { city: string | null; story: string }; checklistDone: string[]; evidenceIds: string[]; done: number; total: number } };

describe("cases API", () => {
  it("開案件會帶入使用者的縣市；別人看不到", async () => {
    const { api, users } = setup();
    await users.repo.ensure("U1", {});
    await users.repo.setCity("U1", "新北市");
    const res = await api("/cases/open", { scenario: "fire" });
    expect(res.status).toBe(200);
    const c = (res.body as CaseBody).case;
    expect(c.answers.city).toBe("新北市");
    expect(c.done).toBe(0);
    expect((await api("/cases/get", { id: c.id }, "other")).status).toBe(404);
    expect((await api("/cases/list", {})).body).toMatchObject({ cases: [{ id: c.id, scenario: "fire", label: "火災" }] });
  });

  it("取得案件：條文只列知識庫查得到的，火災附當地住警器規定", async () => {
    const { api, users } = setup();
    await users.repo.ensure("U1", {});
    await users.repo.setCity("U1", "新北市");
    const id = ((await api("/cases/open", { scenario: "fire" })).body as CaseBody).case.id;
    const got = (await api("/cases/get", { id })).body as {
      articles: Array<{ lawName: string; articleNo: string; text: string }>;
      fireRule: { local: unknown[] };
      referrals: Array<{ id: string }>;
    };
    // 情境必帶 423、424、434、消防法 6；知識庫只有 423、434
    expect(REQUIRED_ARTICLES.fire.length).toBe(4);
    expect(got.articles.map((a) => a.articleNo)).toEqual(["423", "434"]);
    expect(got.articles[0]!.text).toContain("出租人應以合於所約定");
    expect(got.fireRule.local).toHaveLength(1);
    expect(got.referrals.map((r) => r.id)).not.toContain("consumer");
  });

  it("勾選：過濾不存在的步驟；經過簡述遮蔽個資", async () => {
    const { api } = setup();
    const id = ((await api("/cases/open", { scenario: "leak" })).body as CaseBody).case.id;
    let c = ((await api("/cases/update", { id, checklistDone: ["today.photo", "bogus.x"] })).body as CaseBody).case;
    expect(c.checklistDone).toEqual(["today.photo"]);
    await api("/cases/update", { id, checklistDone: ["today.photo", "today.notify"] });
    c = (
      (await api("/cases/update", {
        id,
        answers: { occurredOn: "2026-11-10", city: null, landlordType: "individual", story: "房東 0912345678 都不回", wants: ["盡快修好", ""] },
      })).body as CaseBody
    ).case;
    expect(c.answers.story).not.toContain("0912345678");
    expect(c.done).toBe(2);
  });

  it("勾選時間不會被後續更新覆蓋", async () => {
    const { api, cases, setNow } = setup();
    const id = ((await api("/cases/open", { scenario: "leak" })).body as CaseBody).case.id;
    await api("/cases/update", { id, checklistDone: ["today.photo"] });
    setNow(new Date(NOW.getTime() + 3_600_000));
    await api("/cases/update", { id, checklistDone: ["today.photo", "today.notify"] });
    const c = await cases.repo.get("U1", id);
    expect(c!.doneAt["today.photo"]).toBe(NOW.toISOString());
    expect(c!.doneAt["today.notify"]).toBe(new Date(NOW.getTime() + 3_600_000).toISOString());
  });

  it("只能加入自己的存證", async () => {
    const { api, ev } = setup();
    await addEvidence(ev, "e1", "廚房燒焦");
    const id = ((await api("/cases/open", { scenario: "fire" })).body as CaseBody).case.id;
    const c = ((await api("/cases/update", { id, evidenceIds: ["e1", "nope"] })).body as CaseBody).case;
    expect(c.evidenceIds).toEqual(["e1"]);
  });

  it("摘要：事實、時間軸、證據、條文（含通過 citeCheck 的問答引用）、尚缺資料；不評估勝敗或金額", async () => {
    const { api, ev } = setup([
      qaRec({}),
      qaRec({ citations: [{ lawName: "民法", articleNo: "999" }], citeCheck: { firstPassOk: false, retried: true, finalOk: false, degraded: true } }),
      qaRec({ scenario: "deposit", citations: [{ lawName: "民法", articleNo: "423" }] }),
    ]);
    await addEvidence(ev, "e1", "廚房燒焦");
    const id = ((await api("/cases/open", { scenario: "fire" })).body as CaseBody).case.id;
    await api("/cases/update", {
      id,
      evidenceIds: ["e1"],
      checklistDone: ["now.safe", "today.photo"],
      answers: { occurredOn: "2026-11-14", city: "新北市", landlordType: "business", story: "廚房起火", wants: ["修復房屋"] },
    });
    const res = await api("/cases/summary", { id });
    expect(res.status).toBe(200);
    const { summary, text } = res.body as { summary: CaseSummary; text: string };
    expect(summary.facts).toMatchObject({ occurredOn: "2026-11-14", city: "新北市", story: "廚房起火" });
    expect(summary.evidence).toHaveLength(1);
    expect(summary.articles.map((a) => `${a.lawName}${a.articleNo}`)).toEqual(["民法423", "民法434", "某市火災預防自治條例5"]);
    expect(summary.timeline.map((t) => t.text)).toEqual(
      expect.arrayContaining(["發生火災", "存證：照片「廚房燒焦」", "完成：拍下現場和受損物品，存進存證廊"]),
    );
    const qaLine = summary.timeline.find((t) => t.text.startsWith("詢問租安心"));
    expect(qaLine?.text).not.toContain("0912345678");
    expect(summary.missing).toEqual(expect.arrayContaining(["今天：用文字訊息通知房東發生火災，保留訊息紀錄"]));
    expect(summary.missing).not.toContain("發生日期");
    expect(summary.referrals.map((r) => r.name)).toEqual(expect.arrayContaining(["消費者服務專線 1950"]));
    for (const banned of ["勝訴", "敗訴", "勝算", "可以獲賠", "賠償金額"]) expect(text).not.toContain(banned);
    expect(text).toContain("本服務提供法律資訊，不是法律意見");
  });

  it("匯出：下載連結不用登入、產生 PDF；過期 410", async () => {
    const { api, setNow } = setup();
    const id = ((await api("/cases/open", { scenario: "deposit" })).body as CaseBody).case.id;
    const ex = await api("/cases/export", { id });
    const { url } = ex.body as { url: string };
    expect(url).toMatch(/^\/api\/cases\/download\//);
    const dl = await api(url.replace(/^\/api/, ""), undefined, "", "GET");
    expect(dl.status).toBe(200);
    expect(dl.raw?.contentType).toBe("application/pdf");
    setNow(new Date(NOW.getTime() + 11 * 60_000));
    expect((await api(url.replace(/^\/api/, ""), undefined, "", "GET")).status).toBe(410);
  });

  it("刪除案件", async () => {
    const { api } = setup();
    const id = ((await api("/cases/open", { scenario: "deposit" })).body as CaseBody).case.id;
    expect((await api("/cases/delete", { id })).status).toBe(200);
    expect((await api("/cases/get", { id })).status).toBe(404);
  });
});

describe("buildCasePdf", () => {
  it("沒有空白頁", async () => {
    const pages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
    const s: CaseSummary = {
      generatedAt: NOW.toISOString(),
      scenario: "fire",
      scenarioLabel: "火災",
      facts: { occurredOn: "2026-11-14", city: "新北市", landlord: "個人房東", story: "廚房起火" },
      timeline: [{ at: NOW.toISOString(), text: "發生火災" }],
      evidence: [],
      articles: [],
      wants: [],
      missing: ["你希望的結果"],
      referrals: [],
      disclaimer: "本服務提供法律資訊，不是法律意見；個案請洽法扶專線或律師。",
    };
    expect(pages(await buildCasePdf(s))).toBe(1);
  });
});
