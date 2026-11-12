import { beforeAll, describe, expect, it } from "vitest";
import { fakeEmbedder } from "../src/ai/embed.js";
import { memoryKbIndex } from "../src/ai/memoryIndex.js";
import type { KbIndex } from "../src/ai/retrieve.js";
import { AuthError } from "../src/api/auth.js";
import type { ApiDeps } from "../src/api/http.js";
import { handleApi } from "../src/api/router.js";
import { loadKb } from "../src/kb/load.js";
import { memoryRateLimiter } from "../src/rateLimit.js";
import { checklistSchema, loadChecklist, type Answer, type Checklist } from "../src/viewing/checklist.js";
import { fireAlarmRule, LOCAL_PENDING_NOTE, NO_CITY_NOTE } from "../src/viewing/fireRule.js";
import { MAX_LANDLORD_QUESTIONS, scoreViewing } from "../src/viewing/score.js";
import { memoryUserRepo, memoryViewingRepo } from "./fakes.js";

const checklist = loadChecklist();

/** 每題都回答「安全」的答案 */
function allSafe(c: Checklist): Record<string, Answer> {
  return Object.fromEntries(c.items.map((it) => [it.id, it.redFlagIf === "yes" ? "no" : "yes"]));
}
function allRed(c: Checklist): Record<string, Answer> {
  return Object.fromEntries(c.items.map((it) => [it.id, it.redFlagIf]));
}

describe("kb/viewing-checklist.yaml", () => {
  it("格式正確，至少 15 題（SPEC 7）", () => {
    expect(checklist.items.length).toBeGreaterThanOrEqual(15);
    expect(checklist.housingTypes.map((h) => h.label)).toEqual(["整層住家", "獨立套房", "分租套房", "雅房", "頂樓加蓋", "地下室"]);
  });

  it("涵蓋 SPEC 7 列出的題目範圍", () => {
    const ids = checklist.items.map((it) => it.id);
    for (const id of [
      "smoke_alarm",
      "extinguisher",
      "second_exit",
      "window_bars",
      "partition_material",
      "wiring",
      "gas_heater",
      "illegal_structure",
      "building_use",
      "landlord_owner",
      "subsidy_registration",
      "deposit",
      "electricity",
      "repair_scope",
      "standard_contract",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("所有引用的條文都存在於 kb/laws（不可憑記憶寫條號）", async () => {
    const { chunks } = await loadKb();
    const kbKeys = new Set(chunks.filter((c) => c.scope === "national").map((c) => `${c.lawName}|${c.articleNo}`));
    for (const it of checklist.items) {
      for (const c of it.citations) expect(kbKeys, `${it.id} 引用 ${c.lawName} 第 ${c.articleNo} 條`).toContain(`${c.lawName}|${c.articleNo}`);
    }
  });

  it("說明裡提到法律規定的題目一定附出處", () => {
    for (const it of checklist.items) {
      if (/民法|條例|消防法|規定/.test(it.why)) expect(it.citations.length, it.id).toBeGreaterThan(0);
    }
  });

  it("schema 擋下重複 id 與指到不存在題目的 presetAnswers", () => {
    const item = checklist.items[0]!;
    const bad = { ...checklist, items: [...checklist.items, item] };
    expect(checklistSchema.safeParse(bad).success).toBe(false);
    const bad2 = { ...checklist, housingTypes: [{ id: "x", label: "x", presetAnswers: { nope: "yes" } }] };
    expect(checklistSchema.safeParse(bad2).success).toBe(false);
  });
});

describe("scoreViewing", () => {
  it("全部安全 100 分、全部紅燈 0 分、全部不確定 50 分", () => {
    expect(scoreViewing(checklist, { housingType: "studio", answers: allSafe(checklist) }).score).toBe(100);
    const red = scoreViewing(checklist, { housingType: "studio", answers: allRed(checklist) });
    expect(red.score).toBe(0);
    expect(red.redFlags).toHaveLength(checklist.items.length);
    const unsure = scoreViewing(checklist, { housingType: "studio", answers: {} });
    expect(unsure.score).toBe(50);
    expect(unsure.unknown).toHaveLength(checklist.items.length);
  });

  it("紅燈依權重排序，問房東的問題紅燈優先、最多 5 個", () => {
    const answers: Record<string, Answer> = { ...allSafe(checklist), electricity: "no", smoke_alarm: "no", deposit: "unknown" };
    const r = scoreViewing(checklist, { housingType: "studio", answers });
    expect(r.redFlags.map((f) => f.id)).toEqual(["smoke_alarm", "electricity"]);
    const ask = (id: string) => checklist.items.find((it) => it.id === id)!.askLandlord;
    expect(r.questions).toEqual([ask("smoke_alarm"), ask("electricity"), ask("deposit")]);

    const many = scoreViewing(checklist, { housingType: "studio", answers: allRed(checklist) });
    expect(many.questions).toHaveLength(MAX_LANDLORD_QUESTIONS);
  });

  it("頂樓加蓋自動把「頂加或違建」視為紅燈，就算使用者回答否", () => {
    const r = scoreViewing(checklist, { housingType: "rooftop", answers: { ...allSafe(checklist), illegal_structure: "no" } });
    expect(r.redFlags.map((f) => f.id)).toEqual(["illegal_structure"]);
    expect(r.answers.illegal_structure).toBe("yes");
  });

  it("地下室附提醒；紅燈附官方條文連結", () => {
    const r = scoreViewing(checklist, { housingType: "basement", answers: { ...allSafe(checklist), deposit: "no" } });
    expect(r.warning).toContain("地下室");
    expect(r.redFlags[0]!.citations).toEqual([
      {
        lawName: "租賃住宅市場發展及管理條例",
        articleNo: "7",
        url: "https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=D0060125&flno=7",
      },
    ]);
  });

  it("未知房型丟錯", () => {
    expect(() => scoreViewing(checklist, { housingType: "castle", answers: {} })).toThrow("未知的房型");
  });
});

describe("fireAlarmRule", () => {
  let kb: KbIndex;
  beforeAll(async () => {
    kb = await memoryKbIndex((await loadKb()).chunks, fakeEmbedder());
  });

  it("新北市：全國消防法第 6 條＋新北市火災預防自治條例第 5、14 條", async () => {
    const r = await fireAlarmRule(kb, "新北市");
    expect(r.national?.lawName).toBe("消防法");
    expect(r.national?.text).toContain("住宅用火災警報器");
    expect(r.local.map((a) => `${a.lawName}|${a.articleNo}`)).toEqual(["新北市火災預防自治條例|5", "新北市火災預防自治條例|14"]);
    expect(r.local[0]!.text).toContain("本市供學生承租及經本局公告指定之場所");
    expect(r.local[0]!.sourceUrl).toMatch(/^https:\/\/web\.law\.ntpc\.gov\.tw\//);
    expect(r.note).toBeNull();
  });

  it("待查的縣市只給全國規定並提醒洽消防局；沒選縣市也提醒", async () => {
    const taipei = await fireAlarmRule(kb, "臺北市");
    expect(taipei.local).toEqual([]);
    expect(taipei.note).toBe(LOCAL_PENDING_NOTE);
    expect((await fireAlarmRule(kb, null)).note).toBe(NO_CITY_NOTE);
  });
});

describe("API /viewing", () => {
  async function setup() {
    const viewings = memoryViewingRepo();
    const deps: ApiDeps = {
      verify: async (t) => {
        if (t !== "good") throw new AuthError("bad");
        return { uid: "U1", name: "小美" };
      },
      users: memoryUserRepo().repo,
      limiter: memoryRateLimiter(),
      kb: await memoryKbIndex((await loadKb()).chunks, fakeEmbedder()),
      viewings: viewings.repo,
    };
    const call = (method: string, path: string, body?: unknown) =>
      handleApi({ method, path, headers: { authorization: "Bearer good" }, body }, deps);
    return { call, viewings };
  }

  it("GET /viewing/checklist 回傳題目與房型", async () => {
    const { call } = await setup();
    const res = await call("GET", "/api/viewing/checklist");
    expect(res.status).toBe(200);
    const body = res.body as { items: unknown[]; housingTypes: Array<{ id: string }> };
    expect(body.items.length).toBe(checklist.items.length);
    expect(body.housingTypes.map((h) => h.id)).toContain("rooftop");
  });

  it("驗收範例：新北市頂樓加蓋 → 紅燈＋新北住警器規定，並存檔", async () => {
    const { call, viewings } = await setup();
    const res = await call("POST", "/api/viewing", {
      city: "新北市",
      housingType: "rooftop",
      answers: { smoke_alarm: "no", partition_material: "yes", second_exit: "no", deposit: "yes", hacker: "yes" },
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      id: string;
      score: number;
      redFlags: Array<{ id: string }>;
      questions: string[];
      fireRule: { local: Array<{ lawName: string; articleNo: string }> };
    };
    expect(body.redFlags.map((f) => f.id)).toEqual(expect.arrayContaining(["illegal_structure", "smoke_alarm", "partition_material", "second_exit"]));
    expect(body.fireRule.local.map((a) => a.articleNo)).toEqual(["5", "14"]);
    expect(body.questions).toHaveLength(5);
    expect(body.score).toBeLessThan(60);
    expect(viewings.records).toHaveLength(1);
    expect(viewings.records[0]!.uid).toBe("U1");
    expect(viewings.records[0]!.rec.answers).not.toHaveProperty("hacker");
    expect(viewings.records[0]!.rec.redFlags).toContain("illegal_structure");
    expect(body.id).toBe("v1");
  });

  it("房型或縣市不合法時回 400", async () => {
    const { call } = await setup();
    expect((await call("POST", "/api/viewing", { city: "新北市", housingType: "castle", answers: {} })).status).toBe(400);
    expect((await call("POST", "/api/viewing", { city: "火星", housingType: "studio", answers: {} })).status).toBe(400);
    expect((await call("POST", "/api/viewing", { city: null, housingType: "studio", answers: { smoke_alarm: "maybe" } })).status).toBe(400);
  });
});
