import { CITY_OPTIONS } from "../cities.js";
import { DISCLAIMER } from "../config.js";
import { encodePostback } from "./postback.js";
import type { LineMessage } from "./types.js";

export function liffUrl(liffId: string, path = ""): string {
  return `https://liff.line.me/${liffId}${path}`;
}

/** 選縣市的 Quick Reply（SPEC 4.1） */
export function cityQuickReply() {
  return {
    items: CITY_OPTIONS.map((c) => ({
      type: "action",
      action: {
        type: "postback",
        label: c.label,
        data: encodePostback({ action: "setCity", city: c.value ?? "" }),
        displayText: c.value ?? "其他縣市",
      },
    })),
  };
}

function stageRow(step: string, color: string, title: string, desc: string) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "md",
    contents: [
      {
        type: "box",
        layout: "vertical",
        width: "28px",
        height: "28px",
        cornerRadius: "14px",
        backgroundColor: color,
        justifyContent: "center",
        flex: 0,
        contents: [{ type: "text", text: step, color: "#FFFFFF", size: "xs", weight: "bold", align: "center" }],
      },
      {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: title, weight: "bold", size: "sm", color: "#0F172A" },
          { type: "text", text: desc, size: "xs", color: "#64748B", wrap: true },
        ],
      },
    ],
  };
}

/** 加好友歡迎卡：三個階段、免責聲明、隱私權政策連結，附縣市 Quick Reply */
export function welcomeMessage(liffId: string, displayName?: string): LineMessage {
  const hello = displayName ? `${displayName}，歡迎使用租安心！` : "歡迎使用租安心！";
  return {
    type: "flex",
    altText: "歡迎使用租安心：請先選擇你租屋的縣市",
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#047857",
        contents: [
          { type: "text", text: hello, color: "#FFFFFF", weight: "bold", size: "md", wrap: true },
          { type: "text", text: "你的租屋法律小幫手", color: "#D1FAE5", size: "xs" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "lg",
        contents: [
          stageRow("1", "#059669", "簽約前", "看房健檢、拍照做租約健檢，先找出地雷"),
          stageRow("2", "#0284C7", "住進去", "照片、對話傳給我就自動存證，附時間戳"),
          stageRow("3", "#E11D48", "出事時", "情境急救包一步步帶你處理，需要時幫你轉介"),
          { type: "separator" },
          { type: "text", text: "直接打字就能問租屋法律問題，回答都會附上條文出處。", size: "xs", wrap: true, color: "#374151" },
          { type: "text", text: DISCLAIMER, size: "xxs", wrap: true, color: "#9CA3AF" },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "link",
            height: "sm",
            action: { type: "uri", label: "隱私權政策", uri: liffUrl(liffId, "/privacy") },
          },
        ],
      },
    },
    quickReply: cityQuickReply(),
  };
}

export function textMessage(text: string, withCityQuickReply = false): LineMessage {
  return withCityQuickReply ? { type: "text", text, quickReply: cityQuickReply() } : { type: "text", text };
}

export function citySetMessage(city: string | null): LineMessage {
  if (city) {
    return textMessage(`已設定租屋縣市：${city}。之後回答會一併說明${city}的規定（有查到的話）。想改可以到「我的設定」。`);
  }
  return textMessage("好的！目前會先用全國規定回答，地方規定建議洽當地消防局或市府確認。想設定縣市可以到「我的設定」。");
}

export const ASK_LAW_GUIDE = textMessage(
  "直接打字問我就可以喔！例如：\n・房東不修漏水怎麼辦？\n・押金可以收幾個月？\n・提前搬走要賠多少違約金？\n\n回答會附上法條出處。",
);
