import { describe, expect, it } from "vitest";
import { RICHMENU_SIZE, richMenuDefinition } from "../src/line/richmenu.js";

describe("richMenuDefinition", () => {
  const def = richMenuDefinition("LIFF1");

  it("6 格，依序為 看房健檢｜租約健檢｜存證廊｜出事了｜問法條｜我的設定", () => {
    expect(def.areas.map((a) => a.action.label)).toEqual(["看房健檢", "租約健檢", "存證廊", "出事了", "問法條", "我的設定"]);
  });

  it("五格開 LIFF，「問法條」送 postback", () => {
    const uris = def.areas.filter((a) => a.action.type === "uri").map((a) => (a.action as { uri: string }).uri);
    expect(uris).toEqual([
      "https://liff.line.me/LIFF1/viewing",
      "https://liff.line.me/LIFF1/lease",
      "https://liff.line.me/LIFF1/evidence",
      "https://liff.line.me/LIFF1/emergency",
      "https://liff.line.me/LIFF1/settings",
    ]);
    expect(def.areas[4]?.action).toMatchObject({ type: "postback", data: "action=askLaw" });
  });

  it("各格剛好鋪滿 2500×1686、不重疊", () => {
    let area = 0;
    for (const { bounds: b } of def.areas) {
      expect(b.x + b.width).toBeLessThanOrEqual(RICHMENU_SIZE.width);
      expect(b.y + b.height).toBeLessThanOrEqual(RICHMENU_SIZE.height);
      area += b.width * b.height;
    }
    expect(area).toBe(RICHMENU_SIZE.width * RICHMENU_SIZE.height);
  });

  it("label 不超過 LINE 上限 20 字", () => {
    for (const a of def.areas) expect(a.action.label.length).toBeLessThanOrEqual(20);
    expect(def.chatBarText.length).toBeLessThanOrEqual(14);
  });
});
