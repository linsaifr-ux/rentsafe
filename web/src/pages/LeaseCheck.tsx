import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, errorMessage, type LeaseFinding, type LeaseResult, type ViewingSummary } from "../api.ts";
import { Disclaimer } from "../components/Disclaimer.tsx";
import {
  ArrowLeft,
  Camera,
  CircleCheck,
  FileQuestion,
  FileText,
  Banknote,
  CalendarRange,
  Check,
  History,
  House,
  Images,
  LoaderCircle,
  MessagesSquare,
  OctagonAlert,
  Quote,
  RotateCcw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  BottomBar,
  Button,
  Card,
  ConfirmSheet,
  CopyButton,
  Disclosure,
  ErrorText,
  EmptyState,
  IconBadge,
  LinkButton,
  NavCard,
  Notice,
  PageHeader,
  SourceChip,
  useCountUp,
  type Tone,
} from "../components/ui.tsx";
import { FIELD, FIELD_LABEL } from "./ViewingCheck.tsx";
import { MAX_FILES, MAX_TOTAL_BYTES, prepareFile, type PreparedFile } from "../lease/prepare.ts";
import type { PageProps } from "../router.tsx";

type Client = Pick<typeof api, "leaseCheck" | "viewingHistory">;

/** 網址 ?viewing=ID 時預先選好是哪一間（從看房紀錄點「幫這間做租約健檢」） */
function viewingFromUrl(): string {
  return new URLSearchParams(window.location.search).get("viewing") ?? "";
}

/** 分析中顯示的步驟（依時間輪播，實際進度在後端） */
export const PROGRESS_STEPS = ["讀取租約內容…", "遮蔽個人資料…", "比對內政部契約規定…", "整理結果…"];

const LEVEL = {
  red: { label: "紅燈", bar: "bg-red-500", pill: "bg-red-50 text-red-700", icon: OctagonAlert },
  yellow: { label: "黃燈", bar: "bg-amber-400", pill: "bg-amber-50 text-amber-700", icon: TriangleAlert },
} as const;

/** F2 租約健檢（SPEC 8）：拍照或選檔 → 分析 → 紅黃綠燈 */
export function LeaseCheck({
  client = api,
  prepare = prepareFile,
  initialViewingId = viewingFromUrl(),
}: PageProps & { client?: Client; prepare?: (f: File) => Promise<PreparedFile>; initialViewingId?: string }) {
  const [files, setFiles] = useState<PreparedFile[]>([]);
  const [homes, setHomes] = useState<ViewingSummary[]>([]);
  const [viewingId, setViewingId] = useState(initialViewingId);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<"preparing" | "analyzing" | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LeaseResult | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);

  // 讀看房紀錄，讓使用者選「這是哪一間的租約」；失敗就只當成「只有租約」
  useEffect(() => {
    client.viewingHistory().then(
      (h) => setHomes(h.viewings),
      () => setHomes([]),
    );
  }, [client]);

  useEffect(() => {
    if (busy !== "analyzing") return;
    const t = setInterval(() => setStep((s) => Math.min(s + 1, PROGRESS_STEPS.length - 1)), 8000);
    return () => clearInterval(t);
  }, [busy]);

  const hasPdf = files.some((f) => f.mimeType === "application/pdf");
  const total = files.reduce((n, f) => n + f.bytes, 0);

  async function add(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    const incoming = [...list];
    const pdfs = incoming.filter((f) => f.type === "application/pdf");
    if (pdfs.length && (files.length || incoming.length > 1)) {
      setError("PDF 請單獨上傳一個檔案。");
      return;
    }
    if (hasPdf) {
      setError("已經選了 PDF，要改用照片請先移除。");
      return;
    }
    if (files.length + incoming.length > MAX_FILES) {
      setError(`最多 ${MAX_FILES} 張。`);
      return;
    }
    setBusy("preparing");
    try {
      const prepared = await Promise.all(incoming.map((f) => prepare(f)));
      const next = [...files, ...prepared];
      if (next.reduce((n, f) => n + f.bytes, 0) > MAX_TOTAL_BYTES) {
        setError("檔案太大了，請少選幾張。");
        return;
      }
      setFiles(next);
    } catch {
      setError("讀取檔案失敗，請換一張試試。");
    } finally {
      setBusy(null);
    }
  }

  function remove(i: number) {
    setFiles((prev) => {
      const f = prev[i];
      if (f?.previewUrl) URL.revokeObjectURL(f.previewUrl);
      return prev.filter((_, j) => j !== i);
    });
  }

  async function analyze() {
    setStep(0);
    setBusy("analyzing");
    setError(null);
    try {
      const known = homes.some((h) => h.id === viewingId);
      const r = await client.leaseCheck(
        files.map((f) => ({ mimeType: f.mimeType, data: f.data })),
        known ? { viewingId } : label.trim() ? { label: label.trim() } : {},
      );
      setResult(r);
      // 送出後就清掉手機記憶體裡的照片
      files.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
      setFiles([]);
      window.scrollTo?.(0, 0);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (result) return <LeaseResultView result={result} onRestart={() => setResult(null)} />;

  if (busy === "analyzing") return <Analyzing step={step} />;

  const known = homes.some((h) => h.id === viewingId);
  const full = busy !== null || hasPdf || files.length >= MAX_FILES;

  return (
    <section className="animate-enter">
      <PageHeader title="租約健檢" />
      <p className="px-1 text-sm leading-relaxed text-slate-600">拍下租約，幫你對照內政部的契約規定，找出押金、電費、稅金等常見問題。</p>

      <div className="mt-4">
        <NavCard href="/viewings" icon={History} tone="violet" title="我的看房紀錄" desc="做過的租約健檢也在這，可以跟看房結果一起比較" />
      </div>

      <Card className="mt-3">
        <div className="flex items-center gap-3">
          <IconBadge icon={House} tone="emerald" size="sm" />
          <label className={FIELD_LABEL} htmlFor="lease-home">
            這是哪一間的租約？
          </label>
        </div>
        <select id="lease-home" className={`${FIELD} mt-3`} value={known ? viewingId : ""} onChange={(e) => setViewingId(e.target.value)}>
          <option value="">不在看房紀錄裡（只檢查租約）</option>
          {homes.map((h) => (
            <option key={h.id} value={h.id}>
              {h.label}
            </option>
          ))}
        </select>
        {known ? (
          <p className="mt-1.5 text-xs text-slate-400">結果會存在這間的看房紀錄裡，可以一起比較。</p>
        ) : (
          <div className="animate-fade">
            <label className={`${FIELD_LABEL} mt-4`} htmlFor="lease-label">
              名稱（選填）
            </label>
            <input
              id="lease-label"
              className={FIELD}
              placeholder="例如：景美雅房的租約"
              maxLength={60}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
        )}
      </Card>

      <Notice tone="emerald" icon={ShieldCheck} title="你的租約不會被存下來">
        照片只用來分析，分析完立刻丟掉。結果裡的姓名、身分證字號、電話、門牌都會先遮蔽。
      </Notice>

      <Card className="mt-3 border-2 border-dashed border-slate-200 shadow-none">
        <div className="grid grid-cols-2 gap-3">
          <UploadTile icon={Camera} tone="emerald" label="拍照" disabled={full} onClick={() => cameraRef.current?.click()} />
          <UploadTile icon={Images} tone="sky" label="選照片或 PDF" disabled={full} onClick={() => pickRef.current?.click()} />
        </div>
        <p className="mt-3 text-center text-xs leading-relaxed text-slate-500">
          每一頁拍一張，最多 {MAX_FILES} 張；或上傳 1 個 PDF。
          <br />
          字要清楚、不要反光。
        </p>
      </Card>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        data-testid="lease-camera"
        onChange={(e) => {
          void add(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={pickRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        data-testid="lease-picker"
        onChange={(e) => {
          void add(e.target.files);
          e.target.value = "";
        }}
      />

      {busy === "preparing" && (
        <p className="mt-3 flex animate-fade items-center justify-center gap-2 text-sm text-slate-500" role="status">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          處理照片中…
        </p>
      )}

      {files.length > 0 && (
        <ul className="mt-4 grid grid-cols-3 gap-2.5" aria-label="已選的檔案">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="relative aspect-[3/4] animate-pop overflow-hidden rounded-2xl bg-white shadow-card">
              {f.previewUrl ? (
                <img src={f.previewUrl} alt={`第 ${i + 1} 頁`} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-2 text-center text-xs text-slate-600">
                  <IconBadge icon={FileText} tone="sky" />
                  <span className="line-clamp-2 break-all">{f.name}</span>
                </div>
              )}
              <span className="absolute bottom-1.5 left-1.5 rounded-full bg-slate-900/60 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">{i + 1}</span>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`移除第 ${i + 1} 個檔案`}
                className="absolute top-1 right-1 flex size-8 items-center justify-center rounded-full bg-slate-900/60 text-white backdrop-blur transition active:scale-90"
              >
                <X className="size-4" strokeWidth={2.5} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <BottomBar>
        <p className="mb-2 text-center text-xs text-slate-500 tabular-nums">
          已選 {files.length} 個檔案・{(total / 1024 / 1024).toFixed(1)} MB
        </p>
        <Button onClick={analyze} disabled={files.length === 0 || busy !== null} icon={files.length ? ShieldCheck : undefined}>
          {files.length === 0 ? "請先拍照或選檔" : "開始健檢"}
        </Button>
        {error && <ErrorText>{error}</ErrorText>}
      </BottomBar>
    </section>
  );
}

function UploadTile({ icon: Icon, tone, label, disabled, onClick }: { icon: LucideIcon; tone: Tone; label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl bg-slate-50 text-sm font-semibold text-slate-800 transition active:scale-95 active:bg-slate-100 disabled:opacity-40 disabled:active:scale-100"
    >
      <IconBadge icon={Icon} tone={tone} size="lg" />
      {label}
    </button>
  );
}

/** 分析中：文件掃描動畫＋步驟清單 */
export function Analyzing({ step }: { step: number }) {
  return (
    <section className="flex min-h-[85dvh] animate-fade flex-col items-center justify-center px-2 text-center">
      <div className="relative h-32 w-26 overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-slate-100" aria-hidden="true">
        <div className="space-y-2 p-4">
          <div className="h-2 w-2/3 rounded-full bg-slate-200" />
          <div className="h-1.5 rounded-full bg-slate-100" />
          <div className="h-1.5 rounded-full bg-slate-100" />
          <div className="h-1.5 w-4/5 rounded-full bg-slate-100" />
          <div className="h-1.5 rounded-full bg-slate-100" />
          <div className="h-1.5 w-3/5 rounded-full bg-slate-100" />
          <div className="h-1.5 rounded-full bg-slate-100" />
        </div>
        <div className="absolute inset-x-0 top-3 h-8 animate-scan bg-gradient-to-b from-emerald-400/0 via-emerald-400/30 to-emerald-400/0">
          <div className="absolute inset-x-2 top-1/2 h-0.5 rounded-full bg-emerald-500 shadow-[0_0_8px_var(--color-emerald-400)]" />
        </div>
      </div>
      <p className="mt-6 text-lg font-bold text-slate-900">正在檢查你的租約</p>
      <p className="mt-1 text-sm text-slate-500">大約需要 20–40 秒，請先不要關閉畫面。</p>
      <ol className="mt-6 w-full max-w-xs space-y-1 text-left">
        {PROGRESS_STEPS.map((label, i) => {
          const state = i < step ? "done" : i === step ? "now" : "todo";
          return (
            <li
              key={label}
              className={`flex min-h-10 items-center gap-3 rounded-2xl px-3 text-sm transition-colors duration-300 ${state === "now" ? "bg-white font-semibold text-slate-900 shadow-card" : state === "done" ? "text-slate-500" : "text-slate-300"}`}
              {...(state === "now" ? { role: "status" } : {})}
            >
              {state === "done" ? (
                <CircleCheck className="size-5 animate-pop text-emerald-500" aria-hidden="true" />
              ) : state === "now" ? (
                <LoaderCircle className="size-5 animate-spin text-emerald-600" aria-hidden="true" />
              ) : (
                <span className="flex size-5 items-center justify-center" aria-hidden="true">
                  <span className="size-2 rounded-full bg-slate-200" />
                </span>
              )}
              {label}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function FindingCard({ f }: { f: LeaseFinding }) {
  const lv = LEVEL[f.level];
  const LvIcon = lv.icon;
  return (
    <li className="relative overflow-hidden rounded-3xl bg-white p-4 pl-5 shadow-card" aria-label={f.title}>
      <span className={`absolute inset-y-4 left-0 w-1 rounded-r-full ${lv.bar}`} aria-hidden="true" />
      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${lv.pill}`}>
        <LvIcon className="size-3.5" aria-hidden="true" />
        {lv.label}
      </span>
      <p className="mt-2 text-base font-bold text-slate-900">{f.title}</p>
      {f.detail && <p className="mt-1 text-sm font-medium text-slate-800">{f.detail}</p>}
      {f.quotes.map((q) => (
        <blockquote key={q} className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">
          <span className="mb-1 flex items-center gap-1 text-xs text-slate-400">
            <Quote className="size-3.5" aria-hidden="true" />
            你的租約寫
          </span>
          「{q}」
        </blockquote>
      ))}
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.explanation}</p>
      {f.basis.length > 0 && (
        <div className="mt-3 space-y-2">
          {f.basis.map((b) => (
            <div key={b.label}>
              <SourceChip href={b.url}>{b.label}</SourceChip>
              {b.quote && <p className="mt-1.5 border-l-2 border-emerald-200 pl-3 text-xs leading-relaxed text-slate-500">「{b.quote}」</p>}
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 rounded-2xl bg-emerald-50 p-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
          <MessagesSquare className="size-4" aria-hidden="true" />
          可以這樣跟房東談
        </p>
        <p className="mt-1 text-sm leading-relaxed text-emerald-900">{f.negotiate}</p>
        <CopyButton size="sm" text={f.negotiate.replace(/^「|」$/g, "")} label="複製這句話" />
      </div>
    </li>
  );
}

function CountTile({ value, label, icon: Icon, tone, testId }: { value: number; label: string; icon: LucideIcon; tone: "red" | "amber" | "emerald"; testId?: string }) {
  const shown = useCountUp(value, 700);
  const cls = { red: "bg-red-50 text-red-700", amber: "bg-amber-50 text-amber-700", emerald: "bg-emerald-50 text-emerald-700" }[tone];
  return (
    <div className={`flex flex-col items-center rounded-3xl px-2 py-3 ${cls}`}>
      <Icon className="size-5 opacity-80" aria-hidden="true" />
      <p className="mt-1 text-3xl font-bold tabular-nums" data-testid={testId}>
        {shown}
      </p>
      <p className="text-xs font-medium">{label}</p>
    </div>
  );
}

export function LeaseResultView({
  result,
  onRestart,
  restartLabel = "檢查另一份租約",
  onDelete,
}: {
  result: LeaseResult;
  onRestart: () => void;
  restartLabel?: string;
  /** 從紀錄打開時才有：刪除這筆租約健檢 */
  onDelete?: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  if (result.status === "not_lease") {
    return (
      <section className="animate-enter">
        <PageHeader title="租約健檢" back={onRestart} />
        <EmptyState icon={FileQuestion} tone="amber" title="看不出是租約" desc="這看起來不像住宅租約。請拍租約的內容頁再試一次。">
          <Button onClick={onRestart} icon={RotateCcw}>
            重新上傳
          </Button>
        </EmptyState>
      </section>
    );
  }
  const red = result.findings.filter((f) => f.level === "red").length;
  const yellow = result.findings.filter((f) => f.level === "yellow").length;
  const fmt = (n: number | null) => (n === null ? "未寫" : `${n.toLocaleString("zh-TW")} 元`);
  const { fields } = result;

  return (
    <section className="animate-enter">
      <PageHeader title="租約健檢結果" back={onRestart} />
      <p className="truncate px-1 text-center text-sm font-medium text-slate-600">{result.label}</p>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <CountTile value={red} label="紅燈" icon={OctagonAlert} tone="red" testId="lease-red" />
        <CountTile value={yellow} label="黃燈" icon={TriangleAlert} tone="amber" testId="lease-yellow" />
        <CountTile value={result.passed.length} label="沒發現問題" icon={CircleCheck} tone="emerald" />
      </div>

      {result.readability !== "good" && <Notice>有些地方看不清楚或缺頁，結果可能不完整。可以重拍後再檢查一次。</Notice>}

      <Card className="mt-3 divide-y divide-slate-100 py-1">
        <FieldRow icon={Banknote} label="月租金" value={fmt(fields.monthlyRent)} />
        <FieldRow icon={Wallet} label="押金" value={fmt(fields.deposit)} />
        <FieldRow
          icon={CalendarRange}
          label="租期"
          value={
            fields.leaseStart || fields.leaseEnd ? (
              <>
                <span className="block">{fields.leaseStart ?? "未寫"}</span>
                <span className="block text-slate-500">至 {fields.leaseEnd ?? "未寫"}</span>
              </>
            ) : (
              "未寫"
            )
          }
        />
      </Card>

      {result.findings.length === 0 ? (
        <Notice tone="emerald" icon={CircleCheck}>
          沒有發現紅燈或黃燈項目。
        </Notice>
      ) : (
        <ul className="stagger mt-4 space-y-3">
          {result.findings.map((f) => (
            <FindingCard key={f.ruleId} f={f} />
          ))}
        </ul>
      )}

      {result.passed.length > 0 && (
        <div className="mt-3">
          <Disclosure icon={CircleCheck} title={`沒發現問題的項目（${result.passed.length}）`}>
            <ul className="space-y-2 text-sm text-slate-700">
              {result.passed.map((p) => (
                <li key={p.ruleId} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" strokeWidth={2.5} aria-hidden="true" />
                  {p.title}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-400">只代表這次沒找到相關條款，不代表租約完全沒有問題。</p>
          </Disclosure>
        </div>
      )}

      <p className="mt-4 px-1 text-xs leading-relaxed text-slate-400">結果由 AI 讀取租約後依規則比對，可能看錯字。簽約前請再核對原文。</p>
      <div className="mt-6 space-y-3">
        {!onDelete && (
          <LinkButton href="/viewings" variant="secondary" icon={History}>
            我的看房紀錄
          </LinkButton>
        )}
        <Button variant="ghost" onClick={onRestart} icon={onDelete ? ArrowLeft : RotateCcw}>
          {restartLabel}
        </Button>
        {onDelete && (
          <Button variant="dangerSoft" onClick={() => setConfirming(true)} icon={Trash2}>
            刪除這份租約健檢
          </Button>
        )}
      </div>
      <Disclaimer />
      {confirming && onDelete && (
        <ConfirmSheet
          title="刪除這份租約健檢？"
          message={`「${result.label}」的租約健檢結果會永久刪除，無法復原。`}
          confirmLabel="刪除"
          busy={deleting}
          error={deleteError}
          onConfirm={async () => {
            setDeleting(true);
            setDeleteError(null);
            try {
              await onDelete();
            } catch (err) {
              setDeleteError(errorMessage(err));
              setDeleting(false);
            }
          }}
          onCancel={() => {
            setConfirming(false);
            setDeleteError(null);
          }}
        />
      )}
    </section>
  );
}

function FieldRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-3 text-sm">
      <Icon className="size-5 shrink-0 text-slate-400" aria-hidden="true" />
      <span className="text-slate-500">{label}</span>
      <span className="min-w-0 flex-1 text-right font-semibold text-slate-900">{value}</span>
    </div>
  );
}
