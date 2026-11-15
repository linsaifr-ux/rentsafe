import PDFDocument from "pdfkit";
import { fileURLToPath } from "node:url";
import { taiwanDateTime } from "../evidence/model.js";
import type { CaseSummary } from "./summary.js";

/** Noto Sans TC（SIL Open Font License，見 fonts/LICENSE-OFL.txt） */
const FONT = fileURLToPath(new URL("../../fonts/NotoSansTC-Regular.otf", import.meta.url));

const C = { ink: "#0F172A", sub: "#475569", faint: "#94A3B8", line: "#E2E8F0", box: "#F1F5F9", brand: "#059669", warn: "#B45309" };

export const CASE_PDF_NOTICE =
  "這份摘要整理你提供的事實、證據與官方條文原文，方便諮詢或調解時說明，不代表法律意見，也不評估結果。內容可能含有個人資料，請只提供給處理爭議的人，不要公開張貼。";

/** 案件摘要 PDF（SPEC 11） */
export function buildCasePdf(s: CaseSummary): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true, info: { Title: "案件摘要", Creator: "租安心" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.registerFont("tc", FONT);
  doc.font("tc");
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 10;
  const ensure = (h: number) => {
    if (doc.y + h > bottom()) doc.addPage();
  };

  doc.fillColor(C.brand).fontSize(10).text("租安心・案件摘要", left, 48);
  doc.fillColor(C.ink).fontSize(22).text(`${s.scenarioLabel}案件摘要`);
  doc.fillColor(C.sub).fontSize(9.5).text(`產生時間 ${taiwanDateTime(new Date(s.generatedAt))}（台灣時間）`);
  doc.moveDown(0.6);

  const y0 = doc.y;
  const nh = doc.fontSize(8.5).heightOfString(CASE_PDF_NOTICE, { width: width - 24 }) + 18;
  doc.roundedRect(left, y0, width, nh, 8).fill(C.box);
  doc.fillColor(C.sub).fontSize(8.5).text(CASE_PDF_NOTICE, left + 12, y0 + 9, { width: width - 24, lineGap: 1.5 });
  doc.y = y0 + nh + 6;

  const heading = (t: string) => {
    ensure(40);
    doc.moveDown(0.6);
    doc.fillColor(C.brand).fontSize(12).text(t, left, doc.y, { width });
    const y = doc.y + 2;
    doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.5).strokeColor(C.line).stroke();
    doc.y = y + 6;
  };
  const row = (k: string, v: string, size = 9.5, color = C.ink) => {
    ensure(doc.fontSize(size).heightOfString(`${k}\u3000${v}`, { width }) + 4);
    doc.fontSize(size).fillColor(C.faint).text(`${k}\u3000`, left, doc.y, { width, continued: true }).fillColor(color).text(v);
    doc.moveDown(0.15);
  };
  const para = (v: string, size = 9.5, color = C.ink) => {
    ensure(doc.fontSize(size).heightOfString(v, { width }) + 4);
    doc.fontSize(size).fillColor(color).text(v, left, doc.y, { width, lineGap: 1.5 });
    doc.moveDown(0.15);
  };

  heading("基本事實");
  row("發生日期", s.facts.occurredOn ?? "未填");
  row("縣市", s.facts.city ?? "未填");
  row("房東", s.facts.landlord);
  if (s.facts.story) row("經過", s.facts.story);

  heading("時間軸");
  if (s.timeline.length === 0) para("（尚無）", 9.5, C.sub);
  for (const t of s.timeline) row(taiwanDateTime(new Date(t.at)), t.text, 9);

  heading("已有證據");
  if (s.evidence.length === 0) para("（尚無）", 9.5, C.sub);
  s.evidence.forEach((e, i) => {
    row(`#${i + 1}`, `${taiwanDateTime(new Date(e.occurredAt))}\u3000${e.type}・${e.category}${e.text ? `\u3000${e.text}` : ""}`, 9);
    row("SHA-256", e.sha256, 7, C.sub);
  });

  heading("可能相關條文（官方原文）");
  if (s.articles.length === 0) para("（待查）", 9.5, C.sub);
  for (const a of s.articles) {
    const scope = a.scope === "national" ? "" : `（${a.scope}）`;
    para(`${a.lawName} 第 ${a.articleNo} 條${scope}`, 9.5, C.ink);
    para(a.text, 8.5, C.sub);
    para(a.sourceUrl, 7.5, C.faint);
  }

  heading("我希望的結果");
  para(s.wants.length ? s.wants.join("、") : "（未填）");

  if (s.missing.length) {
    heading("尚缺資料");
    for (const m of s.missing) para(`・${m}`, 9, C.warn);
  }

  if (s.referrals.length) {
    heading("可以洽詢");
    for (const r of s.referrals) {
      para(r.name, 9.5, C.ink);
      para([r.contact, r.hours, r.note].filter(Boolean).join("；"), 8.5, C.sub);
    }
  }

  const range = doc.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++) {
    doc.switchToPage(p);
    const y = doc.page.height - doc.page.margins.bottom + 12;
    // 頁尾畫在下邊界之外；不暫時拿掉下邊界的話，pdfkit 會當成溢出而自動新增空白頁
    doc.page.margins.bottom = 0;
    doc.fillColor(C.faint).fontSize(7.5);
    doc.text(s.disclaimer, left, y, { width: width - 60, lineBreak: false });
    doc.text(`第 ${p - range.start + 1} / ${range.count} 頁`, left + width - 60, y, { width: 60, align: "right", lineBreak: false });
  }
  doc.end();
  return done;
}
