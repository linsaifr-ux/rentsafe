import { useEffect, useState } from "react";
import { api, errorMessage, type ViewingAnswer, type ViewingChecklist, type ViewingResult, type ViewingSummary } from "../api.ts";
import { Disclaimer } from "../components/Disclaimer.tsx";
import type { PageProps } from "../router.tsx";
import { ViewingResultView } from "./ViewingCheck.tsx";

type Client = Pick<typeof api, "viewingHistory" | "viewingDetail" | "viewingChecklist">;

/** 一次最多比較幾間（與 functions/src/config.ts VIEWING.compareMax 一致） */
export const COMPARE_MAX = 3;

const ANSWER_LABEL: Record<ViewingAnswer, string> = { yes: "是", no: "否", unknown: "不確定" };

type View = { kind: "list" } | { kind: "detail"; result: ViewingResult } | { kind: "compare"; results: ViewingResult[] };

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric" }).format(new Date(iso));
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-emerald-700";
  if (score >= 60) return "text-amber-600";
  return "text-red-700";
}

/** 我的看房紀錄：列表、單筆結果、2–3 間並排比較（SPEC 7） */
export function ViewingHistory({ client = api }: PageProps & { client?: Client }) {
  const [list, setList] = useState<ViewingSummary[] | null>(null);
  const [checklist, setChecklist] = useState<ViewingChecklist | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [view, setView] = useState<View>({ kind: "list" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([client.viewingHistory(), client.viewingChecklist()]).then(
      ([h, c]) => {
        setList(h.viewings);
        setChecklist(c);
      },
      (err: unknown) => setError(errorMessage(err)),
    );
  }, [client]);

  async function open(ids: string[]) {
    setLoading(true);
    setError(null);
    try {
      const { viewings } = await client.viewingDetail(ids);
      setView(ids.length === 1 ? { kind: "detail", result: viewings[0]! } : { kind: "compare", results: viewings });
      window.scrollTo?.(0, 0);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < COMPARE_MAX ? [...prev, id] : prev));
  }

  const back = () => setView({ kind: "list" });

  if (error && !list) return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>;
  if (!list || !checklist) return <p className="text-gray-500">載入中…</p>;
  if (view.kind === "detail") return <ViewingResultView result={view.result} onRestart={back} restartLabel="回到看房紀錄" />;
  if (view.kind === "compare") return <CompareView results={view.results} checklist={checklist} onBack={back} />;

  const housingLabel = (id: string) => checklist.housingTypes.find((h) => h.id === id)?.label ?? id;

  return (
    <section>
      <h1 className="text-xl font-bold text-gray-900">我的看房紀錄</h1>
      {list.length === 0 ? (
        <div className="mt-4 rounded-lg bg-white p-4 text-sm text-gray-600 shadow-sm">
          還沒有紀錄。
          <a href="/viewing" className="ml-1 text-emerald-700 underline">
            去做看房健檢
          </a>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-gray-600">點名稱看當時的結果；勾選 2–{COMPARE_MAX} 間可以並排比較。</p>
          <ul className="mt-3 space-y-2">
            {list.map((v) => {
              const checked = selected.includes(v.id);
              const full = !checked && selected.length >= COMPARE_MAX;
              return (
                <li key={v.id} className="flex items-center gap-3 rounded-lg bg-white p-3 shadow-sm">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-emerald-600"
                    aria-label={`比較 ${v.label}`}
                    checked={checked}
                    disabled={full}
                    onChange={() => toggle(v.id)}
                  />
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => open([v.id])}>
                    <p className="truncate text-sm font-medium text-gray-900">{v.label}</p>
                    <p className="text-xs text-gray-500">
                      {[v.city, housingLabel(v.housingType), formatDate(v.createdAt)].filter(Boolean).join("・")}
                    </p>
                  </button>
                  <div className="text-right">
                    <p className={`text-xl font-bold ${scoreColor(v.score)}`}>{v.score}</p>
                    <p className="text-xs text-gray-500">紅燈 {v.redFlagCount}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => open(selected)}
            disabled={selected.length < 2 || loading}
            className="mt-4 w-full rounded-lg bg-emerald-600 py-3 font-semibold text-white disabled:opacity-50"
          >
            {loading ? "載入中…" : selected.length < 2 ? "勾選 2 間以上來比較" : `比較 ${selected.length} 間`}
          </button>
        </>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <a href="/viewing" className="mt-4 block text-center text-sm text-emerald-700 underline">
        新增一間看房健檢
      </a>
    </section>
  );
}

export function CompareView({ results, checklist, onBack }: { results: ViewingResult[]; checklist: ViewingChecklist; onBack: () => void }) {
  const [onlyDiff, setOnlyDiff] = useState(true);
  const rows = checklist.items.filter((it) => !onlyDiff || new Set(results.map((r) => r.answers[it.id] ?? "unknown")).size > 1);
  const best = Math.max(...results.map((r) => r.score));

  return (
    <section>
      <h1 className="text-xl font-bold text-gray-900">比較租屋處</h1>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full table-fixed border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              <th className="w-2/5" />
              {results.map((r) => (
                <th key={r.id} scope="col" className="rounded-md bg-white p-2 align-top text-xs font-semibold text-gray-900 shadow-sm">
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className="text-left text-xs text-gray-600">
                安全分數
              </th>
              {results.map((r) => (
                <td key={r.id} className={`text-center text-2xl font-bold ${scoreColor(r.score)}`}>
                  {r.score}
                  {r.score === best && results.length > 1 && <span className="block text-xs font-normal text-emerald-700">最高</span>}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className="text-left text-xs text-gray-600">
                紅燈數
              </th>
              {results.map((r) => (
                <td key={r.id} className="text-center font-semibold text-gray-800">
                  {r.redFlags.length}
                </td>
              ))}
            </tr>
            {rows.map((it) => (
              <tr key={it.id}>
                <th scope="row" className="text-left text-xs font-normal text-gray-700">
                  {it.question}
                </th>
                {results.map((r) => {
                  const a = r.answers[it.id] ?? "unknown";
                  const red = r.redFlags.some((f) => f.id === it.id);
                  return (
                    <td
                      key={r.id}
                      data-red={red || undefined}
                      className={`rounded-md p-1 text-center text-xs ${red ? "bg-red-50 font-semibold text-red-700" : a === "unknown" ? "text-gray-400" : "text-gray-700"}`}
                    >
                      {red ? "🚩 " : ""}
                      {ANSWER_LABEL[a]}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && onlyDiff && <p className="mt-2 text-sm text-gray-600">每一題的回答都一樣。</p>}
      <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" className="accent-emerald-600" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
        只看回答不同的題目
      </label>
      <p className="mt-2 text-xs text-gray-400">分數只依勾選的項目計算，不代表房子實際安全程度。</p>
      <button type="button" onClick={onBack} className="mt-4 w-full rounded-lg bg-gray-200 py-2 text-gray-700">
        回到看房紀錄
      </button>
      <Disclaimer />
    </section>
  );
}
