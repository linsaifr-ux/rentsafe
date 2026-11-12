import { useEffect, useState } from "react";
import { api, errorMessage, type ViewingAnswer, type ViewingChecklist, type ViewingResult } from "../api.ts";
import { ALL_CITIES } from "../cities.ts";
import { Disclaimer } from "../components/Disclaimer.tsx";
import { BottomBar, Button, ConfirmSheet, LinkButton, NavCard, SourceChip } from "../components/ui.tsx";
import type { PageProps } from "../router.tsx";

type Client = Pick<typeof api, "viewingChecklist" | "submitViewing">;

const ANSWER_LABEL: Record<ViewingAnswer, string> = { yes: "是", no: "否", unknown: "不確定" };

/** 手機輸入框：16px 字避免 iOS 自動放大 */
export const FIELD = "mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-base text-gray-900";
export const FIELD_LABEL = "block text-sm font-semibold text-gray-700";

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

  if (error && !checklist) return <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  if (!checklist) return <p className="py-8 text-center text-gray-500">載入中…</p>;

  if (result) return <ViewingResultView result={result} onRestart={() => setResult(null)} />;

  const preset = checklist.housingTypes.find((h) => h.id === housingType)?.presetAnswers ?? {};
  const answered = checklist.items.filter((it) => preset[it.id] ?? answers[it.id]).length;

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
    <section>
      <h1 className="text-2xl font-bold text-gray-900">看房健檢</h1>
      <p className="mt-1 text-sm text-gray-600">看房時邊看邊勾，最後會告訴你哪裡有紅燈、要問房東什麼。</p>

      <div className="mt-4">
        <NavCard href="/viewings" icon="📋" title="我的看房紀錄" desc="看過的房子都在這，可以互相比較" />
      </div>

      <div className="mt-4 space-y-4 rounded-2xl bg-white p-4 shadow-sm">
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
          <p className="mt-1 text-xs text-gray-400">不填會自動用縣市＋房型＋日期命名。</p>
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
          <div className="mt-1 grid grid-cols-3 gap-2">
            {checklist.housingTypes.map((h) => {
              const on = housingType === h.id;
              return (
                <button
                  key={h.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setHousingType(h.id)}
                  className={`min-h-11 rounded-xl border text-sm ${on ? "border-emerald-600 bg-emerald-50 font-semibold text-emerald-800" : "border-gray-200 bg-gray-50 text-gray-700 active:bg-gray-100"}`}
                >
                  {h.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>

      <ol className="mt-4 space-y-3">
        {checklist.items.map((it, i) => {
          const locked = preset[it.id];
          const value = locked ?? answers[it.id];
          return (
            <li key={it.id} className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-base font-medium text-gray-900">
                <span className="mr-1 text-gray-400">{i + 1}.</span>
                {it.question}
              </p>
              <details className="group mt-2">
                <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 rounded-full bg-gray-100 px-3 text-xs text-gray-600 [&::-webkit-details-marker]:hidden">
                  ⓘ 為什麼重要
                </summary>
                <p className="mt-2 rounded-xl bg-gray-50 p-3 text-sm text-gray-600">{it.why}</p>
              </details>
              <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label={it.question}>
                {(["yes", "no", "unknown"] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    role="radio"
                    aria-checked={value === a}
                    disabled={Boolean(locked)}
                    onClick={() => setAnswers((prev) => ({ ...prev, [it.id]: a }))}
                    className={`min-h-11 rounded-xl border text-base ${value === a ? "border-emerald-600 bg-emerald-600 font-semibold text-white" : "border-gray-200 bg-gray-50 text-gray-700 active:bg-gray-100"} disabled:opacity-70`}
                  >
                    {ANSWER_LABEL[a]}
                  </button>
                ))}
              </div>
              {locked && <p className="mt-2 text-xs text-gray-500">依你選的房型自動帶入</p>}
            </li>
          );
        })}
      </ol>

      <BottomBar>
        <p className="mb-2 text-center text-xs text-gray-500">
          已回答 {answered}／{checklist.items.length} 題・沒回答的當作「不確定」
        </p>
        <Button onClick={submit} disabled={!housingType || submitting}>
          {submitting ? "分析中…" : housingType ? "看結果" : "請先選房型"}
        </Button>
        {error && <p className="mt-2 text-center text-sm text-red-700">{error}</p>}
      </BottomBar>
    </section>
  );
}

function scoreStyle(score: number): { label: string; className: string; ring: string } {
  if (score >= 80) return { label: "大致安全", className: "text-emerald-700", ring: "bg-emerald-50" };
  if (score >= 60) return { label: "有些地方要注意", className: "text-amber-600", ring: "bg-amber-50" };
  return { label: "紅燈很多，建議再考慮", className: "text-red-700", ring: "bg-red-50" };
}

export function ViewingResultView({
  result,
  onRestart,
  restartLabel = "重新檢查",
  onDelete,
}: {
  result: ViewingResult;
  onRestart: () => void;
  restartLabel?: string;
  /** 有傳才顯示「刪除這筆紀錄」；回傳 Promise，失敗時丟錯 */
  onDelete?: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
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
  const style = scoreStyle(result.score);
  const questionText = result.questions.map((q, i) => `${i + 1}. ${q}`).join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(`想請問房東幾個問題：\n${questionText}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const { fireRule } = result;
  const articles = [...fireRule.local, ...(fireRule.national ? [fireRule.national] : [])];

  return (
    <section>
      <h1 className="text-2xl font-bold text-gray-900">看房健檢結果</h1>
      <p className="mt-1 text-sm text-gray-600">{result.label}</p>

      <div className={`mt-4 rounded-2xl p-5 text-center ${style.ring}`}>
        <p className="text-sm text-gray-600">安全分數</p>
        <p className={`text-6xl font-bold ${style.className}`} data-testid="viewing-score">
          {result.score}
        </p>
        <p className={`mt-1 font-semibold ${style.className}`}>{style.label}</p>
        <p className="mt-2 text-xs text-gray-500">分數只依你勾選的項目計算，不代表房子實際安全程度。</p>
      </div>

      {result.warning && <p className="mt-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">⚠️ {result.warning}</p>}

      <h2 className="mt-6 text-lg font-bold text-gray-900">🚩 紅燈（{result.redFlags.length}）</h2>
      {result.redFlags.length === 0 ? (
        <p className="mt-2 rounded-2xl bg-white p-4 text-sm text-gray-600 shadow-sm">沒有紅燈。</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {result.redFlags.map((f) => (
            <li key={f.id} className="rounded-2xl border-l-4 border-red-500 bg-white p-4 shadow-sm">
              <p className="font-medium text-gray-900">{f.question}</p>
              <p className="mt-1 text-sm text-gray-600">{f.why}</p>
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

      <h2 className="mt-6 text-lg font-bold text-gray-900">🔥 住警器規定</h2>
      {fireRule.note && <p className="mt-2 rounded-2xl bg-gray-100 p-4 text-sm text-gray-600">{fireRule.note}</p>}
      <div className="mt-2 space-y-3">
        {articles.map((a) => (
          <details key={`${a.lawName}${a.articleNo}`} className="group rounded-2xl bg-white shadow-sm" open={fireRule.local.includes(a)}>
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 py-3 font-medium text-gray-900 [&::-webkit-details-marker]:hidden">
              <span className="flex-1">
                {a.lawName} 第 {a.articleNo} 條
              </span>
              <span className="text-gray-400 transition-transform group-open:rotate-90" aria-hidden="true">
                ›
              </span>
            </summary>
            <div className="px-4 pb-4">
              <p className="whitespace-pre-line text-sm leading-relaxed text-gray-700">{a.text}</p>
              <div className="mt-3">
                <SourceChip href={a.sourceUrl}>官方原文</SourceChip>
              </div>
            </div>
          </details>
        ))}
      </div>

      {result.questions.length > 0 && (
        <>
          <h2 className="mt-6 text-lg font-bold text-gray-900">💬 要問房東的問題</h2>
          <ol className="mt-2 space-y-2 rounded-2xl bg-white p-4 text-sm text-gray-800 shadow-sm">
            {result.questions.map((q, i) => (
              <li key={q} className="flex gap-2">
                <span className="text-gray-400">{i + 1}.</span>
                <span>{q}</span>
              </li>
            ))}
          </ol>
          <Button variant="secondary" className="mt-3" onClick={copy}>
            {copied ? "✓ 已複製，可以貼給房東" : "複製問題"}
          </Button>
        </>
      )}

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
            🗑 刪除這筆紀錄
          </Button>
        )}
      </div>
      <Disclaimer />
      {confirming && (
        <ConfirmSheet
          title="刪除這筆看房紀錄？"
          message={`「${result.label}」的回答和結果會永久刪除，無法復原。`}
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
