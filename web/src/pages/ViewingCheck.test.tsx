import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Me, ViewingChecklist, ViewingResult } from "../api.ts";
import { DISCLAIMER_TEXT } from "../components/Disclaimer.tsx";
import { ViewingCheck } from "./ViewingCheck.tsx";

afterEach(cleanup);

const me: Me = { displayName: "小美", city: "新北市", landlordType: "unknown", consentAt: null };

const checklist: ViewingChecklist = {
  housingTypes: [
    { id: "studio", label: "獨立套房", presetAnswers: {}, warning: null },
    { id: "rooftop", label: "頂樓加蓋", presetAnswers: { illegal_structure: "yes" }, warning: null },
  ],
  items: [
    { id: "smoke_alarm", question: "房間裡有裝住警器嗎？", why: "住警器能及早警報。", weight: 3 },
    { id: "illegal_structure", question: "這間房是頂樓加蓋或其他違建嗎？", why: "逃生路線少。", weight: 3 },
  ],
};

const result: ViewingResult = {
  id: "v1",
  label: "公館套房",
  city: "新北市",
  housingType: "rooftop",
  createdAt: null,
  answers: { smoke_alarm: "no", illegal_structure: "yes" },
  score: 25,
  redFlags: [
    {
      id: "smoke_alarm",
      question: "房間裡有裝住警器嗎？",
      why: "消防法規定…",
      weight: 3,
      citations: [{ lawName: "消防法", articleNo: "6", url: "https://law.moj.gov.tw/x" }],
    },
  ],
  unknown: [],
  questions: ["房間有裝住警器嗎？", "這間是合法登記的房間嗎？"],
  warning: null,
  fireRule: {
    city: "新北市",
    national: { lawName: "消防法", articleNo: "6", text: "全國條文", sourceUrl: "https://law.moj.gov.tw/a" },
    local: [{ lawName: "新北市火災預防自治條例", articleNo: "5", text: "本市供學生承租…", sourceUrl: "https://web.law.ntpc.gov.tw/a" }],
    note: null,
  },
};

function client() {
  return {
    viewingChecklist: vi.fn(async () => checklist),
    submitViewing: vi.fn(async () => result),
  };
}

describe("ViewingCheck", () => {
  it("預設帶入使用者縣市；選頂樓加蓋時自動帶入違建答案並鎖定", async () => {
    render(<ViewingCheck me={me} onMeChange={() => {}} client={client()} />);
    const select = (await screen.findByLabelText("房子在哪個縣市")) as HTMLSelectElement;
    expect(select.value).toBe("新北市");
    expect((screen.getByRole("button", { name: "請先選房型" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "頂樓加蓋" }));
    const group = screen.getByRole("radiogroup", { name: "這間房是頂樓加蓋或其他違建嗎？" });
    const yes = within(group).getByRole("radio", { name: "是" }) as HTMLButtonElement;
    expect(yes.getAttribute("aria-checked")).toBe("true");
    expect(yes.disabled).toBe(true);
  });

  it("送出後顯示分數、紅燈出處、當地住警器規定、問房東的問題與免責聲明", async () => {
    const c = client();
    render(<ViewingCheck me={me} onMeChange={() => {}} client={c} />);
    fireEvent.change(await screen.findByLabelText("這間的名稱或地址（選填）"), { target: { value: " 公館套房 " } });
    fireEvent.click(screen.getByRole("button", { name: "頂樓加蓋" }));
    const group = screen.getByRole("radiogroup", { name: "房間裡有裝住警器嗎？" });
    fireEvent.click(within(group).getByRole("radio", { name: "否" }));
    fireEvent.click(screen.getByRole("button", { name: "看結果" }));

    expect((await screen.findByTestId("viewing-score")).textContent).toBe("25");
    expect(c.submitViewing).toHaveBeenCalledWith({ label: "公館套房", city: "新北市", housingType: "rooftop", answers: { smoke_alarm: "no" } });
    expect(screen.getByRole("link", { name: "消防法第 6 條" }).getAttribute("href")).toBe("https://law.moj.gov.tw/x");
    expect(screen.getByText("新北市火災預防自治條例 第 5 條")).toBeTruthy();
    expect(screen.getByText("房間有裝住警器嗎？")).toBeTruthy();
    expect(screen.getByRole("button", { name: "複製問題" })).toBeTruthy();
    expect(screen.getByText(DISCLAIMER_TEXT)).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "我的看房紀錄" })[0]!.getAttribute("href")).toBe("/viewings");
  });

  it("載入清單失敗顯示錯誤", async () => {
    const c = { viewingChecklist: vi.fn(async () => Promise.reject(new Error("x"))), submitViewing: vi.fn() };
    render(<ViewingCheck me={me} onMeChange={() => {}} client={c} />);
    expect(await screen.findByText("系統暫時出了點問題，請稍後再試。")).toBeTruthy();
  });
});
