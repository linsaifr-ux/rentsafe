import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError, type api, type LeaseResult, type Me } from "../api.ts";
import { DISCLAIMER_TEXT } from "../components/Disclaimer.tsx";
import { fitSize, type PreparedFile } from "../lease/prepare.ts";
import { LeaseCheck } from "./LeaseCheck.tsx";

afterEach(cleanup);

const me: Me = { displayName: "小美", city: "新北市", landlordType: "unknown", consentAt: null };

const RESULT: LeaseResult = {
  status: "ok",
  id: "l1",
  viewingId: null,
  label: "公館套房",
  createdAt: null,
  readability: "good",
  fields: { monthlyRent: 15000, deposit: 45000, leaseStart: "115年1月1日", leaseEnd: "115年12月31日", electricityRule: null },
  findings: [
    {
      ruleId: "tax_burden",
      level: "red",
      title: "要你負擔房屋稅或地價稅",
      explanation: "房屋稅、地價稅應該由房東負擔。",
      detail: null,
      quotes: ["房屋稅、地價稅由承租人負擔"],
      negotiate: "「房屋稅、地價稅依規定是房東負擔，可以把這條拿掉嗎？」",
      basis: [
        { kind: "law", label: "民法第 427 條", quote: null, url: "https://law.moj.gov.tw/x" },
        { kind: "standard", label: "內政部《住宅租賃定型化契約應記載及不得記載事項》應記載事項第七點", quote: "租賃住宅之房屋稅、地價稅由出租人負擔", url: "https://glrs.moi.gov.tw/x" },
      ],
    },
    {
      ruleId: "electricity_rate",
      level: "yellow",
      title: "電費計算方式要確認",
      explanation: "…",
      detail: "這份租約寫每度 6 元，要對照電費單上的當期每度平均電價。",
      quotes: [],
      negotiate: "「可以讓我看電費單嗎？」",
      basis: [],
    },
  ],
  passed: [{ ruleId: "deposit_waiver", title: "押金不退或拋棄押金返還" }],
};

function file(name: string, type: string) {
  return new File(["x"], name, { type });
}

const prepare = vi.fn(async (f: File): Promise<PreparedFile> => ({
  name: f.name,
  mimeType: f.type === "application/pdf" ? "application/pdf" : "image/jpeg",
  data: "QUJD",
  bytes: 3,
  previewUrl: null,
}));

const HOMES = [
  { id: "v1", label: "公館套房", city: "臺北市", housingType: "studio", score: 80, redFlagCount: 1, createdAt: null, lease: null },
  { id: "v2", label: "景美雅房", city: "臺北市", housingType: "room", score: 60, redFlagCount: 2, createdAt: null, lease: null },
];

function setup(leaseCheck: typeof api.leaseCheck = vi.fn(async () => RESULT), initialViewingId = "") {
  const viewingHistory = vi.fn(async () => ({ viewings: HOMES, leaseOnly: [] }));
  render(<LeaseCheck me={me} onMeChange={() => {}} client={{ leaseCheck, viewingHistory }} prepare={prepare} initialViewingId={initialViewingId} />);
  return { leaseCheck };
}

describe("LeaseCheck", () => {
  it("說明不會存原圖；選照片後可以移除；沒選檔不能送出", async () => {
    setup();
    expect(screen.getByText("你的租約不會被存下來")).toBeTruthy();
    expect((screen.getByRole("button", { name: "請先拍照或選檔" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByTestId("lease-picker"), { target: { files: [file("p1.jpg", "image/jpeg"), file("p2.jpg", "image/jpeg")] } });
    const list = await screen.findByRole("list", { name: "已選的檔案" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "移除第 1 個檔案" }));
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(1));
  });

  it("PDF 只能單獨上傳", async () => {
    setup();
    fireEvent.change(screen.getByTestId("lease-picker"), { target: { files: [file("a.pdf", "application/pdf"), file("p.jpg", "image/jpeg")] } });
    expect(await screen.findByText("PDF 請單獨上傳一個檔案。")).toBeTruthy();
  });

  it("送出後顯示紅黃燈、租約原文、官方依據、談判話術與免責聲明", async () => {
    const { leaseCheck } = setup();
    fireEvent.change(screen.getByTestId("lease-picker"), { target: { files: [file("p1.jpg", "image/jpeg")] } });
    fireEvent.click(await screen.findByRole("button", { name: "開始健檢" }));

    expect((await screen.findByTestId("lease-red")).textContent).toBe("1");
    expect(leaseCheck).toHaveBeenCalledWith([{ mimeType: "image/jpeg", data: "QUJD" }], {});
    expect(screen.getByTestId("lease-yellow").textContent).toBe("1");
    const card = screen.getByRole("listitem", { name: "要你負擔房屋稅或地價稅" });
    expect(within(card).getByText("「房屋稅、地價稅由承租人負擔」")).toBeTruthy();
    expect(within(card).getByRole("link", { name: /民法第 427 條/ }).getAttribute("href")).toBe("https://law.moj.gov.tw/x");
    expect(within(card).getByText("「租賃住宅之房屋稅、地價稅由出租人負擔」")).toBeTruthy();
    expect(within(card).getByRole("button", { name: "複製這句話" })).toBeTruthy();
    expect(screen.getByText("這份租約寫每度 6 元，要對照電費單上的當期每度平均電價。")).toBeTruthy();
    expect(screen.getByText("45,000 元")).toBeTruthy();
    expect(screen.getByText(DISCLAIMER_TEXT)).toBeTruthy();
  });

  it("不是租約時提示重拍；API 錯誤顯示訊息", async () => {
    setup(vi.fn(async () => ({ status: "not_lease" as const, readability: "good" as const })));
    fireEvent.change(screen.getByTestId("lease-picker"), { target: { files: [file("p1.jpg", "image/jpeg")] } });
    fireEvent.click(await screen.findByRole("button", { name: "開始健檢" }));
    expect(await screen.findByText(/這看起來不像住宅租約/)).toBeTruthy();
    cleanup();

    setup(vi.fn(async () => Promise.reject(new ApiError(502, "analysis_failed"))));
    fireEvent.change(screen.getByTestId("lease-picker"), { target: { files: [file("p1.jpg", "image/jpeg")] } });
    fireEvent.click(await screen.findByRole("button", { name: "開始健檢" }));
    expect(await screen.findByText("分析失敗了，請確認照片清楚後再試一次。")).toBeTruthy();
  });
});

describe("LeaseCheck 指定租屋處", () => {
  it("從看房紀錄進來時預先選好那一間，送出時帶 viewingId", async () => {
    const { leaseCheck } = setup(undefined, "v2");
    const select = (await screen.findByLabelText("這是哪一間的租約？")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("v2"));
    expect(screen.queryByLabelText("名稱（選填）")).toBeNull();
    fireEvent.change(screen.getByTestId("lease-picker"), { target: { files: [file("p1.jpg", "image/jpeg")] } });
    fireEvent.click(await screen.findByRole("button", { name: "開始健檢" }));
    await waitFor(() => expect(leaseCheck).toHaveBeenCalledWith([{ mimeType: "image/jpeg", data: "QUJD" }], { viewingId: "v2" }));
  });

  it("不在看房紀錄裡時可以填名稱", async () => {
    const { leaseCheck } = setup();
    fireEvent.change(await screen.findByLabelText("名稱（選填）"), { target: { value: " 朋友的租約 " } });
    fireEvent.change(screen.getByTestId("lease-picker"), { target: { files: [file("p1.jpg", "image/jpeg")] } });
    fireEvent.click(await screen.findByRole("button", { name: "開始健檢" }));
    await waitFor(() => expect(leaseCheck).toHaveBeenCalledWith([{ mimeType: "image/jpeg", data: "QUJD" }], { label: "朋友的租約" }));
  });
});

describe("fitSize", () => {
  it("長邊縮到 2000 以內，小圖不放大", () => {
    expect(fitSize(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(fitSize(3000, 4000)).toEqual({ width: 1500, height: 2000 });
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe("LeaseCheck 入口", () => {
  it("表單上方有連到我的看房紀錄的卡片", () => {
    setup();
    expect(screen.getByRole("link", { name: /我的看房紀錄/ }).getAttribute("href")).toBe("/viewings");
  });
});
