import { useEffect, useState } from "react";
import {
  api,
  errorMessage,
  type LeaseResult,
  type LeaseSummary,
  type ViewingAnswer,
  type ViewingChecklist,
  type ViewingResult,
  type ViewingSummary,
} from "../api.ts";
import { Disclaimer } from "../components/Disclaimer.tsx";
import { BottomBar, Button, LinkButton } from "../components/ui.tsx";
import type { PageProps } from "../router.tsx";
import { LeaseResultView } from "./LeaseCheck.tsx";
import { ViewingResultView } from "./ViewingCheck.tsx";

type Client = Pick<typeof api, "viewingHistory" | "viewingDetail" | "viewingChecklist" | "deleteViewing" | "leaseDetail" | "deleteLease">;
type LeaseOnly = LeaseSummary & { label: string };

/** 一次最多比較幾間（與 functions/src/config.ts VIEWING.compareMax 一致） */
export const COMPARE_MAX = 3;

const ANSWER_LABEL: Record<ViewingAnswer, string> = { yes: "是", no: "否", unknown: "不確定" };

type View =
  | { kind: "list" }
  | { kind: "detail"; result: ViewingResult }
  | { kind: "compare"; results: ViewingResult[] }
  | { kind: "lease"; result: LeaseResult; id: string; from: ViewingResult | null };

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric" }).format(new Date(iso));
}

/** 租約紅黃燈小標籤 */
export function LeaseBadge({ lease }: { lease: LeaseSummary }) {
  return (
    <span className="mt-1 inline-flex items-center gap-2 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700">
      <span>📄 租約</span>
      {lease.red > 0 && (
        <span className="inline-flex items-center gap-1 font-semibold text-red-700" aria-label={`租約紅燈 ${lease.red}`}>
          <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
          {lease.red}
        </span>
      )}
      {lease.yellow > 0 && (
        <span className="inline-flex items-center gap-1 font-semibold text-amber-700" aria-label={`租約黃燈 ${lease.yellow}`}>
          <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden="true" />
          {lease.yellow}
        </span>
      )}
      {lease.red === 0 && lease.yellow === 0 && <span className="text-emerald-700">✓ 沒問題</span>}
    </span>
  );
}

const money = (n: number | null) => (n === null ? "未寫" : `${n.toLocaleString("zh-TW")} 元`);
const months = (n: number | null) => (n === null ? "未寫" : `${Math.round(n * 10) / 10} 個月`);

function scoreColor(score: number): string {
  if (score >= 80) return "text-emerald-700";
  if (score >= 60) return "text-amber-600";
  return "text-red-700";
}

/** 我的看房紀錄：列表、單筆結果、2–3 間並排比較（SPEC 7） */
export function ViewingHistory({ client = api }: PageProps & { client?: Client }) {
  const [list, setList] = useState<ViewingSummary[] | null>(null);
  const [leaseOnly, setLeaseOnly] = useState<LeaseOnly[]>([]);
  const [checklist, setChecklist] = useState<ViewingChecklist | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [view, setView] = useState<View>({ kind: "list" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([client.viewingHistory(), client.viewingChecklist()]).then(
      ([h, c]) => {
        setList(h.viewings);
        setLeaseOnly(h.leaseOnly ?? []);
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

  async function openLease(id: string, from: ViewingResult | null) {
    setLoading(true);
    setError(null);
    try {
      setView({ kind: "lease", result: await client.leaseDetail(id), id, from });
      window.scrollTo?.(0, 0);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function removeLease(id: string) {
    await client.deleteLease(id);
    setLeaseOnly((prev) => prev.filter((l) => l.id !== id));
    // 這間的租約被刪掉，列表的標籤也要拿掉（之後重新整理會帶出較舊的那份，如果有）
    setList((prev) => prev?.map((v) => (v.lease?.id === id ? { ...v, lease: null } : v)) ?? prev);
    setView({ kind: "list" });
  }

  async function remove(id: string) {
    await client.deleteViewing(id);
    setList((prev) => prev?.filter((v) => v.id !== id) ?? prev);
    setSelected((prev) => prev.filter((x) => x !== id));
    setView({ kind: "list" });
  }

  if (error && !list) return <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  if (!list || !checklist) return <p className="py-8 text-center text-gray-500">載入中…</p>;
  if (view.kind === "detail") {
    const r = view.result;
    return (
      <ViewingResultView
        result={r}
        onRestart={back}
        restartLabel="回到看房紀錄"
        onDelete={() => remove(r.id)}
        extra={<LeaseSection viewing={r} loading={loading} error={error} onOpen={(id) => openLease(id, r)} />}
      />
    );
  }
  if (view.kind === "lease") {
    const { from, id } = view;
    return (
      <LeaseResultView
        result={view.result}
        onRestart={() => (from ? setView({ kind: "detail", result: from }) : back())}
        restartLabel={from ? `回到「${from.label}」` : "回到看房紀錄"}
        onDelete={async () => {
          await removeLease(id);
          if (from) setView({ kind: "detail", result: { ...from, lease: null } });
        }}
      />
    );
  }
  if (view.kind === "compare") return <CompareView results={view.results} checklist={checklist} onBack={back} />;

  const housingLabel = (id: string) => checklist.housingTypes.find((h) => h.id === id)?.label ?? id;

  return (
    <section>
      <h1 className="text-2xl font-bold text-gray-900">我的看房紀錄</h1>
      {list.length === 0 && leaseOnly.length === 0 ? (
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
                      {v.lease && <LeaseBadge lease={v.lease} />}
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
          {leaseOnly.length > 0 && (
            <>
              <h2 className="mt-6 text-lg font-bold text-gray-900">📄 只有租約</h2>
              <p className="mt-1 text-sm text-gray-600">沒有對應看房紀錄的租約健檢。</p>
              <ul className="mt-3 space-y-3">
                {leaseOnly.map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      className="flex min-h-16 w-full items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-sm active:bg-gray-50"
                      onClick={() => openLease(l.id, null)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-gray-900">{l.label}</span>
                        <span className="block text-xs text-gray-500">
                          {[`月租 ${money(l.monthlyRent)}`, formatDate(l.createdAt)].filter(Boolean).join("・")}
                        </span>
                        <LeaseBadge lease={l} />
                      </span>
                      <span className="text-xl text-gray-300" aria-hidden="true">
                        ›
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <LinkButton href="/viewing" variant="secondary">
              ＋ 看房健檢
            </LinkButton>
            <LinkButton href="/lease" variant="secondary">
              ＋ 租約健檢
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

      <h2 className="mt-4 text-lg font-bold text-gray-900">💰 租金與租約</h2>
      <ul className="mt-2 space-y-3">
        {(
          [
            ["月租金", (r: ViewingResult) => (r.lease ? money(r.lease.monthlyRent) : "—")],
            ["押金", (r: ViewingResult) => (r.lease ? months(r.lease.depositMonths) : "—")],
            ["租約紅燈", (r: ViewingResult) => (r.lease ? String(r.lease.red) : "—")],
          ] as const
        ).map(([title, value]) => (
          <li key={title} className="rounded-2xl bg-white p-4 shadow-sm" aria-label={title}>
            <p className="text-sm font-medium text-gray-900">{title}</p>
            <div className={`mt-2 grid ${cols} gap-2`}>
              {results.map((r) => {
                const bad = (title === "租約紅燈" && (r.lease?.red ?? 0) > 0) || (title === "押金" && (r.lease?.depositMonths ?? 0) > 2);
                return (
                  <div
                    key={r.id}
                    className={`flex min-h-10 items-center justify-center rounded-xl text-sm ${bad ? "bg-red-50 font-semibold text-red-700" : r.lease ? "bg-gray-50 text-gray-800" : "bg-gray-50 text-gray-400"}`}
                  >
                    {value(r)}
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
      {results.some((r) => !r.lease) && <p className="mt-2 text-xs text-gray-400">「—」表示這間還沒做租約健檢。</p>}

      <h2 className="mt-6 text-lg font-bold text-gray-900">🔍 看房清單</h2>
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

/** 單筆看房紀錄裡的租約健檢區塊 */
function LeaseSection({
  viewing,
  loading,
  error,
  onOpen,
}: {
  viewing: ViewingResult;
  loading: boolean;
  error: string | null;
  onOpen: (leaseId: string) => void;
}) {
  const lease = viewing.lease;
  return (
    <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
      <p className="font-bold text-gray-900">📄 這間的租約健檢</p>
      {lease ? (
        <>
          <div className="mt-2 flex items-center gap-2">
            <LeaseBadge lease={lease} />
            <span className="text-xs text-gray-500">{formatDate(lease.createdAt)}</span>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-1 text-sm">
            <dt className="text-gray-500">月租金</dt>
            <dd className="text-right text-gray-900">{money(lease.monthlyRent)}</dd>
            <dt className="text-gray-500">押金</dt>
            <dd className="text-right text-gray-900">{months(lease.depositMonths)}</dd>
          </dl>
          <Button variant="secondary" className="mt-3" disabled={loading} onClick={() => onOpen(lease.id)}>
            {loading ? "載入中…" : "看租約健檢結果"}
          </Button>
          {error && <p className="mt-2 text-center text-sm text-red-700">{error}</p>}
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-gray-600">還沒檢查這間的租約。拿到租約後拍下來，幫你找出押金、電費、稅金等問題。</p>
          <LinkButton href={`/lease?viewing=${encodeURIComponent(viewing.id)}`} variant="primary" className="mt-3">
            幫這間做租約健檢
          </LinkButton>
        </>
      )}
    </div>
  );
}
