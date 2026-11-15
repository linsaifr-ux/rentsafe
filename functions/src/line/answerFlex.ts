import { EMERGENCY_FOOTER, EMERGENCY_TEXT } from "../ai/safety.js";
import type { QaResult } from "../ai/orchestrator.js";
import type { Referral } from "../ai/referral.js";
import { DISCLAIMER } from "../config.js";
import { cityQuickReply, liffUrl, textMessage } from "./flex.js";
import type { LineMessage } from "./types.js";

const MUTED = "#6B7280";

const heading = (text: string) => ({ type: "text", text, weight: "bold", size: "sm", color: "#047857", margin: "lg" });
const para = (text: string, extra: Record<string, unknown> = {}) => ({ type: "text", text, size: "sm", wrap: true, color: "#111827", ...extra });
const bullets = (items: string[]) => items.map((t) => para(`・${t}`, { margin: "sm" }));

/** LINE Flex 文字長度保護 */
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function citationBox(c: Extract<QaResult, { kind: "answer" }>["citations"][number]) {
  const scopeLabel = c.scope === "national" ? "" : `（${c.scope}規定）`;
  return {
    type: "box",
    layout: "vertical",
    margin: "md",
    paddingAll: "md",
    backgroundColor: "#F3F4F6",
    cornerRadius: "md",
    contents: [
      { type: "text", text: `${c.lawName} 第 ${c.articleNo} 條${scopeLabel}`, size: "xs", weight: "bold", color: "#374151" },
      { type: "text", text: `「${clip(c.quote, 200)}」`, size: "xs", wrap: true, color: "#374151", margin: "sm" },
      ...(c.plain ? [{ type: "text", text: `白話：${clip(c.plain, 200)}`, size: "xs", wrap: true, color: MUTED, margin: "sm" }] : []),
      {
        type: "text",
        text: "看條文原文 ›",
        size: "xs",
        color: "#2563EB",
        margin: "sm",
        action: { type: "uri", label: "看條文原文", uri: c.sourceUrl },
      },
    ],
  };
}

/** LINE 規定 carousel 裡每個 bubble 的 size 必須相同，否則整則訊息會被拒收 */
const BUBBLE_SIZE = "giga";

function referralBubble(referrals: Referral[]) {
  return {
    type: "bubble",
    size: BUBBLE_SIZE,
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#1D4ED8",
      contents: [{ type: "text", text: "建議洽詢", color: "#FFFFFF", weight: "bold" }],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: referrals.flatMap((r, i) => [
        ...(i > 0 ? [{ type: "separator" }] : []),
        { type: "text", text: r.name, weight: "bold", size: "sm", wrap: true },
        { type: "text", text: r.contact, size: "xs", wrap: true, color: "#374151" },
        ...(r.hours ? [{ type: "text", text: r.hours, size: "xs", wrap: true, color: MUTED }] : []),
        { type: "text", text: r.note, size: "xs", wrap: true, color: MUTED },
      ]),
    },
  };
}

export function answerMessages(result: QaResult, liffId: string): LineMessage[] {
  switch (result.kind) {
    case "emergency":
      return [
        {
          type: "flex",
          altText: "緊急狀況：請先確保安全",
          contents: {
            type: "bubble",
            header: {
              type: "box",
              layout: "vertical",
              backgroundColor: "#B91C1C",
              contents: [{ type: "text", text: "先確保安全！", color: "#FFFFFF", weight: "bold", size: "lg" }],
            },
            body: {
              type: "box",
              layout: "vertical",
              spacing: "md",
              contents: [para(EMERGENCY_TEXT[result.emergencyKind]), para(EMERGENCY_FOOTER, { size: "xs", color: MUTED })],
            },
            footer: {
              type: "box",
              layout: "vertical",
              spacing: "sm",
              contents: [
                { type: "button", style: "primary", color: "#B91C1C", action: { type: "uri", label: "撥打 119", uri: "tel:119" } },
                { type: "button", style: "secondary", action: { type: "uri", label: "撥打 110", uri: "tel:110" } },
                { type: "button", style: "link", action: { type: "uri", label: "出事了：急救包", uri: liffUrl(liffId, "/emergency") } },
              ],
            },
          },
        },
      ];
    case "rate_limited":
      return [
        textMessage(
          result.scope === "user"
            ? "你今天已經問了很多題囉！為了控制成本，每人每天最多 50 題，明天再來問吧。急需協助可以打法扶專線 412-8518（手機加 02）。"
            : "今天的問答量已經滿了，請明天再試。急需協助可以打法扶專線 412-8518（手機加 02）。",
        ),
      ];
    case "clarify":
      return [textMessage(result.question, result.askCity)];
    case "answer": {
      const body: unknown[] = [heading("結論"), para(result.summary, { margin: "sm" })];
      if (result.note) body.push(para(`注意：${result.note}`, { size: "xs", color: "#B45309", margin: "md" }));
      if (result.citations.length) body.push(heading("依據條文"), ...result.citations.slice(0, 4).map(citationBox));
      if (result.actions.length) body.push(heading("你可以做的事"), ...bullets(result.actions));
      if (result.evidence.length) body.push(heading("建議保留的證據"), ...bullets(result.evidence));
      body.push({ type: "separator", margin: "lg" }, para(DISCLAIMER, { size: "xxs", color: "#9CA3AF", margin: "md" }));

      const answerBubble = {
        type: "bubble",
        size: BUBBLE_SIZE,
        body: { type: "box", layout: "vertical", contents: body },
      };
      const contents = result.referrals.length
        ? { type: "carousel", contents: [answerBubble, referralBubble(result.referrals)] }
        : answerBubble;
      return [{ type: "flex", altText: clip(`租安心回答：${result.summary}`, 380), contents }];
    }
  }
}

export { cityQuickReply };
