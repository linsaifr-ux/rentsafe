import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  CircleCheck,
  Flag,
  Flame,
  History,
  Info,
  Lock,
  MessageCircleQuestion,
  RotateCcw,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Trash2,
} from "lucide-react";
import { api, errorMessage, type ViewingAnswer, type ViewingChecklist, type ViewingResult } from "../api.ts";
import { ALL_CITIES } from "../cities.ts";
import { Disclaimer } from "../components/Disclaimer.tsx";
import {
  BottomBar,
  Button,
  Card,
  ConfirmSheet,
  CopyButton,
  Disclosure,
  ErrorText,
  LinkButton,
  NavCard,
  Notice,
  PageHeader,
  PageSkeleton,
  ScoreRing,
  SectionTitle,
  SourceChip,
  TONE,
  scoreTone,
} from "../components/ui.tsx";
import type { PageProps } from "../router.tsx";

type Client = Pick<typeof api, "viewingChecklist" | "submitViewing">;

const ANSWER_LABEL: Record<ViewingAnswer, string> = { yes: "是", no: "否", unknown: "不確定" };

/** 手機輸入框：16px 字避免 iOS 自動放大 */
export const FIELD =
  "mt-1.5 min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base text-slate-900 transition outline-none placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/15";
export const FIELD_LABEL = "block text-sm font-semibold text-slate-700";

/** F1 看房健檢（SPEC 7）：勾選清單 → 安全分數、紅燈、住警器規定、要問房東的問題 */
export function ViewingCheck({ me, client = api }: PageProps & { client?: Client }) {
  const [checklist, setChecklist] = useState<ViewingChecklist | null>(null);
  const [label, setLabel] = useState("");
  const [city, setCity] = useState<string>(me.city ?? "");
  const [housingType, setHousingType] = useState<string>("");
  const [answers, setAnswers] = useState<Record<string, ViewingAnswer>>({});
  const [result, setResult] = useState<ViewingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    client.viewingChecklist().then(setChecklist, (err: unknown) => setError(errorMessage(err)));
  }, [client]);

  if (error && !checklist) {
    return (
      <section>
        <PageHeader title="看房健檢" />
        <Notice tone="red" className="mt-0">
          {error}
        </Notice>
      </section>
    );
  }
  if (!checklist) return <PageSkeleton />;

  if (result) return <ViewingResultView result={result} onRestart={() => setResult(null)} />;

  const preset = checklist.housingTypes.find((h) => h.id === housingType)?.presetAnswers ?? {};
  const answered = checklist.items.filter((it) => preset[it.id] ?? answers[it.id]).length;
  const progress = Math.round((answered / checklist.items.length) * 100);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      setResult(await client.submitViewing({ ...(label.trim() ? { label: label.trim() } : {}), city: city || null, housingType, answers }));
      window.scrollTo?.(0, 0);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="animate-enter">
      <PageHeader title="看房健檢" />
      <p className="px-1 text-sm leading-relaxed text-slate-600">看房時邊看邊勾，最後會告訴你哪裡有紅燈、要問房東什麼。</p>

      <div className="mt-4">
        <NavCard href="/viewings" icon={History} tone="violet" title="我的看房紀錄" desc="看過的房子都在這，可以互相比較" />
      </div>

      <Card className="mt-3 space-y-5">
        <div>
          <label className={FIELD_LABEL} htmlFor="viewing-label">
            這間的名稱或地址（選填）
          </label>
          <input
            id="viewing-label"
            className={FIELD}
            placeholder="例如：公館羅斯福路 5 樓套房"
            maxLength={60}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <p className="mt-1.5 text-xs text-slate-400">不填會自動用縣市＋房型＋日期命名。</p>
        </div>

        <div>
          <label className={FIELD_LABEL} htmlFor="viewing-city">
            房子在哪個縣市
          </label>
          <select id="viewing-city" className={FIELD} value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="">其他／不確定</option>
            {ALL_CITIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <fieldset>
          <legend className={FIELD_LABEL}>房型</legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {checklist.housingTypes.map((h) => {
              const on = housingType === h.id;
              return (
                <button
                  key={h.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setHousingType(h.id)}
                  className={`relative min-h-12 rounded-2xl text-sm transition duration-200 active:scale-95 ${on ? "bg-emerald-600 font-semibold text-white shadow-brand" : "bg-slate-50 text-slate-700 ring-1 ring-slate-200 active:bg-slate-100"}`}
                >
                  {h.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      </Card>

      <ol className="mt-3 space-y-3">
        {checklist.items.map((it, i) => {
          const locked = preset[it.id];
          const value = locked ?? answers[it.id];
          return (
            <li key={it.id} className="rounded-3xl bg-white p-4 shadow-card">
              <div className="flex gap-3">
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors duration-300 ${value ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
                  aria-hidden="true"
                >
                  {value ? <Check key="done" className="size-4 animate-pop" strokeWidth={3} /> : i + 1}
                </span>
                <p className="min-w-0 flex-1 pt-0.5 text-base font-medium text-slate-900">{it.question}</p>
              </div>
              <details className="group mt-2 ml-10">
                <summary className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full bg-slate-100 px-3 text-xs font-medium text-slate-600 transition active:scale-95">
                  <Info className="size-3.5" aria-hidden="true" />
                  為什麼重要
                  <ChevronDown className="size-3.5 transition-transform duration-300 group-open:rotate-180" aria-hidden="true" />
                </summary>
                <p className="mt-2 rounded-2xl bg-slate-50 p-3 text-sm leading-relaxed text-slate-600">{it.why}</p>
              </details>
              <div className="mt-3 grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1" role="radiogroup" aria-label={it.question}>
                {(["yes", "no", "unknown"] as const).map((a) => {
                  const on = value === a;
                  return (
                    <button
                      key={a}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={Boolean(locked)}
                      onClick={() => setAnswers((prev) => ({ ...prev, [it.id]: a }))}
                      className={`min-h-11 rounded-xl text-base transition duration-200 active:scale-95 ${on ? "bg-white font-semibold text-emerald-700 shadow-card" : "text-slate-600"} disabled:opacity-70`}
                    >
                      {ANSWER_LABEL[a]}
                    </button>
                  );
                })}
              </div>
              {locked && (
                <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
                  <Lock className="size-3.5" aria-hidden="true" />
                  依你選的房型自動帶入
                </p>
              )}
            </li>
          );
        })}
      </ol>

      <BottomBar>
        <div className="mb-2.5 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
            <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-slate-500 tabular-nums">
            {answered}／{checklist.items.length}
          </p>
        </div>
        <p className="mb-2 text-center text-xs text-slate-400">沒回答的當作「不確定」</p>
        <Button onClick={submit} disabled={!housingType || submitting} icon={housingType && !submitting ? ShieldCheck : undefined}>
          {submitting ? "分析中…" : housingType ? "看結果" : "請先選房型"}
        </Button>
        {error && <ErrorText>{error}</ErrorText>}
      </BottomBar>
    </section>
  );
}

const BAND: Record<string, string> = { emerald: "from-emerald-50", amber: "from-amber-50", red: "from-red-50" };

export function ViewingResultView({
  result,
  onRestart,
  restartLabel = "重新檢查",
  onDelete,
  extra,
}: {
  result: ViewingResult;
  onRestart: () => void;
  restartLabel?: string;
  /** 有傳才顯示「刪除這筆紀錄」；回傳 Promise，失敗時丟錯 */
  onDelete?: () => Promise<void>;
  /** 分數下方的額外區塊（看房紀錄裡放這間的租約健檢） */
  extra?: ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function confirmDelete() {
    if (!onDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete();
    } catch (err) {
      setDeleteError(errorMessage(err));
      setDeleting(false);
    }
  }
  const st = scoreTone(result.score);
  const ToneIcon = st.tone === "emerald" ? ShieldCheck : st.tone === "amber" ? ShieldAlert : ShieldX;
  const questionText = result.questions.map((q, i) => `${i + 1}. ${q}`).join("\n");

  const { fireRule } = result;
  const articles = [...fireRule.local, ...(fireRule.national ? [fireRule.national] : [])];

  return (
    <section className="animate-enter">
      <PageHeader title="看房健檢結果" back={onRestart} />

      <Card className="relative overflow-hidden px-5 pt-6 pb-5 text-center">
        <span className={`absolute inset-x-0 top-0 h-40 bg-gradient-to-b ${BAND[st.tone]} to-white`} aria-hidden="true" />
        <p className="relative truncate text-sm font-medium text-slate-600">{result.label}</p>
        <div className="relative mt-3 flex justify-center">
          <ScoreRing score={result.score} testId="viewing-score" />
        </div>
        <p className={`relative mt-3 inline-flex items-center gap-1.5 font-bold ${TONE[st.tone].text}`}>
          <ToneIcon className="size-5" aria-hidden="true" />
          {st.label}
        </p>
        <p className="relative mt-2 text-xs text-slate-400">安全分數只依你勾選的項目計算，不代表房子實際安全程度。</p>
      </Card>

      {result.warning && <Notice>{result.warning}</Notice>}
      {extra}

      <SectionTitle icon={Flag} tone="red" count={result.redFlags.length}>
        紅燈
      </SectionTitle>
      {result.redFlags.length === 0 ? (
        <Notice tone="emerald" icon={CircleCheck}>
          沒有紅燈。
        </Notice>
      ) : (
        <ul className="stagger mt-3 space-y-3">
          {result.redFlags.map((f) => (
            <li key={f.id} className="relative overflow-hidden rounded-3xl bg-white p-4 pl-5 shadow-card">
              <span className="absolute inset-y-4 left-0 w-1 rounded-r-full bg-red-500" aria-hidden="true" />
              <p className="font-semibold text-slate-900">{f.question}</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{f.why}</p>
              {f.citations.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {f.citations.map((c) => (
                    <SourceChip key={`${c.lawName}${c.articleNo}`} href={c.url}>
                      {c.lawName}第 {c.articleNo} 條
                    </SourceChip>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <SectionTitle icon={Flame} tone="orange">
        住警器規定
      </SectionTitle>
      {fireRule.note && (
        <Notice tone="slate" icon={Info}>
          {fireRule.note}
        </Notice>
      )}
      <div className="mt-3 space-y-3">
        {articles.map((a) => (
          <Disclosure key={`${a.lawName}${a.articleNo}`} icon={ScrollText} defaultOpen={fireRule.local.includes(a)} title={<span>{a.lawName} 第 {a.articleNo} 條</span>}>
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{a.text}</p>
            <div className="mt-3">
              <SourceChip href={a.sourceUrl}>官方原文</SourceChip>
            </div>
          </Disclosure>
        ))}
      </div>

      {result.questions.length > 0 && (
        <>
          <SectionTitle icon={MessageCircleQuestion} tone="sky" count={result.questions.length}>
            要問房東的問題
          </SectionTitle>
          <Card className="mt-3">
            <ol className="space-y-3 text-sm text-slate-800">
              {result.questions.map((q, i) => (
                <li key={q} className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-sky-50 text-xs font-bold text-sky-700">{i + 1}</span>
                  <span className="pt-0.5 leading-relaxed">{q}</span>
                </li>
              ))}
            </ol>
          </Card>
          <CopyButton text={`想請問房東幾個問題：\n${questionText}`} label="複製問題" doneLabel="已複製，可以貼給房東" />
        </>
      )}

      <div className="mt-8 space-y-3">
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
            刪除這筆紀錄
          </Button>
        )}
      </div>
      <Disclaimer />
      {confirming && (
        <ConfirmSheet
          title="刪除這筆看房紀錄？"
          message={
            result.lease
              ? `「${result.label}」的看房結果和這間的租約健檢會一起永久刪除，無法復原。`
              : `「${result.label}」的回答和結果會永久刪除，無法復原。`
          }
          confirmLabel="刪除"
          busy={deleting}
          error={deleteError}
          onConfirm={confirmDelete}
          onCancel={() => {
            setConfirming(false);
            setDeleteError(null);
          }}
        />
      )}
    </section>
  );
}
