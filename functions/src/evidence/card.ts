import { liffUrl, textMessage } from "../line/flex.js";
import { encodePostback } from "../line/postback.js";
import type { LineMessage } from "../line/types.js";
import { CATEGORIES, CATEGORY_IDS, TYPE_LABEL, taiwanDateTime, type Category, type StoredEvidence } from "./model.js";

function row(label: string, value: string, opts: { mono?: boolean } = {}) {
  return {
    type: "box",
    layout: "baseline",
    spacing: "md",
    contents: [
      { type: "text", text: label, size: "xs", color: "#64748B", flex: 2 },
      { type: "text", text: value, size: opts.mono ? "xxs" : "sm", color: "#0F172A", flex: 5, wrap: true },
    ],
  };
}

/** 改分類的 Quick Reply */
export function categoryQuickReply(id: string) {
  return {
    items: CATEGORY_IDS.map((c) => ({
      type: "action",
      action: { type: "postback", label: CATEGORIES[c], data: encodePostback({ action: "evCat", id, cat: c }), displayText: `分類改成「${CATEGORIES[c]}」` },
    })),
  };
}

/** 已存證卡片（SPEC 4.1、9）：類型、分類、系統收到時間、雜湊值，附改分類 Quick Reply */
export function evidenceCard(ev: StoredEvidence, liffId: string): LineMessage {
  const received = taiwanDateTime(ev.createdAt);
  const what = ev.type === "document" && ev.fileName ? `${TYPE_LABEL[ev.type]}：${ev.fileName}` : TYPE_LABEL[ev.type];
  const body: unknown[] = [
    row("類型", what),
    row("分類", CATEGORIES[ev.category]),
    row("收到時間", received),
  ];
  if (ev.type === "note") body.push(row("內容", ev.text.length > 80 ? `${ev.text.slice(0, 80)}…` : ev.text));
  body.push({ type: "separator", margin: "md" }, row("SHA-256", ev.sha256, { mono: true }));
  body.push({ type: "text", text: "這組雜湊值可以證明檔案之後沒有被修改。下方按鈕可以改分類。", size: "xxs", color: "#94A3B8", wrap: true, margin: "md" });
  return {
    type: "flex",
    altText: `已存證：${TYPE_LABEL[ev.type]}（${received}）`,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#059669",
        paddingAll: "16px",
        contents: [
          { type: "text", text: "已存證", color: "#FFFFFF", weight: "bold", size: "lg" },
          { type: "text", text: "時間戳已記錄，原檔不會被修改", color: "#D1FAE5", size: "xs" },
        ],
      },
      body: { type: "box", layout: "vertical", spacing: "sm", contents: body },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "button", style: "primary", color: "#059669", height: "sm", action: { type: "uri", label: "打開存證廊", uri: liffUrl(liffId, "/evidence") } },
        ],
      },
    },
    quickReply: categoryQuickReply(ev.id),
  };
}

export function categoryChangedMessage(category: Category): LineMessage {
  return textMessage(`已把分類改成「${CATEGORIES[category]}」。到存證廊可以補充描述、修改發生時間。`);
}

export const EVIDENCE_NOT_FOUND = textMessage("找不到這筆證據，可能已經刪除了。");
