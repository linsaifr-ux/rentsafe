import { useEffect, useRef, useState } from "react";
import { api, errorMessage, type LeaseFinding, type LeaseResult, type ViewingSummary } from "../api.ts";
import { Disclaimer } from "../components/Disclaimer.tsx";
import { BottomBar, Button, ConfirmSheet, LinkButton, NavCard, SourceChip } from "../components/ui.tsx";
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
  red: { label: "紅燈", dot: "bg-red-500", card: "border-red-500", text: "text-red-700" },
  yellow: { label: "黃燈", dot: "bg-amber-400", card: "border-amber-400", text: "text-amber-700" },
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

  if (busy === "analyzing") {
    return (
      <section className="flex min-h-[70dvh] flex-col items-center justify-center text-center">
        <div className="h-14 w-14 animate-spin rounded-full border-4 border-emerald-100 border-t-emerald-600" aria-hidden="true" />
        <p className="mt-6 text-lg font-semibold text-gray-900" role="status">
          {PROGRESS_STEPS[step]}
        </p>
        <p className="mt-2 text-sm text-gray-500">大約需要 20–40 秒，請先不要關閉畫面。</p>
      </section>
    );
  }

  return (
    <section>
      <h1 className="text-2xl font-bold text-gray-900">租約健檢</h1>
      <p className="mt-1 text-sm text-gray-600">拍下租約，幫你對照內政部的契約規定，找出押金、電費、稅金等常見問題。</p>

      <div className="mt-4">
        <NavCard href="/viewings" icon="📋" title="我的看房紀錄" desc="做過的租約健檢也在這，可以跟看房結果一起比較" />
      </div>

      <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
        <label className={FIELD_LABEL} htmlFor="lease-home">
          這是哪一間的租約？
        </label>
        <select id="lease-home" className={FIELD} value={homes.some((h) => h.id === viewingId) ? viewingId : ""} onChange={(e) => setViewingId(e.target.value)}>
          <option value="">不在看房紀錄裡（只檢查租約）</option>
          {homes.map((h) => (
            <option key={h.id} value={h.id}>
              {h.label}
            </option>
          ))}
        </select>
        {homes.some((h) => h.id === viewingId) ? (
          <p className="mt-1 text-xs text-gray-400">結果會存在這間的看房紀錄裡，可以一起比較。</p>
        ) : (
          <>
            <label className={`${FIELD_LABEL} mt-3`} htmlFor="lease-label">
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
          </>
        )}
      </div>

      <div className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900">
        <p className="font-semibold">🔒 你的租約不會被存下來</p>
        <p className="mt-1">照片只用來分析，分析完立刻丟掉。結果裡的姓名、身分證字號、電話、門牌都會先遮蔽。</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Button variant="primary" onClick={() => cameraRef.current?.click()} disabled={busy !== null || hasPdf || files.length >= MAX_FILES}>
          📷 拍照
        </Button>
        <Button variant="secondary" onClick={() => pickRef.current?.click()} disabled={busy !== null || hasPdf || files.length >= MAX_FILES}>
          🖼 選照片或 PDF
        </Button>
      </div>
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
      <p className="mt-2 text-center text-xs text-gray-500">
        每一頁拍一張，最多 {MAX_FILES} 張；或上傳 1 個 PDF。字要清楚、不要反光。
      </p>

      {busy === "preparing" && <p className="mt-3 text-center text-sm text-gray-500">處理照片中…</p>}

      {files.length > 0 && (
        <ul className="mt-4 grid grid-cols-3 gap-2" aria-label="已選的檔案">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="relative aspect-[3/4] overflow-hidden rounded-xl bg-white shadow-sm">
              {f.previewUrl ? (
                <img src={f.previewUrl} alt={`第 ${i + 1} 頁`} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center p-2 text-center text-xs text-gray-600">
                  <span className="text-3xl" aria-hidden="true">
                    📄
                  </span>
                  <span className="mt-1 line-clamp-2 break-all">{f.name}</span>
                </div>
              )}
              <span className="absolute top-1 left-1 rounded-full bg-black/60 px-2 text-xs text-white">{i + 1}</span>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`移除第 ${i + 1} 個檔案`}
                className="absolute top-1 right-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <BottomBar>
        <p className="mb-2 text-center text-xs text-gray-500">
          已選 {files.length} 個檔案・{(total / 1024 / 1024).toFixed(1)} MB
        </p>
        <Button onClick={analyze} disabled={files.length === 0 || busy !== null}>
          {files.length === 0 ? "請先拍照或選檔" : "開始健檢"}
        </Button>
        {error && <p className="mt-2 text-center text-sm text-red-700">{error}</p>}
      </BottomBar>
    </section>
  );
}

function FindingCard({ f }: { f: LeaseFinding }) {
  const [copied, setCopied] = useState(false);
  const lv = LEVEL[f.level];
  return (
    <li className={`rounded-2xl border-l-4 bg-white p-4 shadow-sm ${lv.card}`} aria-label={f.title}>
      <p className={`flex items-center gap-2 text-xs font-semibold ${lv.text}`}>
        <span className={`h-2.5 w-2.5 rounded-full ${lv.dot}`} aria-hidden="true" />
        {lv.label}
      </p>
      <p className="mt-1 text-base font-bold text-gray-900">{f.title}</p>
      {f.detail && <p className="mt-1 text-sm font-medium text-gray-800">{f.detail}</p>}
      {f.quotes.map((q) => (
        <blockquote key={q} className="mt-2 rounded-xl bg-gray-50 p-3 text-sm text-gray-700">
          <span className="block text-xs text-gray-400">你的租約寫：</span>「{q}」
        </blockquote>
      ))}
      <p className="mt-2 text-sm text-gray-600">{f.explanation}</p>
      {f.basis.length > 0 && (
        <div className="mt-3 space-y-2">
          {f.basis.map((b) => (
            <div key={b.label}>
              <SourceChip href={b.url}>{b.label}</SourceChip>
              {b.quote && <p className="mt-1 pl-3 text-xs text-gray-500">「{b.quote}」</p>}
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 rounded-xl bg-emerald-50 p-3">
        <p className="text-xs font-semibold text-emerald-800">💬 可以這樣跟房東談</p>
        <p className="mt-1 text-sm text-emerald-900">{f.negotiate}</p>
        <button
          type="button"
          className="mt-2 min-h-9 rounded-full bg-white px-3 text-xs font-semibold text-emerald-700 active:bg-emerald-100"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(f.negotiate.replace(/^「|」$/g, ""));
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "✓ 已複製" : "複製這句話"}
        </button>
      </div>
    </li>
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
      <section>
        <h1 className="text-2xl font-bold text-gray-900">租約健檢</h1>
        <div className="mt-4 rounded-2xl bg-white p-5 text-center shadow-sm">
          <p className="text-4xl" aria-hidden="true">
            🤔
          </p>
          <p className="mt-2 text-gray-700">這看起來不像住宅租約。請拍租約的內容頁再試一次。</p>
        </div>
        <Button className="mt-4" onClick={onRestart}>
          重新上傳
        </Button>
      </section>
    );
  }
  const red = result.findings.filter((f) => f.level === "red").length;
  const yellow = result.findings.filter((f) => f.level === "yellow").length;
  const fmt = (n: number | null) => (n === null ? "未寫" : `${n.toLocaleString("zh-TW")} 元`);
  const { fields } = result;

  return (
    <section>
      <h1 className="text-2xl font-bold text-gray-900">租約健檢結果</h1>
      <p className="mt-1 text-sm text-gray-600">{result.label}</p>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl bg-red-50 p-3">
          <p className="text-3xl font-bold text-red-700" data-testid="lease-red">
            {red}
          </p>
          <p className="text-xs text-red-700">紅燈</p>
        </div>
        <div className="rounded-2xl bg-amber-50 p-3">
          <p className="text-3xl font-bold text-amber-600" data-testid="lease-yellow">
            {yellow}
          </p>
          <p className="text-xs text-amber-700">黃燈</p>
        </div>
        <div className="rounded-2xl bg-emerald-50 p-3">
          <p className="text-3xl font-bold text-emerald-700">{result.passed.length}</p>
          <p className="text-xs text-emerald-700">沒發現問題</p>
        </div>
      </div>

      {result.readability !== "good" && (
        <p className="mt-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">⚠️ 有些地方看不清楚或缺頁，結果可能不完整。可以重拍後再檢查一次。</p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-white p-4 text-sm shadow-sm">
        <dt className="text-gray-500">月租金</dt>
        <dd className="text-right font-medium text-gray-900">{fmt(fields.monthlyRent)}</dd>
        <dt className="text-gray-500">押金</dt>
        <dd className="text-right font-medium text-gray-900">{fmt(fields.deposit)}</dd>
        <dt className="text-gray-500">租期</dt>
        <dd className="text-right font-medium text-gray-900">
          {fields.leaseStart || fields.leaseEnd ? (
            <>
              <span className="block">{fields.leaseStart ?? "未寫"}</span>
              <span className="block text-gray-500">至 {fields.leaseEnd ?? "未寫"}</span>
            </>
          ) : (
            "未寫"
          )}
        </dd>
      </dl>

      {result.findings.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-white p-4 text-sm text-gray-600 shadow-sm">沒有發現紅燈或黃燈項目。</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {result.findings.map((f) => (
            <FindingCard key={f.ruleId} f={f} />
          ))}
        </ul>
      )}

      {result.passed.length > 0 && (
        <details className="group mt-4 rounded-2xl bg-white shadow-sm">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 py-3 font-medium text-gray-900 [&::-webkit-details-marker]:hidden">
            <span className="flex-1">✅ 沒發現問題的項目（{result.passed.length}）</span>
            <span className="text-gray-400 transition-transform group-open:rotate-90" aria-hidden="true">
              ›
            </span>
          </summary>
          <div className="px-4 pb-4">
            <ul className="space-y-1 text-sm text-gray-700">
              {result.passed.map((p) => (
                <li key={p.ruleId}>・{p.title}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-gray-400">只代表這次沒找到相關條款，不代表租約完全沒有問題。</p>
          </div>
        </details>
      )}

      <p className="mt-4 text-xs text-gray-400">結果由 AI 讀取租約後依規則比對，可能看錯字。簽約前請再核對原文。</p>
      <div className="mt-6 space-y-3">
        {!onDelete && (
          <LinkButton href="/viewings" variant="secondary">
            📋 我的看房紀錄
          </LinkButton>
        )}
        <Button variant="ghost" onClick={onRestart}>
          {restartLabel}
        </Button>
        {onDelete && (
          <Button variant="dangerSoft" onClick={() => setConfirming(true)}>
            🗑 刪除這份租約健檢
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
