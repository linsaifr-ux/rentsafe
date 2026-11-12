import { useEffect, useState } from "react";
import { api, errorMessage, type ViewingAnswer, type ViewingChecklist, type ViewingResult } from "../api.ts";
import { ALL_CITIES } from "../cities.ts";
import { Disclaimer } from "../components/Disclaimer.tsx";
import type { PageProps } from "../router.tsx";

type Client = Pick<typeof api, "viewingChecklist" | "submitViewing">;

const ANSWER_LABEL: Record<ViewingAnswer, string> = { yes: "是", no: "否", unknown: "不確定" };

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

  if (error && !checklist) return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>;
  if (!checklist) return <p className="text-gray-500">載入中…</p>;

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
      <h1 className="text-xl font-bold text-gray-900">看房健檢</h1>
      <p className="mt-1 text-sm text-gray-600">看房時邊看邊勾，最後會告訴你哪裡有紅燈、要問房東什麼。</p>
      <a href="/viewings" className="mt-2 inline-block text-sm text-emerald-700 underline">
        我的看房紀錄
      </a>

      <label className="mt-4 block text-sm font-medium text-gray-700" htmlFor="viewing-label">
        這間的名稱或地址（選填）
      </label>
      <input
        id="viewing-label"
        className="mt-1 w-full rounded-lg border border-gray-300 bg-white p-2"
        placeholder="例如：公館羅斯福路 5 樓套房"
        maxLength={60}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <p className="mt-1 text-xs text-gray-400">之後可以在「我的看房紀錄」比較不同租屋處。不填會自動用縣市＋房型＋日期命名。</p>

      <label className="mt-4 block text-sm font-medium text-gray-700" htmlFor="viewing-city">
        房子在哪個縣市
      </label>
      <select
        id="viewing-city"
        className="mt-1 w-full rounded-lg border border-gray-300 bg-white p-2"
        value={city}
        onChange={(e) => setCity(e.target.value)}
      >
        <option value="">其他／不確定</option>
        {ALL_CITIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-gray-700">房型</legend>
        <div className="mt-1 grid grid-cols-3 gap-2">
          {checklist.housingTypes.map((h) => (
            <button
              key={h.id}
              type="button"
              aria-pressed={housingType === h.id}
              onClick={() => setHousingType(h.id)}
              className={`rounded-lg border p-2 text-sm ${housingType === h.id ? "border-emerald-600 bg-emerald-50 font-semibold text-emerald-800" : "border-gray-300 bg-white text-gray-700"}`}
            >
              {h.label}
            </button>
          ))}
        </div>
      </fieldset>

      <ol className="mt-4 space-y-3">
        {checklist.items.map((it, i) => {
          const locked = preset[it.id];
          const value = locked ?? answers[it.id];
          return (
            <li key={it.id} className="rounded-lg bg-white p-3 shadow-sm">
              <p className="text-sm font-medium text-gray-900">
                {i + 1}. {it.question}
              </p>
              <details className="mt-1 text-xs text-gray-500">
                <summary>為什麼重要</summary>
                <p className="mt-1">{it.why}</p>
              </details>
              <div className="mt-2 flex gap-2" role="radiogroup" aria-label={it.question}>
                {(["yes", "no", "unknown"] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    role="radio"
                    aria-checked={value === a}
                    disabled={Boolean(locked)}
                    onClick={() => setAnswers((prev) => ({ ...prev, [it.id]: a }))}
                    className={`flex-1 rounded-md border py-1 text-sm ${value === a ? "border-emerald-600 bg-emerald-600 text-white" : "border-gray-300 bg-white text-gray-700"} disabled:opacity-70`}
                  >
                    {ANSWER_LABEL[a]}
                  </button>
                ))}
              </div>
              {locked && <p className="mt-1 text-xs text-gray-500">依你選的房型自動帶入</p>}
            </li>
          );
        })}
      </ol>

      <p className="mt-4 text-center text-xs text-gray-500">
        已回答 {answered}／{checklist.items.length} 題，沒回答的會當作「不確定」
      </p>
      <button
        type="button"
        onClick={submit}
        disabled={!housingType || submitting}
        className="mt-2 w-full rounded-lg bg-emerald-600 py-3 font-semibold text-white disabled:opacity-50"
      >
        {submitting ? "分析中…" : housingType ? "看結果" : "請先選房型"}
      </button>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </section>
  );
}

function scoreStyle(score: number): { label: string; className: string } {
  if (score >= 80) return { label: "大致安全", className: "text-emerald-700" };
  if (score >= 60) return { label: "有些地方要注意", className: "text-amber-600" };
  return { label: "紅燈很多，建議再考慮", className: "text-red-700" };
}

export function ViewingResultView({
  result,
  onRestart,
  restartLabel = "重新檢查",
}: {
  result: ViewingResult;
  onRestart: () => void;
  restartLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
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

  return (
    <section>
      <h1 className="text-xl font-bold text-gray-900">看房健檢結果</h1>
      <p className="mt-1 text-sm text-gray-600">{result.label}</p>

      <div className="mt-4 rounded-lg bg-white p-4 text-center shadow-sm">
        <p className="text-sm text-gray-500">安全分數</p>
        <p className={`text-5xl font-bold ${style.className}`} data-testid="viewing-score">
          {result.score}
        </p>
        <p className={`mt-1 text-sm font-semibold ${style.className}`}>{style.label}</p>
        <p className="mt-2 text-xs text-gray-400">分數只依你勾選的項目計算，不代表房子實際安全程度。</p>
      </div>

      {result.warning && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{result.warning}</p>}

      <h2 className="mt-6 text-lg font-bold text-gray-900">🚩 紅燈（{result.redFlags.length}）</h2>
      {result.redFlags.length === 0 ? (
        <p className="mt-2 text-sm text-gray-600">沒有紅燈。</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {result.redFlags.map((f) => (
            <li key={f.id} className="rounded-lg border-l-4 border-red-500 bg-white p-3 shadow-sm">
              <p className="text-sm font-medium text-gray-900">{f.question}</p>
              <p className="mt-1 text-xs text-gray-600">{f.why}</p>
              {f.citations.length > 0 && (
                <p className="mt-1 text-xs text-gray-500">
                  出處：
                  {f.citations.map((c, i) => (
                    <span key={`${c.lawName}${c.articleNo}`}>
                      {i > 0 && "、"}
                      {c.url ? (
                        <a className="text-emerald-700 underline" href={c.url} target="_blank" rel="noreferrer">
                          {c.lawName}第 {c.articleNo} 條
                        </a>
                      ) : (
                        `${c.lawName}第 ${c.articleNo} 條`
                      )}
                    </span>
                  ))}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-6 text-lg font-bold text-gray-900">🔥 住警器規定</h2>
      {fireRule.note && <p className="mt-2 text-sm text-gray-600">{fireRule.note}</p>}
      <div className="mt-2 space-y-2">
        {[...fireRule.local, ...(fireRule.national ? [fireRule.national] : [])].map((a) => (
          <details key={`${a.lawName}${a.articleNo}`} className="rounded-lg bg-white p-3 text-sm shadow-sm" open={fireRule.local.includes(a)}>
            <summary className="font-medium text-gray-900">
              {a.lawName} 第 {a.articleNo} 條
            </summary>
            <p className="mt-2 whitespace-pre-line text-gray-700">{a.text}</p>
            <a className="mt-1 inline-block text-xs text-emerald-700 underline" href={a.sourceUrl} target="_blank" rel="noreferrer">
              官方原文
            </a>
          </details>
        ))}
      </div>

      {result.questions.length > 0 && (
        <>
          <h2 className="mt-6 text-lg font-bold text-gray-900">💬 要問房東的問題</h2>
          <ol className="mt-2 list-decimal space-y-1 rounded-lg bg-white p-3 pl-8 text-sm text-gray-800 shadow-sm">
            {result.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
          <button type="button" onClick={copy} className="mt-2 w-full rounded-lg border border-emerald-600 py-2 font-semibold text-emerald-700">
            {copied ? "已複製，可以貼給房東" : "複製問題"}
          </button>
        </>
      )}

      <button type="button" onClick={onRestart} className="mt-4 w-full rounded-lg bg-gray-200 py-2 text-gray-700">
        {restartLabel}
      </button>
      <a href="/viewings" className="mt-2 block text-center text-sm text-emerald-700 underline">
        我的看房紀錄
      </a>
      <Disclaimer />
    </section>
  );
}
