import PDFDocument from "pdfkit";
import { fileURLToPath } from "node:url";
import { DISCLAIMER } from "../config.js";
import { CATEGORIES, TYPE_LABEL, taiwanDateTime, type Category, type StoredEvidence } from "./model.js";

/** Noto Sans TC（SIL Open Font License，見 fonts/LICENSE-OFL.txt）；PDF 只嵌入用到的字 */
const FONT = fileURLToPath(new URL("../../fonts/NotoSansTC-Regular.otf", import.meta.url));

export const PDF_NOTICE = {
  howToRead:
    "「收到時間」是系統收到檔案的時間，不能修改；「發生時間」由使用者填寫。SHA-256 是原檔的數位指紋：把同一個原檔重新計算，結果相同就代表檔案沒有被修改過。",
  privacy:
    "本清單可能含有你和他人的個人資料。請只提供給處理爭議的人（例如調解委員、法扶律師），不要公開張貼；公開他人個資或不實指控，可能違反個人資料保護法或構成誹謗。",
};

const C = { ink: "#0F172A", sub: "#475569", faint: "#94A3B8", line: "#E2E8F0", box: "#F1F5F9", brand: "#059669" };
const THUMB = 96;

/** 產生「證據清單」PDF（SPEC 9）：時間、類型、描述、雜湊值、縮圖 */
export function buildEvidencePdf(
  items: StoredEvidence[],
  thumbs: Map<string, Buffer>,
  opts: { generatedAt: Date; category?: Category | null },
): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true, info: { Title: "證據清單", Creator: "租安心" } });
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
  const bottom = () => doc.page.height - doc.page.margins.bottom - 20;

  // 標題
  doc.fillColor(C.brand).fontSize(10).text("租安心・存證廊", left, 48);
  doc.fillColor(C.ink).fontSize(22).text("證據清單");
  const scope = opts.category ? `・分類：${CATEGORIES[opts.category]}` : "";
  doc.fillColor(C.sub).fontSize(9.5).text(`產生時間 ${taiwanDateTime(opts.generatedAt)}（台灣時間）・共 ${items.length} 筆${scope}`);
  doc.moveDown(0.8);

  // 說明與提醒
  const note = (title: string, body: string) => {
    const y = doc.y;
    const h = doc.fontSize(8.5).heightOfString(body, { width: width - 24 }) + 30;
    doc.roundedRect(left, y, width, h, 8).fill(C.box);
    doc.fillColor(C.ink).fontSize(9.5).text(title, left + 12, y + 9, { width: width - 24 });
    doc.fillColor(C.sub).fontSize(8.5).text(body, { width: width - 24, lineGap: 1.5 });
    doc.y = y + h + 8;
  };
  note("怎麼看這份清單", PDF_NOTICE.howToRead);
  note("使用前請注意", PDF_NOTICE.privacy);
  doc.moveDown(0.6);

  items.forEach((ev, i) => {
    const textX = left + THUMB + 14;
    const textW = width - THUMB - 14;
    const lines: Array<[string, string, number]> = [
      ["發生時間", taiwanDateTime(ev.occurredAt), 9],
      ["收到時間", taiwanDateTime(ev.createdAt), 9],
    ];
    if (ev.fileName) lines.push(["檔名", ev.fileName, 9]);
    if (ev.text) lines.push(["描述", ev.text, 9]);
    lines.push(["SHA-256", ev.sha256, 7.5]);
    const heading = `#${i + 1}\u3000${TYPE_LABEL[ev.type]}・${CATEGORIES[ev.category]}`;
    const textH =
      doc.fontSize(11).heightOfString(heading, { width: textW }) +
      lines.reduce((n, [k, v, size]) => n + doc.fontSize(size).heightOfString(`${k}\u3000${v}`, { width: textW }) + 2, 6);
    const h = Math.max(THUMB, textH) + 16;
    if (doc.y + h > bottom()) doc.addPage();
    const y = doc.y;

    // 縮圖（沒有就畫類型方塊）
    const thumb = thumbs.get(ev.id);
    let drew = false;
    if (thumb) {
      try {
        doc.save().roundedRect(left, y, THUMB, THUMB, 8).clip();
        doc.image(thumb, left, y, { cover: [THUMB, THUMB], align: "center", valign: "center" });
        doc.restore();
        drew = true;
      } catch {
        doc.restore();
      }
    }
    if (!drew) {
      doc.roundedRect(left, y, THUMB, THUMB, 8).fill(C.box);
      doc.fillColor(C.faint).fontSize(11).text(TYPE_LABEL[ev.type], left, y + THUMB / 2 - 8, { width: THUMB, align: "center" });
    }

    doc.fillColor(C.ink).fontSize(11).text(heading, textX, y, { width: textW });
    doc.moveDown(0.2);
    for (const [k, v, size] of lines) {
      doc.fontSize(size).fillColor(C.faint).text(`${k}\u3000`, textX, doc.y, { width: textW, continued: true }).fillColor(k === "SHA-256" ? C.sub : C.ink).text(v);
      doc.moveDown(0.1);
    }
    const end = Math.max(y + THUMB, doc.y) + 8;
    doc.moveTo(left, end).lineTo(left + width, end).lineWidth(0.5).strokeColor(C.line).stroke();
    doc.y = end + 8;
  });

  if (items.length === 0) doc.fillColor(C.sub).fontSize(10).text("沒有符合條件的證據。", left);

  // 頁尾：頁碼與免責聲明
  const range = doc.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++) {
    doc.switchToPage(p);
    const y = doc.page.height - doc.page.margins.bottom + 12;
    // 頁尾畫在下邊界之外；不暫時拿掉下邊界的話，pdfkit 會當成溢出而自動新增空白頁
    doc.page.margins.bottom = 0;
    doc.fillColor(C.faint).fontSize(7.5);
    doc.text(DISCLAIMER, left, y, { width: width - 60, lineBreak: false });
    doc.text(`第 ${p - range.start + 1} / ${range.count} 頁`, left + width - 60, y, { width: 60, align: "right", lineBreak: false });
  }
  doc.end();
  return done;
}
