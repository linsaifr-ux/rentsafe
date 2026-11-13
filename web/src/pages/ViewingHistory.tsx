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
import {
  ArrowLeft,
  Check,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Crown,
  FileSearch,
  FileText,
  Flag,
  GitCompareArrows,
  House,
  Plus,
  Wallet,
} from "lucide-react";
import {
  BottomBar,
  Button,
  Card,
  EmptyState,
  ErrorText,
  IconBadge,
  LinkButton,
  Notice,
  PageHeader,
  PageSkeleton,
  ScoreRing,
  SectionTitle,
} from "../components/ui.tsx";
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
    <span className="mt-1.5 inline-flex items-center gap-2 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
      <span className="inline-flex items-center gap-1">
        <FileText className="size-3.5 text-slate-500" aria-hidden="true" />
        租約
      </span>
      {lease.red > 0 && (
        <span className="inline-flex items-center gap-1 font-semibold text-red-700" aria-label={`租約紅燈 ${lease.red}`}>
          <span className="size-2 rounded-full bg-red-500" aria-hidden="true" />
          {lease.red}
        </span>
      )}
      {lease.yellow > 0 && (
        <span className="inline-flex items-center gap-1 font-semibold text-amber-700" aria-label={`租約黃燈 ${lease.yellow}`}>
          <span className="size-2 rounded-full bg-amber-400" aria-hidden="true" />
          {lease.yellow}
        </span>
      )}
      {lease.red === 0 && lease.yellow === 0 && (
        <span className="inline-flex items-center gap-0.5 font-semibold text-emerald-700">
          <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
          沒問題
        </span>
      )}
    </span>
  );
}

const money = (n: number | null) => (n === null ? "未寫" : `${n.toLocaleString("zh-TW")} 元`);
const months = (n: number | null) => (n === null ? "未寫" : `${Math.round(n * 10) / 10} 個月`);

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

  if (error && !list) {
    return (
      <section>
        <PageHeader title="我的看房紀錄" />
        <Notice tone="red" className="mt-0">
          {error}
        </Notice>
      </section>
    );
  }
  if (!list || !checklist) return <PageSkeleton />;
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
    <section className="animate-enter">
      <PageHeader title="我的看房紀錄" />
      {list.length === 0 && leaseOnly.length === 0 ? (
        <EmptyState icon={House} tone="violet" title="還沒有紀錄" desc="看房時做一次健檢，就會存在這裡。">
          <LinkButton href="/viewing" variant="primary" icon={ClipboardCheck}>
            去做看房健檢
          </LinkButton>
        </EmptyState>
      ) : (
        <>
          <p className="px-1 text-sm leading-relaxed text-slate-600">點一間看當時的結果；左邊圈起 2–{COMPARE_MAX} 間可以並排比較。</p>
          <ul className="stagger mt-4 space-y-3">
            {list.map((v) => {
              const checked = selected.includes(v.id);
              const full = !checked && selected.length >= COMPARE_MAX;
              return (
                <li
                  key={v.id}
                  className={`flex items-stretch overflow-hidden rounded-3xl bg-white shadow-card ring-2 transition duration-200 ${checked ? "ring-emerald-500" : "ring-transparent"}`}
                >
                  <label className={`flex w-14 shrink-0 cursor-pointer items-center justify-center ${full ? "opacity-30" : "active:bg-slate-50"}`}>
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      aria-label={`比較 ${v.label}`}
                      checked={checked}
                      disabled={full}
                      onChange={() => toggle(v.id)}
                    />
                    <span
                      className="flex size-6 items-center justify-center rounded-full border-2 border-slate-300 transition duration-200 peer-checked:border-emerald-500 peer-checked:bg-emerald-500 peer-focus-visible:ring-4 peer-focus-visible:ring-emerald-500/20"
                      aria-hidden="true"
                    >
                      {checked && <Check className="size-4 animate-pop text-white" strokeWidth={3} />}
                    </span>
                  </label>
                  <button type="button" className="flex min-h-20 min-w-0 flex-1 items-center gap-3 py-3 pr-3 text-left transition active:bg-slate-50" onClick={() => open([v.id])}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-slate-900">{v.label}</span>
                      <span className="block text-xs text-slate-500">
                        {[v.city, housingLabel(v.housingType), formatDate(v.createdAt)].filter(Boolean).join("・")}
                      </span>
                      {v.lease && <LeaseBadge lease={v.lease} />}
                    </span>
                    <span className="flex flex-col items-center">
                      <ScoreRing score={v.score} size={48} stroke={5} small />
                      <span className="mt-0.5 text-[11px] text-slate-500">紅燈 {v.redFlagCount}</span>
                    </span>
                    <ChevronRight className="size-5 shrink-0 text-slate-300" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
          {leaseOnly.length > 0 && (
            <>
              <SectionTitle icon={FileText} tone="sky" count={leaseOnly.length}>
                只有租約
              </SectionTitle>
              <p className="mt-1 px-1 text-sm text-slate-500">沒有對應看房紀錄的租約健檢。</p>
              <ul className="stagger mt-3 space-y-3">
                {leaseOnly.map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      className="flex min-h-16 w-full items-center gap-3 rounded-3xl bg-white p-4 text-left shadow-card transition active:scale-[0.98] active:bg-slate-50"
                      onClick={() => openLease(l.id, null)}
                    >
                      <IconBadge icon={FileSearch} tone="sky" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-slate-900">{l.label}</span>
                        <span className="block text-xs text-slate-500">
                          {[`月租 ${money(l.monthlyRent)}`, formatDate(l.createdAt)].filter(Boolean).join("・")}
                        </span>
                        <LeaseBadge lease={l} />
                      </span>
                      <ChevronRight className="size-5 shrink-0 text-slate-300" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="mt-6 grid grid-cols-2 gap-3">
            <LinkButton href="/viewing" variant="secondary" icon={Plus}>
              看房健檢
            </LinkButton>
            <LinkButton href="/lease" variant="secondary" icon={Plus}>
              租約健檢
            </LinkButton>
          </div>
          <BottomBar>
            <Button onClick={() => open(selected)} disabled={selected.length < 2 || loading} icon={selected.length >= 2 && !loading ? GitCompareArrows : undefined}>
              {loading ? "載入中…" : selected.length < 2 ? "勾選 2 間以上來比較" : `比較 ${selected.length} 間`}
            </Button>
            {error && <ErrorText>{error}</ErrorText>}
          </BottomBar>
        </>
      )}
      {error && list.length === 0 && <ErrorText>{error}</ErrorText>}
    </section>
  );
}

export function CompareView({ results, checklist, onBack }: { results: ViewingResult[]; checklist: ViewingChecklist; onBack: () => void }) {
  const [onlyDiff, setOnlyDiff] = useState(true);
  const rows = checklist.items.filter((it) => !onlyDiff || new Set(results.map((r) => r.answers[it.id] ?? "unknown")).size > 1);
  const best = Math.max(...results.map((r) => r.score));
  const cols = results.length === 3 ? "grid-cols-3" : "grid-cols-2";

  const cell = "flex min-h-11 items-center justify-center gap-1 rounded-2xl text-sm transition";
  return (
    <section className="animate-enter">
      <PageHeader title="比較租屋處" back={onBack} />

      <div className={`sticky top-14 z-20 -mx-4 grid ${cols} gap-2 bg-slate-50/85 px-4 pt-1 pb-3 backdrop-blur-xl`}>
        {results.map((r) => {
          const top = r.score === best && results.length > 1;
          return (
            <div key={r.id} className={`relative flex flex-col items-center rounded-3xl bg-white p-3 text-center shadow-card ring-2 ${top ? "ring-emerald-500" : "ring-transparent"}`}>
              {top && (
                <span className="absolute -top-2.5 inline-flex animate-pop items-center gap-0.5 rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-bold text-white shadow-brand">
                  <Crown className="size-3" aria-hidden="true" />
                  最高
                </span>
              )}
              <p className="line-clamp-2 min-h-8 text-xs font-semibold text-slate-900">{r.label}</p>
              <span className="mt-1">
                <ScoreRing score={r.score} size={64} stroke={6} small testId="compare-score" />
              </span>
              <p className="mt-1 text-xs text-slate-500">紅燈 {r.redFlags.length}</p>
            </div>
          );
        })}
      </div>

      <SectionTitle icon={Wallet} tone="amber" className="mt-4">
        租金與租約
      </SectionTitle>
      <ul className="stagger mt-3 space-y-3">
        {(
          [
            ["月租金", (r: ViewingResult) => (r.lease ? money(r.lease.monthlyRent) : "—")],
            ["押金", (r: ViewingResult) => (r.lease ? months(r.lease.depositMonths) : "—")],
            ["租約紅燈", (r: ViewingResult) => (r.lease ? String(r.lease.red) : "—")],
          ] as const
        ).map(([title, value]) => (
          <li key={title} className="rounded-3xl bg-white p-4 shadow-card" aria-label={title}>
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            <div className={`mt-2 grid ${cols} gap-2`}>
              {results.map((r) => {
                const bad = (title === "租約紅燈" && (r.lease?.red ?? 0) > 0) || (title === "押金" && (r.lease?.depositMonths ?? 0) > 2);
                return (
                  <div key={r.id} className={`${cell} ${bad ? "bg-red-50 font-semibold text-red-700" : r.lease ? "bg-slate-50 text-slate-800" : "bg-slate-50 text-slate-300"}`}>
                    {value(r)}
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
      {results.some((r) => !r.lease) && <p className="mt-2 px-1 text-xs text-slate-400">「—」表示這間還沒做租約健檢。</p>}

      <SectionTitle icon={ClipboardList} tone="emerald">
        看房清單
      </SectionTitle>
      <label className="mt-3 flex min-h-13 cursor-pointer items-center gap-3 rounded-3xl bg-white px-4 text-sm font-medium text-slate-700 shadow-card">
        <span className="flex-1">只看回答不同的題目</span>
        <input type="checkbox" className="peer sr-only" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
        <span
          className="relative h-7 w-12 rounded-full bg-slate-200 transition-colors duration-200 peer-checked:bg-emerald-500 peer-focus-visible:ring-4 peer-focus-visible:ring-emerald-500/20 after:absolute after:top-0.5 after:left-0.5 after:size-6 after:rounded-full after:bg-white after:shadow after:transition-transform after:duration-200 peer-checked:after:translate-x-5"
          aria-hidden="true"
        />
      </label>

      {rows.length === 0 && onlyDiff && (
        <Notice tone="emerald" icon={Check}>
          每一題的回答都一樣。
        </Notice>
      )}
      <ul className="mt-3 space-y-3">
        {rows.map((it) => (
          <li key={it.id} className="animate-enter rounded-3xl bg-white p-4 shadow-card" aria-label={it.question}>
            <p className="text-sm font-medium text-slate-900">{it.question}</p>
            <div className={`mt-2 grid ${cols} gap-2`}>
              {results.map((r) => {
                const a = r.answers[it.id] ?? "unknown";
                const red = r.redFlags.some((f) => f.id === it.id);
                return (
                  <div
                    key={r.id}
                    className={`${cell} ${red ? "bg-red-50 font-semibold text-red-700" : a === "unknown" ? "bg-slate-50 text-slate-400" : "bg-emerald-50 text-emerald-800"}`}
                  >
                    {red && <Flag className="size-3.5" aria-label="紅燈" />}
                    {ANSWER_LABEL[a]}
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-3 px-1 text-xs text-slate-400">分數只依勾選的項目計算，不代表房子實際安全程度。</p>
      <Button variant="ghost" className="mt-6" onClick={onBack} icon={ArrowLeft}>
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
    <Card className="mt-3">
      <div className="flex items-center gap-3">
        <IconBadge icon={FileSearch} tone="sky" />
        <p className="flex-1 font-bold text-slate-900">這間的租約健檢</p>
        {lease && <span className="text-xs text-slate-400">{formatDate(lease.createdAt)}</span>}
      </div>
      {lease ? (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Stat label="紅燈" value={String(lease.red)} tone={lease.red ? "red" : "slate"} />
            <Stat label="月租金" value={lease.monthlyRent === null ? "未寫" : lease.monthlyRent.toLocaleString("zh-TW")} tone="slate" />
            <Stat label="押金" value={months(lease.depositMonths)} tone={(lease.depositMonths ?? 0) > 2 ? "red" : "slate"} />
          </div>
          <Button variant="secondary" className="mt-3" disabled={loading} onClick={() => onOpen(lease.id)} icon={loading ? undefined : ChevronRight}>
            {loading ? "載入中…" : "看租約健檢結果"}
          </Button>
          {error && <ErrorText>{error}</ErrorText>}
        </>
      ) : (
        <>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">還沒檢查這間的租約。拿到租約後拍下來，幫你找出押金、電費、稅金等問題。</p>
          <LinkButton href={`/lease?viewing=${encodeURIComponent(viewing.id)}`} variant="primary" className="mt-3" icon={FileSearch}>
            幫這間做租約健檢
          </LinkButton>
        </>
      )}
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "red" | "slate" }) {
  return (
    <div className={`rounded-2xl px-2 py-2.5 ${tone === "red" ? "bg-red-50" : "bg-slate-50"}`}>
      <p className={`text-base font-bold tabular-nums ${tone === "red" ? "text-red-700" : "text-slate-900"}`}>{value}</p>
      <p className={`text-[11px] ${tone === "red" ? "text-red-600" : "text-slate-500"}`}>{label}</p>
    </div>
  );
}
