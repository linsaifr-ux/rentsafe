import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripSpaces } from "../src/ai/citeCheck.js";
import type { Llm, LlmRequest } from "../src/ai/llm.js";
import type { LeaseExtract } from "../src/ai/prompts/leaseExtract.v1.js";
import { AuthError } from "../src/api/auth.js";
import type { ApiDeps } from "../src/api/http.js";
import { base64Bytes } from "../src/api/lease.js";
import { handleApi } from "../src/api/router.js";
import { loadKb } from "../src/kb/load.js";
import { checkLease, depositMonthsOf, numericChecks, validQuote } from "../src/lease/check.js";
import { MASK, maskDeep, maskPii } from "../src/lease/pii.js";
import { loadRuleset, semanticRules } from "../src/lease/ruleset.js";
import { memoryRateLimiter } from "../src/rateLimit.js";
import { emptyKbIndex, memoryLeaseRepo, memoryUserRepo, memoryViewingRepo } from "./fakes.js";

const rs = loadRuleset();
const STANDARD = readFileSync(fileURLToPath(new URL("../../kb/contract-standard/GL000907.md", import.meta.url)), "utf8");

describe("kb/contract-rules.yaml", () => {
  it("涵蓋 SPEC 8.3 的所有規則", () => {
    expect(rs.rules.map((r) => r.id)).toEqual([
      "deposit_max",
      "electricity_public_fee",
      "electricity_rate",
      "review_period",
      "early_termination_penalty",
      "tax_burden",
      "deposit_waiver",
      "repair_all_tenant",
      "subsidy_ban",
      "missing_fields",
    ]);
    expect(rs.standard.sourceUrl).toBe("https://glrs.moi.gov.tw/LawContent.aspx?id=GL000907");
  });

  it("官方依據的引文都逐字出現在 kb/contract-standard/GL000907.md（不可憑記憶寫）", () => {
    const std = stripSpaces(STANDARD);
    for (const r of rs.rules) {
      for (const b of r.basis) {
        if (b.kind === "standard") expect(std, `${r.id}：${b.quote}`).toContain(stripSpaces(b.quote));
      }
    }
  });

  it("引用的法條都存在於 kb/laws", async () => {
    const { chunks } = await loadKb();
    const keys = new Set(chunks.map((c) => `${c.lawName}|${c.articleNo}`));
    for (const r of rs.rules) {
      for (const b of r.basis) {
        if (b.kind === "law") expect(keys, `${r.id}：${b.lawName} ${b.articleNo}`).toContain(`${b.lawName}|${b.articleNo}`);
      }
    }
  });

  it("除了「必要欄位」以外，每條規則都有官方依據；語意規則都有 hint", () => {
    for (const r of rs.rules) {
      if (r.id !== "missing_fields") expect(r.basis.length, r.id).toBeGreaterThan(0);
      if (r.check === "semantic") expect(r.hint, r.id).toBeTruthy();
    }
    expect(semanticRules(rs).map((r) => r.id)).toContain("tax_burden");
  });

  it("官方原文摘錄保留來源與修正日期", () => {
    expect(STANDARD).toContain("sourceUrl: https://glrs.moi.gov.tw/LawContent.aspx?id=GL000907");
    expect(STANDARD).toContain("updatedAt: 2025-04-18");
    expect(STANDARD).toContain("十、不得記載承租人不得申請租金補貼。");
  });
});

describe("maskPii（SPEC 8.1 遮蔽測試）", () => {
  it("身分證字號", () => {
    expect(maskPii("身分證字號 A123456789、B287654321")).toBe(`身分證字號 ${MASK.id}、${MASK.id}`);
  });

  it("手機（有無連字號）與市話", () => {
    expect(maskPii("0912-345-678／0912345678")).toBe(`${MASK.phone}／${MASK.phone}`);
    expect(maskPii("電話 (02)2345-6789 或 02-2345-6789")).toBe(`電話 ${MASK.phone} 或 ${MASK.phone}`);
  });

  it("門牌號碼，但保留路名與縣市", () => {
    expect(maskPii("臺北市大安區羅斯福路三段12巷3弄45號5樓")).toBe("臺北市大安區羅斯福路三段○巷○弄○號○樓");
    expect(maskPii("新北市板橋區文化路一段188號")).toBe("新北市板橋區文化路一段○號");
  });

  it("標示後的姓名與已知姓名", () => {
    expect(maskPii("出租人：王大明\u3000承租人(乙方)：林小美")).toBe(`出租人：${MASK.name}\u3000承租人(乙方)：${MASK.name}`);
    expect(maskPii("本人王大明同意", ["王大明"])).toBe(`本人${MASK.name}同意`);
  });

  it("銀行帳號等長數字", () => {
    expect(maskPii("帳號 012-3456-7890-12")).toBe(`帳號 ${MASK.account}`);
  });

  it("不遮蔽金額、日期、條次與繳租日", () => {
    const s = "每月租金新臺幣15,000元，押金二個月，租期自115年1月1日至115年12月31日，每月5號前繳納，依第十四點辦理";
    expect(maskPii(s)).toBe(s);
  });

  it("maskDeep 遮蔽物件與陣列裡的字串，數字不動", () => {
    expect(maskDeep({ a: "A123456789", b: 15000, c: ["0912345678"], d: null }, [])).toEqual({ a: MASK.id, b: 15000, c: [MASK.phone], d: null });
  });
});

const BASE: LeaseExtract = {
  isLease: true,
  readability: "good",
  monthlyRent: 15000,
  deposit: 30000,
  depositMonths: null,
  leaseStart: "115年1月1日",
  leaseEnd: "115年12月31日",
  reviewPeriodDays: 3,
  electricityRule: "依台電電費單當期每度平均電價計收",
  electricityPricePerKwh: null,
  waterRule: null,
  managementFee: null,
  repairClause: "設備損壞由出租人修繕",
  earlyTerminationClause: null,
  earlyTerminationPenaltyMonths: 1,
  taxClause: null,
  subsidyOrRegistrationClause: null,
  clauses: [],
  partyNames: [],
};

describe("numericChecks", () => {
  it("合規的租約沒有任何數值問題", () => {
    expect([...numericChecks(BASE).keys()]).toEqual([]);
  });

  it("押金超過兩個月（用金額計算或直接寫月數）", () => {
    expect(numericChecks({ ...BASE, deposit: 45000 }).get("deposit_max")).toContain("3 個月");
    expect(depositMonthsOf({ deposit: null, monthlyRent: null, depositMonths: 3 })).toBe(3);
    expect(numericChecks({ ...BASE, deposit: null, depositMonths: 3 }).has("deposit_max")).toBe(true);
    expect(numericChecks({ ...BASE, deposit: 30000 }).has("deposit_max")).toBe(false);
  });

  it("電費：固定每度單價或沒寫 → 黃燈", () => {
    expect(numericChecks({ ...BASE, electricityPricePerKwh: 6 }).get("electricity_rate")).toContain("每度 6 元");
    expect(numericChecks({ ...BASE, electricityRule: null }).get("electricity_rate")).toContain("沒有寫電費");
  });

  it("審閱期少於 3 天、違約金超過 1 個月", () => {
    expect(numericChecks({ ...BASE, reviewPeriodDays: 1 }).has("review_period")).toBe(true);
    expect(numericChecks({ ...BASE, earlyTerminationPenaltyMonths: 2 }).get("early_termination_penalty")).toContain("2 個月");
  });

  it("缺租期、租金、押金、修繕", () => {
    const d = numericChecks({ ...BASE, leaseStart: null, leaseEnd: null, monthlyRent: null, deposit: null, repairClause: null }).get("missing_fields");
    expect(d).toBe("這份租約沒寫清楚：租期、租金、押金、修繕。");
  });
});

describe("validQuote", () => {
  it("忽略空白比對子字串；條款編號不存在或引文不在條款中都拒絕", () => {
    const clauses = ["房屋稅、地價稅由承租人負擔。"];
    expect(validQuote(clauses, 0, "房屋稅、地價稅 由承租人負擔")).toBe(true);
    expect(validQuote(clauses, 0, "房屋稅由出租人負擔")).toBe(false);
    expect(validQuote(clauses, 3, "房屋稅")).toBe(false);
  });
});

/** 依序回傳預設回應的假模型，記錄每次收到的請求 */
function scriptedLlm(responses: unknown[]) {
  const calls: LlmRequest[] = [];
  const llm: Llm = {
    async generate(req) {
      calls.push(req);
      const r = responses.shift();
      if (r === undefined) throw new Error("沒有更多預設回應");
      return JSON.stringify(r);
    },
  };
  return { llm, calls };
}

/** 示範租約：押金 3 個月、另收公共電費、房屋稅由承租人負擔 */
const SAMPLE: LeaseExtract = {
  ...BASE,
  deposit: 45000,
  electricityRule: "電費每度以6元計算，另每月收取公共電費300元",
  electricityPricePerKwh: 6,
  taxClause: "房屋稅、地價稅由承租人負擔。",
  clauses: [
    "出租人：王大明，身分證字號A123456789，電話0912-345-678。",
    "押金新臺幣45,000元。",
    "電費每度以6元計算，另每月收取公共電費300元。",
    "房屋稅、地價稅由承租人負擔。",
    "承租人不得申請租金補貼。",
  ],
  partyNames: ["王大明"],
};

const SEMANTIC = {
  matches: [
    { ruleId: "electricity_public_fee", clauseIndex: 2, quote: "另每月收取公共電費300元" },
    { ruleId: "tax_burden", clauseIndex: 3, quote: "房屋稅、地價稅由承租人負擔" },
    { ruleId: "subsidy_ban", clauseIndex: 4, quote: "承租人不得申請租金補貼" },
    // 模型亂編的引文：條款裡沒有 → 丟棄
    { ruleId: "deposit_waiver", clauseIndex: 1, quote: "押金一律不退還" },
  ],
};

const FILES = [{ mimeType: "image/jpeg", data: "AAAA" }];

describe("checkLease", () => {
  it("驗收範例：押金、電費、稅負三個紅燈；引文驗證；送語意比對前已遮蔽個資", async () => {
    const { llm, calls } = scriptedLlm([SAMPLE, SEMANTIC]);
    const r = await checkLease(FILES, rs, { llm });
    if (r.status !== "ok") throw new Error("expected ok");

    const red = r.findings.filter((f) => f.level === "red").map((f) => f.ruleId);
    expect(red).toEqual(expect.arrayContaining(["deposit_max", "electricity_public_fee", "tax_burden", "subsidy_ban"]));
    expect(r.findings.map((f) => f.ruleId)).not.toContain("deposit_waiver");
    expect(r.droppedMatches).toBe(1);
    // 紅燈排在黃燈前面
    const levels = r.findings.map((f) => f.level);
    expect(levels.indexOf("yellow")).toBeGreaterThan(levels.lastIndexOf("red"));

    // 第一次呼叫帶照片；第二次（語意）不帶照片，且看不到個資
    expect(calls[0]!.files).toEqual(FILES);
    expect(calls[1]!.files).toBeUndefined();
    for (const secret of ["王大明", "A123456789", "0912-345-678"]) expect(calls[1]!.user).not.toContain(secret);

    // 存檔／顯示的欄位也已遮蔽，且不含姓名清單
    const text = JSON.stringify(r.fields);
    for (const secret of ["王大明", "A123456789", "0912-345-678"]) expect(text).not.toContain(secret);
    expect(r.fields).not.toHaveProperty("partyNames");

    const tax = r.findings.find((f) => f.ruleId === "tax_burden")!;
    expect(tax.quotes).toEqual(["房屋稅、地價稅由承租人負擔"]);
    expect(tax.basis.map((b) => b.label)).toEqual([
      "民法第 427 條",
      "內政部《住宅租賃定型化契約應記載及不得記載事項》應記載事項第七點",
      "內政部《住宅租賃定型化契約應記載及不得記載事項》不得記載事項第五點",
    ]);
    expect(tax.basis[0]!.url).toBe("https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=B0000001&flno=427");
    expect(r.passed.map((p) => p.ruleId)).toContain("deposit_waiver");
  });

  it("不是租約時不做語意比對", async () => {
    const { llm, calls } = scriptedLlm([{ ...BASE, isLease: false, readability: "good" }]);
    expect(await checkLease(FILES, rs, { llm })).toEqual({ status: "not_lease", readability: "good" });
    expect(calls).toHaveLength(1);
  });
});

describe("API /lease/check", () => {
  function setup(responses: unknown[] = [SAMPLE, SEMANTIC]) {
    const { llm } = scriptedLlm(responses);
    const leases = memoryLeaseRepo();
    const viewings = memoryViewingRepo();
    const deps: ApiDeps = {
      verify: async (t) => {
        if (t === "good") return { uid: "U1", name: "小美" };
        if (t === "other") return { uid: "U2", name: "阿明" };
        throw new AuthError("bad");
      },
      users: memoryUserRepo().repo,
      limiter: memoryRateLimiter(),
      kb: emptyKbIndex,
      viewings: viewings.repo,
      lease: { llm, repo: leases.repo },
    };
    const api = (method: string, path: string, body?: unknown, token = "good") =>
      handleApi({ method, path, headers: { authorization: `Bearer ${token}` }, body }, deps);
    const call = (body: unknown, token = "good") => api("POST", "/api/lease/check", body, token);
    const records = leases.records;
    return { call, api, records, deps, viewings };
  }

  it("成功：回傳 findings，只存遮蔽後資料", async () => {
    const { call, records } = setup();
    const res = await call({ files: [{ mimeType: "image/jpeg", data: "QUJD" }] });
    expect(res.status).toBe(200);
    expect((res.body as { id: string }).id).toBe("l1");
    expect(records).toHaveLength(1);
    const saved = JSON.stringify(records[0]!.rec);
    for (const secret of ["王大明", "A123456789", "0912-345-678", "QUJD"]) expect(saved).not.toContain(secret);
    expect(records[0]!.rec.promptVersion).toBe("leaseExtract.v1+leaseSemantic.v1");
  });

  it("檔案格式、數量、大小檢查", async () => {
    const { call } = setup();
    expect((await call({ files: [] })).status).toBe(400);
    expect((await call({ files: [{ mimeType: "text/html", data: "QUJD" }] })).status).toBe(400);
    expect((await call({ files: [{ mimeType: "image/jpeg", data: "not base64!" }] })).status).toBe(400);
    expect((await call({ files: Array.from({ length: 7 }, () => ({ mimeType: "image/jpeg", data: "QUJD" })) })).status).toBe(400);
    expect(
      (await call({ files: [{ mimeType: "application/pdf", data: "QUJD" }, { mimeType: "image/jpeg", data: "QUJD" }] })).status,
    ).toBe(400);
    const big = "A".repeat(Math.ceil((8 * 1024 * 1024 * 4) / 3) + 8);
    expect((await call({ files: [{ mimeType: "image/jpeg", data: big }] })).status).toBe(413);
  });

  it("base64Bytes 計算解碼後大小", () => {
    expect(base64Bytes("QUJD")).toBe(3);
    expect(base64Bytes("QUI=")).toBe(2);
    expect(base64Bytes("QQ==")).toBe(1);
  });

  it("模型失敗回 502；沒設定租約健檢回 503；每日上限 429", async () => {
    const failing = setup([]);
    expect((await failing.call({ files: [{ mimeType: "image/jpeg", data: "QUJD" }] })).status).toBe(502);

    const none = setup();
    delete none.deps.lease;
    expect((await none.call({ files: [{ mimeType: "image/jpeg", data: "QUJD" }] })).status).toBe(503);

    const many = setup(Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? { ...BASE, isLease: false } : SEMANTIC)));
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await many.call({ files: [{ mimeType: "image/jpeg", data: "QUJD" }] })).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("指定看房紀錄：名稱沿用該間；不是自己的看房紀錄回 404；沒指定時自動命名", async () => {
    const { call, api, records } = setup([SAMPLE, SEMANTIC, SAMPLE, SEMANTIC]);
    const v = (await api("POST", "/api/viewing", { label: "公館套房", city: null, housingType: "studio", answers: {} })).body as { id: string };
    const res = await call({ files: [{ mimeType: "image/jpeg", data: "QUJD" }], viewingId: v.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ viewingId: v.id, label: "公館套房" });
    expect(records[0]!.rec.viewingId).toBe(v.id);
    expect(records[0]!.rec.passed.length).toBeGreaterThan(0);

    expect((await call({ files: [{ mimeType: "image/jpeg", data: "QUJD" }], viewingId: v.id }, "other")).status).toBe(404);

    const solo = await call({ files: [{ mimeType: "image/jpeg", data: "QUJD" }] });
    expect((solo.body as { label: string; viewingId: null }).label).toMatch(/^租約健檢 \d{1,2}\/\d{1,2}$/);
    expect((solo.body as { viewingId: null }).viewingId).toBeNull();
  });

  it("detail 與 delete 只能用在自己的紀錄", async () => {
    const { call, api } = setup();
    const { id } = (await call({ files: [{ mimeType: "image/jpeg", data: "QUJD" }] })).body as { id: string };
    const d = await api("POST", "/api/lease/detail", { id });
    expect(d.status).toBe(200);
    expect((d.body as { findings: unknown[] }).findings.length).toBeGreaterThan(0);
    expect((await api("POST", "/api/lease/detail", { id }, "other")).status).toBe(404);
    expect((await api("POST", "/api/lease/delete", { id }, "other")).status).toBe(404);
    expect((await api("POST", "/api/lease/delete", { id })).status).toBe(200);
    expect((await api("POST", "/api/lease/detail", { id })).status).toBe(404);
  });

  it("看房紀錄附上該間最新的租約摘要；只有租約的另外列出；刪一間時連同租約一起刪", async () => {
    const { call, api, records } = setup([SAMPLE, SEMANTIC, SAMPLE, SEMANTIC, SAMPLE, SEMANTIC]);
    const a = (await api("POST", "/api/viewing", { label: "A", city: null, housingType: "studio", answers: {} })).body as { id: string };
    const b = (await api("POST", "/api/viewing", { label: "B", city: null, housingType: "studio", answers: {} })).body as { id: string };
    await call({ files: [{ mimeType: "image/jpeg", data: "QUJD" }], viewingId: a.id });
    const latest = (await call({ files: [{ mimeType: "image/jpeg", data: "QUJD" }], viewingId: a.id })).body as { id: string };
    await call({ files: [{ mimeType: "image/jpeg", data: "QUJD" }], label: "朋友的租約" });

    type Hist = {
      viewings: Array<{ id: string; lease: { id: string; red: number; depositMonths: number } | null }>;
      leaseOnly: Array<{ label: string; red: number }>;
    };
    const hist = (await api("GET", "/api/viewing/history")).body as Hist;
    const rowA = hist.viewings.find((v) => v.id === a.id)!;
    expect(rowA.lease?.id).toBe(latest.id);
    expect(rowA.lease?.red).toBeGreaterThanOrEqual(3);
    expect(rowA.lease?.depositMonths).toBe(3);
    expect(hist.viewings.find((v) => v.id === b.id)!.lease).toBeNull();
    expect(hist.leaseOnly.map((l) => l.label)).toEqual(["朋友的租約"]);

    const detail = (await api("POST", "/api/viewing/detail", { ids: [a.id, b.id] })).body as { viewings: Array<{ lease: { monthlyRent: number } | null }> };
    expect(detail.viewings[0]!.lease?.monthlyRent).toBe(15000);
    expect(detail.viewings[1]!.lease).toBeNull();

    const del = await api("POST", "/api/viewing/delete", { id: a.id });
    expect(del.body).toEqual({ ok: true, leaseDeleted: 2 });
    expect(records.map((r) => r.rec.label)).toEqual(["朋友的租約"]);
  });
});

