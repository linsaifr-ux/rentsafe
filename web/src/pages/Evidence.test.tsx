import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { EvidenceItem, Me } from "../api.ts";
import { Evidence } from "./Evidence.tsx";

afterEach(cleanup);

const me: Me = { displayName: "小美", city: "新北市", landlordType: "unknown", consentAt: null };

const base: Omit<EvidenceItem, "id" | "type" | "category" | "text" | "occurredAt"> = {
  fileName: null,
  mimeType: null,
  bytes: 10,
  hasFile: false,
  hasThumb: false,
  sha256: "a".repeat(64),
  source: "line",
  createdAt: "2026-11-14T02:30:05Z",
};

const ITEMS: EvidenceItem[] = [
  { ...base, id: "e2", type: "note", category: "repair", text: "房東說下週修熱水器", occurredAt: "2026-11-14T02:30:00Z" },
  { ...base, id: "e1", type: "document", category: "rent", text: "", fileName: "租約.pdf", hasFile: true, occurredAt: "2026-11-01T02:00:00Z" },
];

function setup(items = ITEMS) {
  const client = {
    evidenceList: vi.fn(async () => ({ items })),
    evidenceUpload: vi.fn(async () => ({ item: ITEMS[1]! })),
    evidenceNote: vi.fn(async (b: { text: string }) => ({ item: { ...ITEMS[0]!, id: "e3", text: b.text, occurredAt: "2026-11-14T03:00:00Z" } })),
    evidenceUpdate: vi.fn(async (b: { id: string; category?: string }) => ({ item: { ...ITEMS[0]!, ...b } as EvidenceItem })),
    evidenceDelete: vi.fn(async () => ({ ok: true as const })),
    evidenceFile: vi.fn(async () => new Blob(["x"])),
    evidenceExport: vi.fn(async () => ({ url: "/api/evidence/download/tok", count: 2, truncated: false })),
  };
  const openUrl = vi.fn();
  render(<Evidence me={me} onMeChange={() => {}} client={client} openUrl={openUrl} />);
  return { client, openUrl };
}

describe("Evidence 存證廊", () => {
  it("時間軸依日期分組，可依分類篩選", async () => {
    setup();
    expect(await screen.findByText("房東說下週修熱水器")).toBeTruthy();
    expect(screen.getByText("租約.pdf")).toBeTruthy();
    expect(screen.getByRole("region", { name: /2026年11月14日/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /租金/ }));
    expect(screen.queryByText("房東說下週修熱水器")).toBeNull();
    expect(screen.getByText("租約.pdf")).toBeTruthy();
    expect(screen.getByRole("button", { name: /匯出「租金」證據清單 PDF/ })).toBeTruthy();
  });

  it("沒有證據時顯示說明，不顯示匯出", async () => {
    setup([]);
    expect(await screen.findByText("還沒有證據")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /匯出/ })).toBeNull();
  });

  it("寫文字紀錄：選分類後存證，新的一筆出現在時間軸", async () => {
    const { client } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "寫紀錄" }));
    const sheet = screen.getByRole("dialog", { name: "寫一筆文字紀錄" });
    expect((within(sheet).getByRole("button", { name: "存證" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(sheet).getByLabelText("要記錄的事"), { target: { value: " 房東答應月底前修 " } });
    fireEvent.click(within(sheet).getByRole("radio", { name: "修繕" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "存證" }));
    await waitFor(() => expect(client.evidenceNote).toHaveBeenCalled());
    expect(client.evidenceNote.mock.calls[0]![0]).toMatchObject({ text: "房東答應月底前修", category: "repair" });
    expect(await screen.findByText("房東答應月底前修")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("匯出前要先看提醒，同意後用外部瀏覽器開完整網址", async () => {
    const { client, openUrl } = setup();
    fireEvent.click(await screen.findByRole("button", { name: /匯出證據清單 PDF/ }));
    const sheet = screen.getByRole("dialog", { name: "匯出前請注意" });
    expect(within(sheet).getByText("不要公開張貼")).toBeTruthy();
    expect(client.evidenceExport).not.toHaveBeenCalled();
    fireEvent.click(within(sheet).getByRole("button", { name: "我了解，匯出 PDF" }));
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith(`${window.location.origin}/api/evidence/download/tok`));
    expect(client.evidenceExport).toHaveBeenCalledWith(null);
    expect(await screen.findByText(/共 2 筆/)).toBeTruthy();
  });

  it("單筆：顯示不可改的收到時間與雜湊值；改分類後儲存；可刪除", async () => {
    const { client } = setup();
    fireEvent.click(await screen.findByText("房東說下週修熱水器"));
    expect(await screen.findByText("文字紀錄（內容不能修改）")).toBeTruthy();
    expect(screen.getByText("2026/11/14 10:30:05")).toBeTruthy();
    expect(screen.getByTestId("evidence-sha").textContent).toBe("a".repeat(64));
    expect(screen.queryByLabelText("描述")).toBeNull();
    const save = screen.getByRole("button", { name: "儲存修改" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "爭議" }));
    fireEvent.click(save);
    await waitFor(() => expect(client.evidenceUpdate).toHaveBeenCalledWith({ id: "e2", category: "dispute" }));
    expect(await screen.findByRole("button", { name: "已儲存" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "刪除這筆證據" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "刪除" }));
    await waitFor(() => expect(client.evidenceDelete).toHaveBeenCalledWith("e2"));
    expect(await screen.findByText("租約.pdf")).toBeTruthy();
    expect(screen.queryByText("房東說下週修熱水器")).toBeNull();
  });

  it("檔案超過 10MB 時提示改傳聊天室", async () => {
    setup();
    const big = new File(["x"], "v.mp4", { type: "video/mp4" });
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
    fireEvent.change(await screen.findByTestId("evidence-picker"), { target: { files: [big] } });
    expect(await screen.findByText(/檔案超過 10MB/)).toBeTruthy();
  });
});
