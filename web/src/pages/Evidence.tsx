import { useEffect, useRef, useState } from "react";
import {
  Archive,
  Camera,
  Check,
  Clock,
  ExternalLink,
  FileDown,
  FileText,
  Fingerprint,
  Image as ImageIcon,
  Lock,
  MessageSquarePlus,
  Mic,
  NotebookPen,
  Paperclip,
  Save,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Video,
  type LucideIcon,
} from "lucide-react";
import { api, errorMessage, type EvidenceCategory, type EvidenceItem, type EvidenceType } from "../api.ts";
import { Disclaimer } from "../components/Disclaimer.tsx";
import {
  BottomBar,
  Button,
  Card,
  ConfirmSheet,
  CopyButton,
  EmptyState,
  ErrorText,
  IconBadge,
  Notice,
  PageHeader,
  PageSkeleton,
  Sheet,
  TONE,
  type Tone,
} from "../components/ui.tsx";
import { MAX_UPLOAD_BYTES, prepareEvidence, type PreparedEvidence } from "../evidence/prepare.ts";
import { openExternal } from "../liff.ts";
import type { PageProps } from "../router.tsx";
import { FIELD, FIELD_LABEL } from "./ViewingCheck.tsx";

type Client = Pick<
  typeof api,
  "evidenceList" | "evidenceUpload" | "evidenceNote" | "evidenceUpdate" | "evidenceDelete" | "evidenceFile" | "evidenceExport"
>;

export const CATEGORY_LABEL: Record<EvidenceCategory, string> = { repair: "修繕", rent: "租金", dispute: "爭議", safety: "安全", other: "其他" };
const CATEGORIES = Object.keys(CATEGORY_LABEL) as EvidenceCategory[];
const CATEGORY_TONE: Record<EvidenceCategory, Tone> = { repair: "sky", rent: "amber", dispute: "rose", safety: "orange", other: "slate" };

const TYPE_META: Record<EvidenceType, { label: string; icon: LucideIcon; tone: Tone }> = {
  photo: { label: "照片", icon: ImageIcon, tone: "emerald" },
  video: { label: "影片", icon: Video, tone: "violet" },
  audio: { label: "錄音", icon: Mic, tone: "rose" },
  document: { label: "檔案", icon: FileText, tone: "sky" },
  note: { label: "文字紀錄", icon: NotebookPen, tone: "amber" },
};

/* ───────────── 時間格式（台灣時間） ───────────── */

const TZ = "Asia/Taipei";
const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("zh-TW", { timeZone: TZ, ...opts }).format(new Date(iso));
const timeOf = (iso: string) => fmt(iso, { hour: "2-digit", minute: "2-digit", hour12: false });
const dayOf = (iso: string) => fmt(iso, { year: "numeric", month: "long", day: "numeric", weekday: "short" });
export const fullTime = (iso: string) =>
  fmt(iso, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** datetime-local 輸入框用（手機的時區） */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const fromLocalInput = (s: string) => new Date(s).toISOString();

const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function titleOf(it: EvidenceItem): string {
  if (it.type === "note") return it.text;
  return it.text || it.fileName || TYPE_META[it.type].label;
}

/* ───────────── 讀檔（快取 blob URL） ───────────── */

const blobCache = new Map<string, Promise<string>>();

function useBlobUrl(client: Client, id: string, thumb: boolean, enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const key = `${id}:${thumb}`;
    let p = blobCache.get(key);
    if (!p) {
      p = client.evidenceFile(id, thumb).then((b) => URL.createObjectURL(b));
      blobCache.set(key, p);
      p.catch(() => blobCache.delete(key));
    }
    p.then(
      (u) => alive && setUrl(u),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [client, id, thumb, enabled]);
  return url;
}

function Thumb({ item, client, size: px = 56 }: { item: EvidenceItem; client: Client; size?: number }) {
  const url = useBlobUrl(client, item.id, true, item.hasThumb);
  const meta = TYPE_META[item.type];
  const box = { width: px, height: px };
  if (item.hasThumb) {
    return url ? (
      <img src={url} alt="" style={box} className="shrink-0 animate-fade rounded-2xl object-cover" />
    ) : (
      <span style={box} className="skeleton shrink-0 rounded-2xl" aria-hidden="true" />
    );
  }
  return (
    <span style={box} className={`flex shrink-0 items-center justify-center rounded-2xl ${TONE[meta.tone].soft}`} aria-hidden="true">
      <meta.icon className={`size-6 ${TONE[meta.tone].icon}`} />
    </span>
  );
}

function CategoryPill({ c }: { c: EvidenceCategory }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[CATEGORY_TONE[c]].soft} ${TONE[CATEGORY_TONE[c]].text}`}>{CATEGORY_LABEL[c]}</span>;
}

/** 分類選擇（單選） */
function CategoryPicker({ value, onChange }: { value: EvidenceCategory; onChange: (c: EvidenceCategory) => void }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="分類">
      {CATEGORIES.map((c) => {
        const on = value === c;
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(c)}
            className={`inline-flex min-h-10 items-center gap-1 rounded-full px-4 text-sm transition active:scale-95 ${on ? "bg-emerald-600 font-semibold text-white shadow-brand" : "bg-slate-100 text-slate-700"}`}
          >
            {on && <Check className="size-4 animate-pop" strokeWidth={3} aria-hidden="true" />}
            {CATEGORY_LABEL[c]}
          </button>
        );
      })}
    </div>
  );
}

/* ───────────── 頁面 ───────────── */

type Compose = { kind: "file"; file: PreparedEvidence } | { kind: "note" };

/** F3 存證廊（SPEC 9）：時間軸、篩分類、加描述、改發生時間、匯出證據清單 PDF */
export function Evidence({
  client = api,
  prepare = prepareEvidence,
  openUrl = openExternal,
}: PageProps & { client?: Client; prepare?: (f: File) => Promise<PreparedEvidence>; openUrl?: (url: string) => void }) {
  const [items, setItems] = useState<EvidenceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<EvidenceCategory | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [compose, setCompose] = useState<Compose | null>(null);
  const [exporting, setExporting] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    client.evidenceList().then(
      (r) => setItems(r.items),
      (err: unknown) => setError(errorMessage(err)),
    );
  }, [client]);

  async function pick(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    setError(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("檔案超過 10MB。大檔案請直接傳到 LINE 聊天室（上限 20MB）。");
      return;
    }
    setPreparing(true);
    try {
      setCompose({ kind: "file", file: await prepare(file) });
    } catch {
      setError("讀取檔案失敗，請換一個檔案試試。");
    } finally {
      setPreparing(false);
    }
  }

  function added(item: EvidenceItem) {
    setItems((prev) => [item, ...(prev ?? [])].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)));
    setCompose(null);
    setFilter("all");
    setFresh(item.id);
  }

  if (error && !items) {
    return (
      <section>
        <PageHeader title="存證廊" />
        <Notice tone="red" className="mt-0">
          {error}
        </Notice>
      </section>
    );
  }
  if (!items) return <PageSkeleton />;

  const current = openId ? items.find((i) => i.id === openId) : null;
  if (current) {
    return (
      <EvidenceDetail
        item={current}
        client={client}
        onBack={() => setOpenId(null)}
        onChange={(next) => setItems((prev) => (prev ?? []).map((i) => (i.id === next.id ? next : i)).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)))}
        onDeleted={() => {
          setItems((prev) => (prev ?? []).filter((i) => i.id !== current.id));
          setOpenId(null);
        }}
      />
    );
  }

  const shown = filter === "all" ? items : items.filter((i) => i.category === filter);
  const groups: Array<{ day: string; items: EvidenceItem[] }> = [];
  for (const it of shown) {
    const day = dayOf(it.occurredAt);
    const g = groups.at(-1);
    if (g?.day === day) g.items.push(it);
    else groups.push({ day, items: [it] });
  }

  return (
    <section className="animate-enter">
      <PageHeader title="存證廊" />

      <Card className="relative overflow-hidden bg-gradient-to-br from-emerald-600 to-teal-700 text-white">
        <span className="absolute -top-8 -right-6 size-28 rounded-full bg-white/10" aria-hidden="true" />
        <div className="relative flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-white/20">
            <MessageSquarePlus className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold">在聊天室傳給我就會存證</p>
            <p className="mt-1 text-sm leading-relaxed text-emerald-50/90">照片、影片、錄音、檔案直接傳；文字輸入「#存證 內容」。每筆都有時間戳和雜湊值。</p>
          </div>
        </div>
      </Card>

      <div className="mt-3 grid grid-cols-3 gap-2.5">
        {(
          [
            ["拍照", Camera, "emerald", "camera"],
            ["選檔案", Paperclip, "sky", "pick"],
            ["寫紀錄", NotebookPen, "amber", "note"],
          ] as const
        ).map(([label, icon, tone, action]) => (
          <button
            key={label}
            type="button"
            onClick={() => (action === "camera" ? cameraRef.current?.click() : action === "pick" ? pickRef.current?.click() : setCompose({ kind: "note" }))}
            disabled={preparing}
            className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-3xl bg-white text-sm font-semibold text-slate-800 shadow-card transition active:scale-95 disabled:opacity-50"
          >
            <IconBadge icon={icon} tone={tone} />
            {label}
          </button>
        ))}
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" data-testid="evidence-camera" onChange={(e) => (void pick(e.target.files), (e.target.value = ""))} />
      <input ref={pickRef} type="file" className="hidden" data-testid="evidence-picker" onChange={(e) => (void pick(e.target.files), (e.target.value = ""))} />
      {preparing && <p className="mt-3 text-center text-sm text-slate-500">讀取檔案中…</p>}
      {error && <ErrorText>{error}</ErrorText>}

      {items.length === 0 ? (
        <EmptyState icon={Archive} tone="emerald" title="還沒有證據" desc="修繕、漏水、押金爭議，平常就把照片和對話存起來，出事時才有依據。" />
      ) : (
        <>
          <div className="-mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="tablist" aria-label="篩選分類">
            {(["all", ...CATEGORIES] as const).map((c) => {
              const on = filter === c;
              const count = c === "all" ? items.length : items.filter((i) => i.category === c).length;
              return (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setFilter(c)}
                  className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm transition active:scale-95 ${on ? "bg-slate-900 font-semibold text-white" : "bg-white text-slate-600 shadow-card"}`}
                >
                  {c === "all" ? "全部" : CATEGORY_LABEL[c]}
                  <span className={`text-xs tabular-nums ${on ? "text-white/70" : "text-slate-400"}`}>{count}</span>
                </button>
              );
            })}
          </div>

          {shown.length === 0 && <p className="mt-6 text-center text-sm text-slate-500">這個分類還沒有證據。</p>}
          <div className="mt-4 space-y-5" key={filter}>
            {groups.map((g) => (
              <section key={g.day} aria-label={g.day}>
                <p className="sticky top-14 z-10 -mx-4 bg-slate-50/95 px-5 py-1.5 text-xs font-semibold text-slate-500 backdrop-blur">{g.day}</p>
                <ol className="stagger relative mt-1 space-y-3 border-l-2 border-slate-200 pl-5 ml-2">
                  {g.items.map((it) => {
                    const meta = TYPE_META[it.type];
                    return (
                      <li key={it.id} className="relative">
                        <span className={`absolute top-5 -left-[27px] size-3 rounded-full ring-4 ring-slate-50 ${TONE[meta.tone].solid}`} aria-hidden="true" />
                        <button
                          type="button"
                          onClick={() => {
                            setOpenId(it.id);
                            window.scrollTo?.(0, 0);
                          }}
                          className={`flex w-full items-center gap-3 rounded-3xl bg-white p-3 text-left shadow-card ring-2 transition active:scale-[0.98] ${fresh === it.id ? "animate-pop ring-emerald-500" : "ring-transparent"}`}
                        >
                          <Thumb item={it} client={client} />
                          <span className="min-w-0 flex-1">
                            <span className="line-clamp-2 text-sm font-semibold text-slate-900">{titleOf(it)}</span>
                            <span className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                              <span className="tabular-nums">{timeOf(it.occurredAt)}</span>
                              <span>{meta.label}</span>
                              <CategoryPill c={it.category} />
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        </>
      )}

      <Disclaimer />
      {items.length > 0 && (
        <BottomBar>
          <Button onClick={() => setExporting(true)} icon={FileDown}>
            匯出{filter === "all" ? "" : `「${CATEGORY_LABEL[filter]}」`}證據清單 PDF
          </Button>
        </BottomBar>
      )}

      {compose && <ComposeSheet compose={compose} client={client} onClose={() => setCompose(null)} onSaved={added} />}
      {exporting && <ExportSheet category={filter === "all" ? null : filter} client={client} openUrl={openUrl} onClose={() => setExporting(false)} />}
    </section>
  );
}

/* ───────────── 新增 ───────────── */

function ComposeSheet({ compose, client, onClose, onSaved }: { compose: Compose; client: Client; onClose: () => void; onSaved: (it: EvidenceItem) => void }) {
  const file = compose.kind === "file" ? compose.file : null;
  const [text, setText] = useState("");
  const [category, setCategory] = useState<EvidenceCategory>("other");
  const [when, setWhen] = useState(() => {
    const now = new Date();
    const lm = file?.lastModified;
    return toLocalInput(lm && lm < now ? lm : now);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const occurredAt = fromLocalInput(when);
      const r = file
        ? await client.evidenceUpload({
            mimeType: file.mimeType,
            data: file.data,
            ...(file.thumb ? { thumb: file.thumb } : {}),
            fileName: file.name,
            ...(text.trim() ? { text: text.trim() } : {}),
            category,
            occurredAt,
          })
        : await client.evidenceNote({ text: text.trim(), category, occurredAt });
      onSaved(r.item);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const canSave = file ? true : text.trim().length > 0;

  return (
    <Sheet title={file ? "存證這個檔案" : "寫一筆文字紀錄"} onClose={onClose} busy={busy}>
      {file &&
        (file.previewUrl ? (
          <img src={file.previewUrl} alt="要存證的照片" className="mx-auto max-h-56 rounded-2xl object-contain" />
        ) : (
          <div className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
            <IconBadge icon={FileText} tone="sky" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-slate-900">{file.name}</span>
              <span className="block text-xs text-slate-500">{size(file.bytes)}</span>
            </span>
          </div>
        ))}

      <label className={`${FIELD_LABEL} mt-4`} htmlFor="ev-text">
        {file ? "描述（選填）" : "要記錄的事"}
      </label>
      <textarea
        id="ev-text"
        className={`${FIELD} min-h-24 py-3`}
        maxLength={500}
        placeholder={file ? "例如：浴室天花板漏水，已經滴了三天" : "例如：房東 LINE 說下週會來修熱水器"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {!file && <p className="mt-1.5 text-xs text-slate-400">文字紀錄存證後內容不能修改（雜湊值才對得上）。</p>}

      <p className={`${FIELD_LABEL} mt-4`}>分類</p>
      <CategoryPicker value={category} onChange={setCategory} />

      <label className={`${FIELD_LABEL} mt-4`} htmlFor="ev-when">
        發生時間
      </label>
      <input id="ev-when" type="datetime-local" className={FIELD} value={when} max={toLocalInput(new Date())} onChange={(e) => setWhen(e.target.value)} />
      <p className="mt-1.5 text-xs text-slate-400">系統另外記錄收到時間，那個不能改。</p>

      <Button className="mt-5" onClick={save} disabled={!canSave || busy || !when} icon={busy ? undefined : ShieldCheck}>
        {busy ? "存證中…" : "存證"}
      </Button>
      {error && <ErrorText>{error}</ErrorText>}
    </Sheet>
  );
}

/* ───────────── 匯出 ───────────── */

function ExportSheet({ category, client, openUrl, onClose }: { category: EvidenceCategory | null; client: Client; openUrl: (url: string) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ url: string; count: number; truncated: boolean } | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const r = await client.evidenceExport(category);
      const url = new URL(r.url, window.location.origin).toString();
      setDone({ ...r, url });
      openUrl(url);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Sheet title="證據清單已產生" onClose={onClose}>
        <div className="flex justify-center">
          <span className="animate-pop">
            <IconBadge icon={Check} tone="emerald" size="lg" />
          </span>
        </div>
        <p className="mt-3 text-center text-sm leading-relaxed text-slate-600">
          共 {done.count} 筆，已在瀏覽器開啟 PDF。
          {done.truncated && "（一次最多匯出最新的 60 筆，可以用分類分開匯出。）"}
          <br />
          連結 10 分鐘內有效。
        </p>
        <Button variant="secondary" className="mt-5" icon={ExternalLink} onClick={() => openUrl(done.url)}>
          再開一次
        </Button>
        <Button variant="ghost" className="mt-3" onClick={onClose}>
          關閉
        </Button>
      </Sheet>
    );
  }

  const points: Array<[LucideIcon, string, string]> = [
    [Lock, "清單可能有個人資料", "裡面可能有你和房東的姓名、電話、地址。只提供給處理爭議的人，例如調解委員、法扶律師。"],
    [ShieldAlert, "不要公開張貼", "把房東個資或指控貼到網路上，可能違反個資法或構成誹謗，反而對你不利。"],
    [Clock, "連結 10 分鐘內有效", "會用瀏覽器開啟 PDF，請下載或分享到需要的地方。"],
  ];

  return (
    <Sheet title="匯出前請注意" onClose={onClose} busy={busy}>
      <ul className="space-y-3">
        {points.map(([icon, title, desc]) => (
          <li key={title} className="flex gap-3 rounded-2xl bg-slate-50 p-3">
            <IconBadge icon={icon} tone="amber" size="sm" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">{title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{desc}</p>
            </div>
          </li>
        ))}
      </ul>
      <Button className="mt-5" onClick={go} disabled={busy} icon={busy ? undefined : FileDown}>
        {busy ? "產生中…" : "我了解，匯出 PDF"}
      </Button>
      <Button variant="ghost" className="mt-3" onClick={onClose} disabled={busy}>
        取消
      </Button>
      {error && <ErrorText>{error}</ErrorText>}
    </Sheet>
  );
}

/* ───────────── 單筆 ───────────── */

function Media({ item, client }: { item: EvidenceItem; client: Client }) {
  const wantFull = item.hasFile && (item.type === "photo" || item.type === "video" || item.type === "audio");
  const url = useBlobUrl(client, item.id, false, wantFull);
  if (item.type === "note") {
    return (
      <Card className="bg-amber-50/60 shadow-none ring-1 ring-amber-100">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-700">
          <Lock className="size-3.5" aria-hidden="true" />
          文字紀錄（內容不能修改）
        </p>
        <p className="mt-2 text-base leading-relaxed whitespace-pre-line text-slate-900">{item.text}</p>
      </Card>
    );
  }
  if (!wantFull) {
    return (
      <Card className="flex items-center gap-3">
        <Thumb item={item} client={client} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-900">{item.fileName ?? TYPE_META[item.type].label}</span>
          <span className="block text-xs text-slate-500">{size(item.bytes)}</span>
        </span>
        <OpenFileButton item={item} client={client} />
      </Card>
    );
  }
  if (!url) return <div className="skeleton aspect-[4/3] w-full rounded-3xl" role="status" aria-label="載入中" />;
  if (item.type === "video") return <video src={url} controls playsInline className="w-full animate-fade rounded-3xl bg-black" />;
  if (item.type === "audio") {
    return (
      <Card>
        <audio src={url} controls className="w-full" />
      </Card>
    );
  }
  return <img src={url} alt={item.text || "證據照片"} className="w-full animate-fade rounded-3xl bg-white object-contain shadow-card" />;
}

function OpenFileButton({ item, client }: { item: EvidenceItem; client: Client }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const blob = await client.evidenceFile(item.id);
          window.open(URL.createObjectURL(blob), "_blank");
        } finally {
          setBusy(false);
        }
      }}
      className="inline-flex min-h-10 items-center gap-1 rounded-full bg-sky-50 px-3.5 text-sm font-semibold text-sky-700 transition active:scale-95"
    >
      <ExternalLink className="size-4" aria-hidden="true" />
      {busy ? "開啟中…" : "開啟"}
    </button>
  );
}

function EvidenceDetail({
  item,
  client,
  onBack,
  onChange,
  onDeleted,
}: {
  item: EvidenceItem;
  client: Client;
  onBack: () => void;
  onChange: (it: EvidenceItem) => void;
  onDeleted: () => void;
}) {
  const [text, setText] = useState(item.type === "note" ? "" : item.text);
  const [category, setCategory] = useState(item.category);
  const [when, setWhen] = useState(() => toLocalInput(new Date(item.occurredAt)));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const origWhen = toLocalInput(new Date(item.occurredAt));
  const dirty = category !== item.category || when !== origWhen || (item.type !== "note" && text.trim() !== item.text);
  const meta = TYPE_META[item.type];

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await client.evidenceUpdate({
        id: item.id,
        ...(category !== item.category ? { category } : {}),
        ...(when !== origWhen ? { occurredAt: fromLocalInput(when) } : {}),
        ...(item.type !== "note" && text.trim() !== item.text ? { text: text.trim() } : {}),
      });
      onChange(r.item);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="animate-enter">
      <PageHeader title={meta.label} back={onBack} />
      <Media item={item} client={client} />

      <Card className="mt-3 divide-y divide-slate-100 py-1">
        <div className="flex items-center gap-3 py-3 text-sm">
          <Lock className="size-5 shrink-0 text-slate-400" aria-hidden="true" />
          <span className="text-slate-500">收到時間</span>
          <span className="min-w-0 flex-1 text-right font-semibold text-slate-900 tabular-nums">{fullTime(item.createdAt)}</span>
        </div>
        <div className="flex items-center gap-3 py-3 text-sm">
          <meta.icon className="size-5 shrink-0 text-slate-400" aria-hidden="true" />
          <span className="text-slate-500">來源</span>
          <span className="min-w-0 flex-1 text-right text-slate-900">{item.source === "line" ? "LINE 聊天室" : "存證廊上傳"}</span>
        </div>
      </Card>

      <Card className="mt-3">
        <label className={FIELD_LABEL} htmlFor="ev-when-edit">
          發生時間
        </label>
        <input id="ev-when-edit" type="datetime-local" className={FIELD} value={when} max={toLocalInput(new Date())} onChange={(e) => (setWhen(e.target.value), setSaved(false))} />
        <p className={`${FIELD_LABEL} mt-4`}>分類</p>
        <CategoryPicker value={category} onChange={(c) => (setCategory(c), setSaved(false))} />
        {item.type !== "note" && (
          <>
            <label className={`${FIELD_LABEL} mt-4`} htmlFor="ev-text-edit">
              描述
            </label>
            <textarea
              id="ev-text-edit"
              className={`${FIELD} min-h-24 py-3`}
              maxLength={500}
              placeholder="補充發生了什麼事"
              value={text}
              onChange={(e) => (setText(e.target.value), setSaved(false))}
            />
          </>
        )}
        <Button className="mt-4" onClick={save} disabled={!dirty || saving} icon={saved && !dirty ? Check : Save}>
          {saving ? "儲存中…" : saved && !dirty ? "已儲存" : "儲存修改"}
        </Button>
        {error && <ErrorText>{error}</ErrorText>}
      </Card>

      <Card className="mt-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Fingerprint className="size-5 text-emerald-600" aria-hidden="true" />
          SHA-256 雜湊值
        </p>
        <p className="mt-2 rounded-2xl bg-slate-50 p-3 font-mono text-xs leading-relaxed break-all text-slate-700" data-testid="evidence-sha">
          {item.sha256}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">原檔的數位指紋。之後用同一個檔案重新計算，結果一樣就代表沒有被修改過。</p>
        <CopyButton size="sm" text={item.sha256} label="複製雜湊值" />
      </Card>

      <Button variant="dangerSoft" className="mt-6" icon={Trash2} onClick={() => setConfirming(true)}>
        刪除這筆證據
      </Button>
      <Disclaimer />
      {confirming && (
        <ConfirmSheet
          title="刪除這筆證據？"
          message="原檔和紀錄會永久刪除，無法復原。如果之後可能需要，建議先匯出證據清單。"
          confirmLabel="刪除"
          busy={deleting}
          error={deleteError}
          onConfirm={async () => {
            setDeleting(true);
            setDeleteError(null);
            try {
              await client.evidenceDelete(item.id);
              onDeleted();
            } catch (err) {
              setDeleteError(errorMessage(err));
              setDeleting(false);
            }
          }}
          onCancel={() => (setConfirming(false), setDeleteError(null))}
        />
      )}
    </section>
  );
}
