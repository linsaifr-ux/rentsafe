import { z } from "zod";
import { EVIDENCE, RATE_LIMITS } from "../config.js";
import { CATEGORY_IDS, type Category, type EvidenceType, type StoredEvidence } from "../evidence/model.js";
import { buildEvidencePdf } from "../evidence/pdf.js";
import { cleanText, deleteEvidence, storeEvidence } from "../evidence/save.js";
import { DAY } from "../rateLimit.js";
import { base64Bytes } from "./lease.js";
import { HttpError, json, parseBody, type ApiDeps, type ApiResponse, type Routes } from "./http.js";

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const categorySchema = z.enum(CATEGORY_IDS as [Category, ...Category[]]);
const b64 = z.string().regex(/^[A-Za-z0-9+/]+=*$/);
const isoDate = z.iso.datetime({ offset: true });

/** 發生時間不能晚於現在（留 5 分鐘誤差），也不能早於 1990 年 */
function occurred(iso: string | undefined, now: Date): Date | undefined {
  if (iso === undefined) return undefined;
  const d = new Date(iso);
  if (d.getTime() > now.getTime() + 5 * 60_000 || d.getFullYear() < 1990) throw new HttpError(400, "invalid_occurred_at");
  return d;
}

function evidenceDeps(deps: ApiDeps) {
  if (!deps.evidence) throw new HttpError(503, "evidence_unavailable");
  return deps.evidence;
}

/** 前端用的格式（不回傳 Storage 路徑） */
export function evidenceView(ev: StoredEvidence) {
  return {
    id: ev.id,
    type: ev.type,
    category: ev.category,
    text: ev.text,
    fileName: ev.fileName,
    mimeType: ev.mimeType,
    bytes: ev.bytes,
    hasFile: Boolean(ev.storagePath),
    hasThumb: Boolean(ev.thumbPath),
    sha256: ev.sha256,
    source: ev.source,
    occurredAt: ev.occurredAt.toISOString(),
    createdAt: ev.createdAt.toISOString(),
  };
}

function typeOf(mimeType: string): EvidenceType {
  if (mimeType.startsWith("image/")) return "photo";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
}

const uploadSchema = z.object({
  mimeType: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/).max(100),
  data: b64,
  thumb: b64.optional(),
  fileName: z.string().trim().max(120).optional(),
  text: z.string().max(EVIDENCE.textMaxLength).optional(),
  category: categorySchema.optional(),
  occurredAt: isoDate.optional(),
});

const noteSchema = z.object({
  text: z.string().trim().min(1).max(EVIDENCE.textMaxLength),
  category: categorySchema.optional(),
  occurredAt: isoDate.optional(),
});

const updateSchema = z.object({
  id: idSchema,
  text: z.string().max(EVIDENCE.textMaxLength).optional(),
  category: categorySchema.optional(),
  occurredAt: isoDate.optional(),
});

async function limitSave(uid: string, deps: ApiDeps) {
  if (!(await deps.limiter.hit(`evidence/${uid}`, RATE_LIMITS.evidencePerUserPerDay, DAY))) throw new HttpError(429, "daily_limit");
}

/** F3 存證廊 API（SPEC 9）：不提供修改原檔，只能改描述、分類、發生時間，或整筆刪除 */
export const evidenceRoutes: Routes = {
  "POST /evidence/list": async ({ user, body, deps }) => {
    const ev = evidenceDeps(deps);
    const { category } = parseBody(z.object({ category: categorySchema.nullable().optional() }), body ?? {});
    const items = await ev.repo.list(user.uid, { category: category ?? undefined, limit: EVIDENCE.listLimit });
    return json(200, { items: items.map(evidenceView) });
  },

  "POST /evidence/upload": async ({ user, body, deps }) => {
    const ev = evidenceDeps(deps);
    const input = parseBody(uploadSchema, body);
    if (base64Bytes(input.data) > EVIDENCE.maxUploadBytes) throw new HttpError(413, "file_too_large");
    if (input.thumb && base64Bytes(input.thumb) > EVIDENCE.maxThumbBytes) throw new HttpError(413, "thumb_too_large");
    const now = ev.now?.() ?? new Date();
    const occurredAt = occurred(input.occurredAt, now);
    await limitSave(user.uid, deps);
    const type = typeOf(input.mimeType);
    const item = await storeEvidence(
      user.uid,
      {
        type,
        category: input.category ?? "other",
        text: input.text ?? "",
        fileName: input.fileName || null,
        mimeType: input.mimeType,
        data: Buffer.from(input.data, "base64"),
        thumb: input.thumb && (type === "photo" || type === "video") ? Buffer.from(input.thumb, "base64") : null,
        source: "liff",
        occurredAt,
      },
      ev,
    );
    return json(200, { item: evidenceView(item) });
  },

  "POST /evidence/note": async ({ user, body, deps }) => {
    const ev = evidenceDeps(deps);
    const input = parseBody(noteSchema, body);
    const occurredAt = occurred(input.occurredAt, ev.now?.() ?? new Date());
    await limitSave(user.uid, deps);
    const item = await storeEvidence(
      user.uid,
      { type: "note", category: input.category ?? "other", text: input.text, fileName: null, mimeType: null, data: null, thumb: null, source: "liff", occurredAt },
      ev,
    );
    return json(200, { item: evidenceView(item) });
  },

  "POST /evidence/update": async ({ user, body, deps }) => {
    const ev = evidenceDeps(deps);
    const input = parseBody(updateSchema, body);
    const cur = await ev.repo.get(user.uid, input.id);
    if (!cur) throw new HttpError(404, "not_found");
    // 文字紀錄的內容就是證據本身（有雜湊），不能改
    if (cur.type === "note" && input.text !== undefined && cleanText(input.text) !== cur.text) throw new HttpError(400, "note_immutable");
    const updated = await ev.repo.update(user.uid, input.id, {
      ...(input.text !== undefined && cur.type !== "note" ? { text: cleanText(input.text) } : {}),
      ...(input.category ? { category: input.category } : {}),
      ...(input.occurredAt ? { occurredAt: occurred(input.occurredAt, ev.now?.() ?? new Date()) } : {}),
    });
    if (!updated) throw new HttpError(404, "not_found");
    return json(200, { item: evidenceView(updated) });
  },

  "POST /evidence/delete": async ({ user, body, deps }) => {
    const ev = evidenceDeps(deps);
    const { id } = parseBody(z.object({ id: idSchema }), body);
    if (!(await deleteEvidence(user.uid, id, ev))) throw new HttpError(404, "not_found");
    return json(200, { ok: true });
  },

  "POST /evidence/file": async ({ user, body, deps }) => {
    const ev = evidenceDeps(deps);
    const { id, thumb } = parseBody(z.object({ id: idSchema, thumb: z.boolean().optional() }), body);
    const item = await ev.repo.get(user.uid, id);
    const path = thumb ? item?.thumbPath : item?.storagePath;
    if (!item || !path) throw new HttpError(404, "not_found");
    const file = await ev.store.get(path);
    if (!file) throw new HttpError(404, "not_found");
    return { status: 200, body: null, raw: { contentType: thumb ? "image/jpeg" : (item.mimeType ?? file.contentType), data: file.data } };
  },

  /** 建立 10 分鐘有效的下載連結；PDF 在下載時才產生 */
  "POST /evidence/export": async ({ user, body, deps }) => {
    const ev = evidenceDeps(deps);
    const { category } = parseBody(z.object({ category: categorySchema.nullable().optional() }), body ?? {});
    if (!(await deps.limiter.hit(`evidenceExport/${user.uid}`, RATE_LIMITS.evidenceExportPerUserPerDay, DAY))) throw new HttpError(429, "daily_limit");
    const items = await ev.repo.list(user.uid, { category: category ?? undefined, limit: EVIDENCE.exportMax });
    if (items.length === 0) throw new HttpError(400, "nothing_to_export");
    const now = ev.now?.() ?? new Date();
    const token = await ev.tokens.create({ uid: user.uid, ids: items.map((i) => i.id), expiresAt: new Date(now.getTime() + EVIDENCE.downloadTtlMs) });
    return json(200, { url: `/api/evidence/download/${token}`, count: items.length, truncated: items.length >= EVIDENCE.exportMax });
  },
};

const TOKEN_RE = /^\/evidence\/download\/([A-Za-z0-9_-]{20,64})$/;

/** 下載 PDF：用連結裡的隨機 token 驗證（外部瀏覽器沒有 LIFF 登入）；不是這個路徑回傳 null */
export async function handleEvidenceDownload(method: string, path: string, deps: ApiDeps): Promise<ApiResponse | null> {
  const m = TOKEN_RE.exec(path);
  if (method !== "GET" || !m) return null;
  if (!deps.evidence) return json(503, { error: "evidence_unavailable" });
  const ev = deps.evidence;
  const now = ev.now?.() ?? new Date();
  const rec = await ev.tokens.get(m[1]!);
  if (!rec || rec.expiresAt.getTime() < now.getTime()) return json(410, { error: "link_expired" });
  const items = (await Promise.all(rec.ids.map((id) => ev.repo.get(rec.uid, id)))).filter((x): x is StoredEvidence => Boolean(x));
  const thumbs = new Map<string, Buffer>();
  await Promise.all(
    items.map(async (it) => {
      const path = it.thumbPath ?? (it.type === "photo" && it.mimeType && /jpe?g|png/.test(it.mimeType) && it.bytes <= 3 * 1024 * 1024 ? it.storagePath : null);
      if (!path) return;
      const f = await ev.store.get(path).catch(() => null);
      if (f) thumbs.set(it.id, f.data);
    }),
  );
  items.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const pdf = await buildEvidencePdf(items, thumbs, { generatedAt: now });
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  return { status: 200, body: null, raw: { contentType: "application/pdf", data: pdf, filename: `evidence-${stamp}.pdf` } };
}
