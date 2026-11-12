/**
 * 建立圖文選單（SPEC 4.1）。
 *
 * 用法（在專案根目錄）：
 *   LINE_CHANNEL_ACCESS_TOKEN=xxx LIFF_ID=yyy npm run richmenu -w functions
 *
 * 會：建立選單 → 上傳 assets/richmenu.jpg → 設為所有人的預設選單 → 刪除其他舊選單。
 * 圖片原稿在 assets/richmenu.svg（2500×1686，3 欄 × 2 列）。
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { encodePostback } from "./postback.js";
import { liffUrl } from "./flex.js";

export const RICHMENU_SIZE = { width: 2500, height: 1686 } as const;
const COL_W = [833, 833, 834];
const ROW_H = [843, 843];

type Action =
  | { type: "uri"; label: string; uri: string }
  | { type: "postback"; label: string; data: string; displayText: string };

export function richMenuDefinition(liffId: string) {
  const actions: Action[] = [
    { type: "uri", label: "看房健檢", uri: liffUrl(liffId, "/viewing") },
    { type: "uri", label: "租約健檢", uri: liffUrl(liffId, "/lease") },
    { type: "uri", label: "存證廊", uri: liffUrl(liffId, "/evidence") },
    { type: "uri", label: "出事了", uri: liffUrl(liffId, "/emergency") },
    { type: "postback", label: "問法條", data: encodePostback({ action: "askLaw" }), displayText: "我想問法條" },
    { type: "uri", label: "我的設定", uri: liffUrl(liffId, "/settings") },
  ];
  const areas = actions.map((action, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    return {
      bounds: {
        x: COL_W.slice(0, col).reduce((a, b) => a + b, 0),
        y: ROW_H.slice(0, row).reduce((a, b) => a + b, 0),
        width: COL_W[col]!,
        height: ROW_H[row]!,
      },
      action,
    };
  });
  return {
    size: RICHMENU_SIZE,
    selected: true,
    name: "rentsafe-main",
    chatBarText: "租安心選單",
    areas,
  };
}

async function main(): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const liffId = process.env.LIFF_ID;
  if (!token || !liffId) {
    console.error("請設定環境變數 LINE_CHANNEL_ACCESS_TOKEN 與 LIFF_ID");
    process.exit(1);
  }
  const auth = { Authorization: `Bearer ${token}` };
  const check = async (res: Response, step: string) => {
    if (!res.ok) throw new Error(`${step} 失敗：${res.status} ${await res.text()}`);
    return res;
  };

  const before = (await (
    await check(await fetch("https://api.line.me/v2/bot/richmenu/list", { headers: auth }), "列出選單")
  ).json()) as { richmenus: Array<{ richMenuId: string }> };

  const created = (await (
    await check(
      await fetch("https://api.line.me/v2/bot/richmenu", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(richMenuDefinition(liffId)),
      }),
      "建立選單",
    )
  ).json()) as { richMenuId: string };
  const id = created.richMenuId;
  console.log("已建立", id);

  const image = await readFile(fileURLToPath(new URL("../../assets/richmenu.jpg", import.meta.url)));
  await check(
    await fetch(`https://api-data.line.me/v2/bot/richmenu/${id}/content`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "image/jpeg" },
      body: image,
    }),
    "上傳圖片",
  );
  await check(
    await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${id}`, { method: "POST", headers: auth }),
    "設為預設",
  );
  console.log("已設為預設選單");

  for (const old of before.richmenus) {
    await check(
      await fetch(`https://api.line.me/v2/bot/richmenu/${old.richMenuId}`, { method: "DELETE", headers: auth }),
      "刪除舊選單",
    );
    console.log("已刪除舊選單", old.richMenuId);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
