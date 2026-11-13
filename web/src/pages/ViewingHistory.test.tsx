import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { LeaseResult, Me, ViewingChecklist, ViewingResult, ViewingSummary } from "../api.ts";
import { DISCLAIMER_TEXT } from "../components/Disclaimer.tsx";
import { ViewingHistory } from "./ViewingHistory.tsx";

afterEach(cleanup);

const me: Me = { displayName: "小美", city: "新北市", landlordType: "unknown", consentAt: null };

const checklist: ViewingChecklist = {
  housingTypes: [
    { id: "studio", label: "獨立套房", presetAnswers: {}, warning: null },
    { id: "rooftop", label: "頂樓加蓋", presetAnswers: { illegal_structure: "yes" }, warning: null },
  ],
  items: [
    { id: "smoke_alarm", question: "房間裡有裝住警器嗎？", why: "", weight: 3 },
    { id: "illegal_structure", question: "這間房是頂樓加蓋或其他違建嗎？", why: "", weight: 3 },
    { id: "deposit", question: "押金在兩個月租金以內嗎？", why: "", weight: 2 },
  ],
};

const LEASE_A = { id: "la", red: 3, yellow: 1, monthlyRent: 15000, deposit: 45000, depositMonths: 3, createdAt: null };

const summaries: ViewingSummary[] = [
  { id: "b", label: "B 頂加", city: "新北市", housingType: "rooftop", score: 40, redFlagCount: 2, createdAt: "2026-11-12T03:00:00Z", lease: null },
  { id: "a", label: "A 套房", city: "新北市", housingType: "studio", score: 90, redFlagCount: 0, createdAt: "2026-11-11T03:00:00Z", lease: LEASE_A },
  { id: "c", label: "C 雅房", city: null, housingType: "studio", score: 70, redFlagCount: 1, createdAt: null, lease: null },
  { id: "d", label: "D 地下室", city: null, housingType: "studio", score: 50, redFlagCount: 1, createdAt: null, lease: null },
];

const LEASE_RESULT: LeaseResult = {
  status: "ok",
  id: "la",
  viewingId: "a",
  label: "A 套房",
  createdAt: null,
  readability: "good",
  fields: { monthlyRent: 15000, deposit: 45000, leaseStart: null, leaseEnd: null, electricityRule: null },
  findings: [],
  passed: [],
};

function result(id: string, label: string, score: number, answers: ViewingResult["answers"], red: string[]): ViewingResult {
  return {
    id,
    label,
    city: "新北市",
    housingType: "studio",
    createdAt: null,
    answers,
    score,
    redFlags: red.map((r) => ({ id: r, question: r, why: "", weight: 3, citations: [] })),
    unknown: [],
    questions: [],
    warning: null,
    fireRule: { city: "新北市", national: null, local: [], note: null },
  };
}

const A = { ...result("a", "A 套房", 90, { smoke_alarm: "yes", illegal_structure: "no", deposit: "yes" }, []), lease: LEASE_A };
const B = result("b", "B 頂加", 40, { smoke_alarm: "no", illegal_structure: "yes", deposit: "yes" }, ["smoke_alarm", "illegal_structure"]);

function client() {
  return {
    viewingHistory: vi.fn(async () => ({ viewings: summaries, leaseOnly: [{ ...LEASE_A, id: "lx", label: "朋友的租約", red: 0, yellow: 0 }] })),
    leaseDetail: vi.fn(async () => LEASE_RESULT),
    deleteLease: vi.fn(async () => ({ ok: true as const })),
    viewingChecklist: vi.fn(async () => checklist),
    viewingDetail: vi.fn(async (ids: string[]) => ({ viewings: ids.map((id) => (id === "a" ? A : B)) })),
    deleteViewing: vi.fn(async () => ({ ok: true as const })),
  };
}

describe("ViewingHistory", () => {
  it("列出紀錄；最多勾 3 間；勾 2 間以上才能比較", async () => {
    render(<ViewingHistory me={me} onMeChange={() => {}} client={client()} />);
    expect(await screen.findByText("B 頂加")).toBeTruthy();
    expect(screen.getByText("新北市・頂樓加蓋・11/12")).toBeTruthy();
    const compare = () => screen.getByRole("button", { name: /比較|勾選/ }) as HTMLButtonElement;
    expect(compare().disabled).toBe(true);

    for (const l of ["B 頂加", "A 套房", "C 雅房"]) fireEvent.click(screen.getByRole("checkbox", { name: `比較 ${l}` }));
    expect(compare().textContent).toBe("比較 3 間");
    expect((screen.getByRole("checkbox", { name: "比較 D 地下室" }) as HTMLInputElement).disabled).toBe(true);
  });

  it("並排比較：分數、紅燈數、只顯示回答不同的題目並標出紅燈", async () => {
    const c = client();
    render(<ViewingHistory me={me} onMeChange={() => {}} client={c} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "比較 A 套房" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "比較 B 頂加" }));
    fireEvent.click(screen.getByRole("button", { name: "比較 2 間" }));

    expect(await screen.findByText("比較租屋處")).toBeTruthy();
    expect(c.viewingDetail).toHaveBeenCalledWith(["a", "b"]);
    expect(screen.getByText("最高")).toBeTruthy();
    expect(screen.getAllByTestId("compare-score").map((e) => e.textContent)).toEqual(["90", "40"]);
    const row = screen.getByRole("listitem", { name: "房間裡有裝住警器嗎？" });
    expect(within(row).getByText("🚩 否")).toBeTruthy();
    // 押金兩間都答「是」，預設不顯示
    expect(screen.queryByRole("listitem", { name: "押金在兩個月租金以內嗎？" })).toBeNull();

    fireEvent.click(screen.getByLabelText("只看回答不同的題目"));
    expect(screen.getByRole("listitem", { name: "押金在兩個月租金以內嗎？" })).toBeTruthy();
    expect(screen.getByText(DISCLAIMER_TEXT)).toBeTruthy();
  });

  it("點名稱看單筆結果，可以回到列表", async () => {
    render(<ViewingHistory me={me} onMeChange={() => {}} client={client()} />);
    fireEvent.click(await screen.findByText("A 套房"));
    expect(await screen.findByText("看房健檢結果")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "回到看房紀錄" }));
    expect(await screen.findByText("我的看房紀錄")).toBeTruthy();
  });

  it("沒有紀錄時引導去做健檢", async () => {
    const c = { ...client(), viewingHistory: vi.fn(async () => ({ viewings: [], leaseOnly: [] })) };
    render(<ViewingHistory me={me} onMeChange={() => {}} client={c} />);
    expect(await screen.findByRole("link", { name: "去做看房健檢" })).toBeTruthy();
  });

  it("在單筆結果刪除：先確認，刪除後回到列表且該筆消失", async () => {
    const c = client();
    render(<ViewingHistory me={me} onMeChange={() => {}} client={c} />);
    fireEvent.click(await screen.findByText("A 套房"));
    fireEvent.click(await screen.findByRole("button", { name: "🗑 刪除這筆紀錄" }));
    const dialog = screen.getByRole("dialog", { name: "刪除這筆看房紀錄？" });
    expect(within(dialog).getByText(/「A 套房」的.*永久刪除/)).toBeTruthy();

    // 取消不會刪
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(c.deleteViewing).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "🗑 刪除這筆紀錄" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "刪除" }));
    expect(await screen.findByText("我的看房紀錄")).toBeTruthy();
    expect(c.deleteViewing).toHaveBeenCalledWith("a");
    expect(screen.queryByText("A 套房")).toBeNull();
    expect(screen.getByText("B 頂加")).toBeTruthy();
  });

  it("刪除失敗時留在確認面板並顯示錯誤", async () => {
    const c = { ...client(), deleteViewing: vi.fn(async () => Promise.reject(new Error("x"))) };
    render(<ViewingHistory me={me} onMeChange={() => {}} client={c} />);
    fireEvent.click(await screen.findByText("A 套房"));
    fireEvent.click(await screen.findByRole("button", { name: "🗑 刪除這筆紀錄" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "刪除" }));
    expect(await within(screen.getByRole("dialog")).findByText("系統暫時出了點問題，請稍後再試。")).toBeTruthy();
  });

  it("列表顯示租約紅黃燈標籤與「只有租約」", async () => {
    render(<ViewingHistory me={me} onMeChange={() => {}} client={client()} />);
    const row = (await screen.findByText("A 套房")).closest("li")!;
    expect(within(row).getByLabelText("租約紅燈 3")).toBeTruthy();
    expect(within(row).getByLabelText("租約黃燈 1")).toBeTruthy();
    expect(screen.getByText("📄 只有租約")).toBeTruthy();
    expect(screen.getByText("朋友的租約")).toBeTruthy();
  });

  it("單筆頁：有租約顯示摘要並可打開；沒有租約顯示「幫這間做租約健檢」", async () => {
    const c = client();
    render(<ViewingHistory me={me} onMeChange={() => {}} client={c} />);
    fireEvent.click(await screen.findByText("A 套房"));
    expect(await screen.findByText("📄 這間的租約健檢")).toBeTruthy();
    expect(screen.getByText("3 個月")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "看租約健檢結果" }));
    expect(await screen.findByText("租約健檢結果")).toBeTruthy();
    expect(c.leaseDetail).toHaveBeenCalledWith("la");
    fireEvent.click(screen.getByRole("button", { name: "回到「A 套房」" }));
    expect(await screen.findByText("📄 這間的租約健檢")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "回到看房紀錄" }));

    fireEvent.click(await screen.findByText("B 頂加"));
    const link = await screen.findByRole("link", { name: "幫這間做租約健檢" });
    expect(link.getAttribute("href")).toBe("/lease?viewing=b");
  });

  it("刪除有租約的那間時，確認面板說明會一起刪租約", async () => {
    render(<ViewingHistory me={me} onMeChange={() => {}} client={client()} />);
    fireEvent.click(await screen.findByText("A 套房"));
    fireEvent.click(await screen.findByRole("button", { name: "🗑 刪除這筆紀錄" }));
    expect(within(screen.getByRole("dialog")).getByText(/看房結果和這間的租約健檢會一起永久刪除/)).toBeTruthy();
  });

  it("比較時多出月租金、押金、租約紅燈", async () => {
    render(<ViewingHistory me={me} onMeChange={() => {}} client={client()} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "比較 A 套房" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "比較 B 頂加" }));
    fireEvent.click(screen.getByRole("button", { name: "比較 2 間" }));
    const rent = await screen.findByRole("listitem", { name: "月租金" });
    expect(within(rent).getByText("15,000 元")).toBeTruthy();
    expect(within(rent).getByText("—")).toBeTruthy();
    expect(within(screen.getByRole("listitem", { name: "押金" })).getByText("3 個月")).toBeTruthy();
    expect(within(screen.getByRole("listitem", { name: "租約紅燈" })).getByText("3")).toBeTruthy();
  });
});

