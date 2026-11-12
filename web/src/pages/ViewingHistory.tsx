import { useEffect, useState } from "react";
import { api, errorMessage, type ViewingAnswer, type ViewingChecklist, type ViewingResult, type ViewingSummary } from "../api.ts";
import { Disclaimer } from "../components/Disclaimer.tsx";
import { BottomBar, Button, LinkButton } from "../components/ui.tsx";
import type { PageProps } from "../router.tsx";
import { ViewingResultView } from "./ViewingCheck.tsx";

type Client = Pick<typeof api, "viewingHistory" | "viewingDetail" | "viewingChecklist" | "deleteViewing">;

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

  async function remove(id: string) {
    await client.deleteViewing(id);
    setList((prev) => prev?.filter((v) => v.id !== id) ?? prev);
    setSelected((prev) => prev.filter((x) => x !== id));
    setView({ kind: "list" });
  }

  if (error && !list) return <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  if (!list || !checklist) return <p className="py-8 text-center text-gray-500">載入中…</p>;
  if (view.kind === "detail") {
    const id = view.result.id;
    return <ViewingResultView result={view.result} onRestart={back} restartLabel="回到看房紀錄" onDelete={() => remove(id)} />;
  }
  if (view.kind === "compare") return <CompareView results={view.results} checklist={checklist} onBack={back} />;

  const housingLabel = (id: string) => checklist.housingTypes.find((h) => h.id === id)?.label ?? id;

  return (
    <section>
      <h1 className="text-2xl font-bold text-gray-900">我的看房紀錄</h1>
      {list.length === 0 ? (
        <div className="mt-4 rounded-2xl bg-white p-5 text-center shadow-sm">
          <p className="text-4xl" aria-hidden="true">
            🏠
          </p>
          <p className="mt-2 text-gray-600">還沒有紀錄。看房時做一次健檢，就會存在這裡。</p>
          <LinkButton href="/viewing" variant="primary" className="mt-4">
            去做看房健檢
          </LinkButton>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-gray-600">點一間看當時的結果或刪除；勾選 2–{COMPARE_MAX} 間可以並排比較。</p>
          <ul className="mt-4 space-y-3">
            {list.map((v) => {
              const checked = selected.includes(v.id);
              const full = !checked && selected.length >= COMPARE_MAX;
              return (
                <li key={v.id} className={`flex items-stretch overflow-hidden rounded-2xl bg-white shadow-sm ${checked ? "ring-2 ring-emerald-600" : ""}`}>
                  <label className={`flex w-14 shrink-0 items-center justify-center border-r border-gray-100 ${full ? "opacity-40" : "active:bg-gray-50"}`}>
                    <input
                      type="checkbox"
                      className="h-6 w-6 accent-emerald-600"
                      aria-label={`比較 ${v.label}`}
                      checked={checked}
                      disabled={full}
                      onChange={() => toggle(v.id)}
                    />
                  </label>
                  <button type="button" className="flex min-h-16 min-w-0 flex-1 items-center gap-3 p-4 text-left active:bg-gray-50" onClick={() => open([v.id])}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-gray-900">{v.label}</span>
                      <span className="block text-xs text-gray-500">
                        {[v.city, housingLabel(v.housingType), formatDate(v.createdAt)].filter(Boolean).join("・")}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className={`block text-2xl font-bold ${scoreColor(v.score)}`}>{v.score}</span>
                      <span className="block text-xs text-gray-500">紅燈 {v.redFlagCount}</span>
                    </span>
                    <span className="text-xl text-gray-300" aria-hidden="true">
                      ›
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-4">
            <LinkButton href="/viewing" variant="secondary">
              ＋ 新增一間看房健檢
            </LinkButton>
          </div>
          <BottomBar>
            <Button onClick={() => open(selected)} disabled={selected.length < 2 || loading}>
              {loading ? "載入中…" : selected.length < 2 ? "勾選 2 間以上來比較" : `比較 ${selected.length} 間`}
            </Button>
            {error && <p className="mt-2 text-center text-sm text-red-700">{error}</p>}
          </BottomBar>
        </>
      )}
      {error && list.length === 0 && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </section>
  );
}

export function CompareView({ results, checklist, onBack }: { results: ViewingResult[]; checklist: ViewingChecklist; onBack: () => void }) {
  const [onlyDiff, setOnlyDiff] = useState(true);
  const rows = checklist.items.filter((it) => !onlyDiff || new Set(results.map((r) => r.answers[it.id] ?? "unknown")).size > 1);
  const best = Math.max(...results.map((r) => r.score));
  const cols = results.length === 3 ? "grid-cols-3" : "grid-cols-2";

  return (
    <section>
      <h1 className="text-2xl font-bold text-gray-900">比較租屋處</h1>

      <div className={`sticky top-0 z-10 -mx-4 mt-3 grid ${cols} gap-2 bg-gray-50/95 px-4 py-2 backdrop-blur`}>
        {results.map((r) => (
          <div key={r.id} className={`rounded-2xl bg-white p-3 text-center shadow-sm ${r.score === best && results.length > 1 ? "ring-2 ring-emerald-600" : ""}`}>
            <p className="line-clamp-2 min-h-8 text-xs font-semibold text-gray-900">{r.label}</p>
            <p className={`mt-1 text-3xl font-bold ${scoreColor(r.score)}`} data-testid="compare-score">
              {r.score}
            </p>
            <p className="text-xs text-gray-500">紅燈 {r.redFlags.length}</p>
            {r.score === best && results.length > 1 && <p className="mt-1 text-xs font-semibold text-emerald-700">最高</p>}
          </div>
        ))}
      </div>

      <label className="mt-3 flex min-h-11 items-center gap-3 rounded-xl bg-white px-4 text-sm text-gray-700 shadow-sm">
        <input type="checkbox" className="h-5 w-5 accent-emerald-600" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
        只看回答不同的題目
      </label>

      {rows.length === 0 && onlyDiff && <p className="mt-3 rounded-2xl bg-white p-4 text-sm text-gray-600 shadow-sm">每一題的回答都一樣。</p>}
      <ul className="mt-3 space-y-3">
        {rows.map((it) => (
          <li key={it.id} className="rounded-2xl bg-white p-4 shadow-sm" aria-label={it.question}>
            <p className="text-sm font-medium text-gray-900">{it.question}</p>
            <div className={`mt-2 grid ${cols} gap-2`}>
              {results.map((r) => {
                const a = r.answers[it.id] ?? "unknown";
                const red = r.redFlags.some((f) => f.id === it.id);
                return (
                  <div
                    key={r.id}
                    className={`flex min-h-10 items-center justify-center rounded-xl text-sm ${red ? "bg-red-50 font-semibold text-red-700" : a === "unknown" ? "bg-gray-50 text-gray-400" : "bg-emerald-50 text-emerald-800"}`}
                  >
                    {red ? "🚩 " : ""}
                    {ANSWER_LABEL[a]}
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-gray-400">分數只依勾選的項目計算，不代表房子實際安全程度。</p>
      <Button variant="ghost" className="mt-4" onClick={onBack}>
        回到看房紀錄
      </Button>
      <Disclaimer />
    </section>
  );
}
