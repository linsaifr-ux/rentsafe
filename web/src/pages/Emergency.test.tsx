import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CaseClient, CaseDetail, CaseFull, CaseSummaryData, Flow, Me } from "../api.ts";
import { Emergency } from "./Emergency.tsx";
import { CaseSummary } from "./CaseSummary.tsx";

afterEach(cleanup);

const me: Me = { displayName: "小美", city: "新北市", landlordType: "unknown", consentAt: null };

const FIRE: Flow = {
  id: "fire",
  label: "火災",
  intro: "先顧好自己的安全。",
  wants: ["修復房屋", "終止租約"],
  stages: {
    now: { ask: "租屋處火災之後，我第一時間應該注意什麼？", items: [{ id: "call119", text: "撥打 119", link: "tel:119" }] },
    today: { ask: "今天要保存哪些證據？", items: [{ id: "photo", text: "拍下現場", link: "/evidence", key: true }] },
    week: {
      ask: "這週要做什麼？",
      items: [{ id: "fire_cert", text: "申請火災證明", sources: [{ label: "高雄市消防局", url: "https://fdkc.kcg.gov.tw/" }] }],
    },
    next: { ask: "可以找誰？", items: [{ id: "summary", text: "產生案件摘要", link: "/case" }] },
  },
};

const CASE: CaseFull = {
  id: "c1",
  scenario: "fire",
  label: "火災",
  done: 0,
  total: 4,
  hasSummary: false,
  updatedAt: "2026-11-15T04:00:00Z",
  createdAt: "2026-11-15T04:00:00Z",
  answers: { occurredOn: null, city: "新北市", landlordType: "unknown", story: "", wants: [] },
  checklistDone: [],
  evidenceIds: [],
};

const DETAIL: CaseDetail = {
  case: CASE,
  articles: [{ lawName: "民法", articleNo: "423", text: "出租人應以合於所約定使用收益之租賃物，交付承租人。", sourceUrl: "https://law.moj.gov.tw/x", scope: "national" }],
  fireRule: { city: "新北市", national: null, local: [], note: null },
  referrals: [{ id: "legal_aid", name: "法扶基金會", contact: "412-8518", hours: null, note: "免費", url: null }],
};

const SUMMARY: CaseSummaryData = {
  generatedAt: "2026-11-15T04:00:00Z",
  scenario: "fire",
  scenarioLabel: "火災",
  facts: { occurredOn: "2026-11-14", city: "新北市", landlord: "個人房東", story: "廚房起火" },
  timeline: [{ at: "2026-11-13T16:00:00Z", text: "發生火災" }],
  evidence: [{ id: "e1", occurredAt: "2026-11-14T10:00:00Z", type: "照片", category: "安全", text: "廚房燒焦", sha256: "b".repeat(64) }],
  articles: DETAIL.articles,
  wants: ["修復房屋"],
  missing: ["今天：拍下現場"],
  referrals: [{ name: "法扶基金會", contact: "412-8518", hours: null, note: "免費" }],
  disclaimer: "本服務提供法律資訊，不是法律意見；個案請洽法扶專線或律師。",
};

function fakeClient(over: Partial<CaseClient> = {}): CaseClient {
  return {
    flows: vi.fn(async () => ({ stages: [], flows: [FIRE] })),
    list: vi.fn(async () => ({ cases: [] })),
    open: vi.fn(async () => ({ case: CASE })),
    get: vi.fn(async () => DETAIL),
    update: vi.fn(async (b: { checklistDone?: string[] }) => ({ case: { ...CASE, checklistDone: b.checklistDone ?? [], done: b.checklistDone?.length ?? 0 } })),
    remove: vi.fn(async () => ({ ok: true as const })),
    summary: vi.fn(async () => ({ summary: SUMMARY, text: "租屋案件摘要：火災" })),
    exportPdf: vi.fn(async () => ({ url: "/api/cases/download/tok" })),
    evidenceList: vi.fn(async () => ({ items: [] })),
    ...over,
  } as CaseClient;
}

describe("Emergency 急救包", () => {
  it("選火災會開案件，顯示四段清單、條文與轉介", async () => {
    const client = fakeClient();
    render(<Emergency me={me} onMeChange={() => {}} client={client} initialId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /火災/ }));
    expect(client.open).toHaveBeenCalledWith("fire");
    expect(await screen.findByText("民法 第 423 條")).toBeTruthy();
    for (const s of ["現在", "今天", "本週", "下一步"]) expect(screen.getByRole("heading", { name: s })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "撥打 119" })).toBeTruthy();
    expect(screen.getByText("法扶基金會")).toBeTruthy();
    expect(screen.getByRole("link", { name: /高雄市消防局/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /產生案件摘要/ }).getAttribute("href")).toBe("/case?id=c1");
  });

  it("勾選步驟會存檔並更新進度", async () => {
    const client = fakeClient();
    render(<Emergency me={me} onMeChange={() => {}} client={client} initialId="c1" />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "拍下現場" }));
    await waitFor(() => expect(client.update).toHaveBeenCalledWith({ id: "c1", checklistDone: ["today.photo"] }));
    expect(await screen.findByText("完成 1 / 4 步")).toBeTruthy();
  });

  it("問這一步：不在聊天室時改成複製問題", async () => {
    const ask = vi.fn(async () => false);
    render(<Emergency me={me} onMeChange={() => {}} client={fakeClient()} ask={ask} initialId="c1" />);
    const buttons = await screen.findAllByRole("button", { name: "問這一步" });
    fireEvent.click(buttons[0]!);
    expect(ask).toHaveBeenCalledWith(FIRE.stages.now.ask);
    expect(await screen.findByRole("dialog", { name: "問這一步" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /複製問題/ })).toBeTruthy();
  });

  it("填案件資料：選希望的結果後儲存", async () => {
    const client = fakeClient();
    render(<Emergency me={me} onMeChange={() => {}} client={client} initialId="c1" />);
    fireEvent.click(await screen.findByRole("button", { name: /案件資料/ }));
    fireEvent.click(screen.getByRole("button", { name: "修復房屋" }));
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));
    await waitFor(() =>
      expect(client.update).toHaveBeenCalledWith({ id: "c1", answers: expect.objectContaining({ wants: ["修復房屋"], city: "新北市" }) as unknown }),
    );
  });
});

describe("CaseSummary 案件摘要", () => {
  it("顯示事實、時間軸、證據雜湊、條文、尚缺資料；可下載 PDF", async () => {
    const client = fakeClient();
    const openUrl = vi.fn();
    render(<CaseSummary me={me} onMeChange={() => {}} client={client} openUrl={openUrl} initialId="c1" />);
    expect(await screen.findByText("火災案件摘要")).toBeTruthy();
    expect(screen.getByText("廚房起火")).toBeTruthy();
    expect(screen.getByText("發生火災")).toBeTruthy();
    expect(screen.getByText("b".repeat(64))).toBeTruthy();
    expect(screen.getByText("民法 第 423 條")).toBeTruthy();
    expect(screen.getByText("還缺 1 項資料")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /下載 PDF/ }));
    fireEvent.click(screen.getByRole("button", { name: /我了解，下載/ }));
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith(expect.stringMatching(/\/api\/cases\/download\/tok$/)));
  });

  it("沒指定案件時列出案件可選", async () => {
    render(
      <CaseSummary
        me={me}
        onMeChange={() => {}}
        client={fakeClient({ list: vi.fn(async () => ({ cases: [CASE] })) })}
        openUrl={() => {}}
        initialId={null}
      />,
    );
    expect((await screen.findByRole("link", { name: /火災/ })).getAttribute("href")).toBe("/case?id=c1");
  });
});
