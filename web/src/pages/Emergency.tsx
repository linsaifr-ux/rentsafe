import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Building2,
  Check,
  ChevronRight,
  ClipboardList,
  DoorOpen,
  Droplets,
  ExternalLink,
  FileText,
  Flame,
  Images,
  MessageCircleQuestion,
  Pencil,
  Phone,
  Plus,
  Siren,
  Trash2,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { PageProps } from "../router.tsx";
import {
  caseApi,
  errorMessage,
  type CaseAnswers,
  type CaseBrief,
  type CaseClient,
  type CaseDetail,
  type CaseScenario,
  type CaseStage,
  type EvidenceItem,
  type Flow,
  type FlowItem,
  type LandlordType,
} from "../api.ts";
import { askInChat } from "../liff.ts";
import { ALL_CITIES } from "../cities.ts";
import { Disclaimer } from "../components/Disclaimer.tsx";
import {
  BottomBar,
  Button,
  Card,
  ConfirmSheet,
  CopyButton,
  Disclosure,
  EmptyState,
  ErrorText,
  IconBadge,
  LinkButton,
  Notice,
  PageHeader,
  PageSkeleton,
  SectionTitle,
  Sheet,
  SourceChip,
  TONE,
  type Tone,
} from "../components/ui.tsx";
import { FIELD, FIELD_LABEL } from "./ViewingCheck.tsx";

export const SCENARIO_META: Record<CaseScenario, { icon: LucideIcon; tone: Tone; desc: string }> = {
  fire: { icon: Flame, tone: "rose", desc: "失火、燒毀、濃煙" },
  leak: { icon: Droplets, tone: "sky", desc: "漏水、壁癌、淹水" },
  no_repair: { icon: Wrench, tone: "amber", desc: "東西壞了房東不修" },
  deposit: { icon: Wallet, tone: "emerald", desc: "退租後押金不退" },
  early_termination: { icon: DoorOpen, tone: "violet", desc: "想提前搬走" },
};

const ORDER: CaseScenario[] = ["fire", "leak", "no_repair", "deposit", "early_termination"];
const STAGES: CaseStage[] = ["now", "today", "week", "next"];
const STAGE_LABEL: Record<CaseStage, string> = { now: "現在", today: "今天", week: "本週", next: "下一步" };
const LANDLORD: Array<{ id: LandlordType; label: string }> = [
  { id: "individual", label: "個人房東" },
  { id: "business", label: "業者" },
  { id: "unknown", label: "不確定" },
];

const stepKey = (stage: CaseStage, id: string) => `${stage}.${id}`;
const dateLabel = (iso: string) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric" }).format(new Date(iso));

/** 網址上的案件 ID（從案件摘要返回時用） */
function idFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("id");
}

/** F4 情境急救包（SPEC 10）：選情境 → 四段可勾選清單 → 案件摘要 */
export function Emergency({
  client = caseApi,
  ask = askInChat,
  initialId = idFromUrl(),
}: PageProps & { client?: CaseClient; ask?: (text: string) => Promise<boolean>; initialId?: string | null }) {
  const [flows, setFlows] = useState<Flow[] | null>(null);
  const [cases, setCases] = useState<CaseBrief[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialId);
  const [busy, setBusy] = useState<CaseScenario | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([client.flows(), client.list()]).then(
      ([f, c]) => {
        setFlows(f.flows);
        setCases(c.cases);
      },
      (err: unknown) => setError(errorMessage(err)),
    );
  }, [client]);

  async function start(scenario: CaseScenario) {
    const existing = cases?.find((c) => c.scenario === scenario);
    if (existing) {
      setOpenId(existing.id);
      return;
    }
    setBusy(scenario);
    setError(null);
    try {
      const { case: c } = await client.open(scenario);
      setCases((prev) => [c, ...(prev ?? [])]);
      setOpenId(c.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (error && !flows) {
    return (
      <section>
        <PageHeader title="出事了" />
        <Notice tone="red" className="mt-0">
          {error}
        </Notice>
      </section>
    );
  }
  if (!flows || !cases) return <PageSkeleton />;

  if (openId) {
    return (
      <CaseView
        id={openId}
        flows={flows}
        client={client}
        ask={ask}
        onBack={() => {
          setOpenId(null);
          window.history.replaceState(null, "", "/emergency");
          client.list().then((r) => setCases(r.cases), () => undefined);
        }}
        onDeleted={() => {
          setCases((prev) => (prev ?? []).filter((c) => c.id !== openId));
          setOpenId(null);
          window.history.replaceState(null, "", "/emergency");
        }}
      />
    );
  }

  return (
    <section>
      <PageHeader title="出事了" />
      <div className="relative animate-enter overflow-hidden rounded-[28px] bg-gradient-to-br from-rose-500 to-red-600 p-5 text-white shadow-card">
        <span className="absolute -top-10 -right-8 size-36 rounded-full bg-white/10" aria-hidden="true" />
        <div className="relative flex items-center gap-2">
          <Siren className="size-5" aria-hidden="true" />
          <p className="font-bold">有立即危險，先確保安全</p>
        </div>
        <p className="relative mt-1 text-sm text-rose-50/90">火災、受傷撥 119；人身安全受威脅撥 110。</p>
        <div className="relative mt-4 grid grid-cols-2 gap-2">
          <a href="tel:119" className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white font-bold text-red-600 transition active:scale-95">
            <Phone className="size-4" aria-hidden="true" />
            撥打 119
          </a>
          <a href="tel:110" className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white/20 font-bold text-white backdrop-blur transition active:scale-95">
            <Phone className="size-4" aria-hidden="true" />
            撥打 110
          </a>
        </div>
      </div>

      <p className="mt-7 mb-3 px-1 text-sm font-semibold text-slate-500">發生了什麼事？</p>
      <div className="stagger grid grid-cols-2 gap-3">
        {ORDER.map((id) => {
          const flow = flows.find((f) => f.id === id);
          if (!flow) return null;
          const meta = SCENARIO_META[id];
          const has = cases.some((c) => c.scenario === id);
          return (
            <button
              key={id}
              type="button"
              disabled={busy !== null}
              onClick={() => void start(id)}
              className="relative flex min-h-32 flex-col overflow-hidden rounded-3xl bg-white p-4 text-left shadow-card transition active:scale-[0.97] disabled:opacity-60"
            >
              <span className={`absolute -top-6 -right-6 size-20 rounded-full opacity-60 ${TONE[meta.tone].soft}`} aria-hidden="true" />
              <span className="relative">
                <IconBadge icon={meta.icon} tone={meta.tone} />
              </span>
              <span className="relative mt-auto block pt-3 font-bold text-slate-900">{flow.label}</span>
              <span className="relative block text-xs text-slate-500">{busy === id ? "建立中…" : has ? "繼續處理" : meta.desc}</span>
            </button>
          );
        })}
      </div>
      {error && <ErrorText>{error}</ErrorText>}

      {cases.length > 0 && (
        <>
          <SectionTitle icon={ClipboardList} count={cases.length}>
            我的案件
          </SectionTitle>
          <div className="stagger mt-3 space-y-3">
            {cases.map((c) => {
              const meta = SCENARIO_META[c.scenario];
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setOpenId(c.id)}
                  className="flex w-full items-center gap-3 rounded-3xl bg-white p-4 text-left shadow-card transition active:scale-[0.98]"
                >
                  <IconBadge icon={meta.icon} tone={meta.tone} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-slate-900">{c.label}</span>
                      <span className="text-xs text-slate-400">{dateLabel(c.updatedAt)} 更新</span>
                    </span>
                    <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <span className="block h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(c.done / Math.max(1, c.total)) * 100}%` }} />
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">
                      完成 {c.done} / {c.total} 步{c.hasSummary ? "・已產生摘要" : ""}
                    </span>
                  </span>
                  <ChevronRight className="size-5 text-slate-300" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </>
      )}
      <Disclaimer />
    </section>
  );
}

/* ───────────── 單一案件 ───────────── */

function CaseView({
  id,
  flows,
  client,
  ask,
  onBack,
  onDeleted,
}: {
  id: string;
  flows: Flow[];
  client: CaseClient;
  ask: (text: string) => Promise<boolean>;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
    client.get(id).then(setDetail, (err: unknown) => setError(errorMessage(err)));
  }, [client, id]);

  const flow = detail ? flows.find((f) => f.id === detail.case.scenario) : undefined;
  const done = useMemo(() => new Set(detail?.case.checklistDone ?? []), [detail]);

  if (error && !detail) {
    return (
      <section>
        <PageHeader title="案件" back={onBack} />
        <Notice tone="red" className="mt-0">
          {error}
        </Notice>
      </section>
    );
  }
  if (!detail || !flow) return <PageSkeleton />;
  const c = detail.case;
  const meta = SCENARIO_META[c.scenario];

  async function toggle(key: string) {
    if (!detail) return;
    const prev = detail;
    const next = done.has(key) ? c.checklistDone.filter((k) => k !== key) : [...c.checklistDone, key];
    setDetail({ ...detail, case: { ...c, checklistDone: next, done: next.length } });
    setError(null);
    try {
      const r = await client.update({ id: c.id, checklistDone: next });
      setDetail((d) => (d ? { ...d, case: r.case } : d));
    } catch (err) {
      setDetail(prev);
      setError(errorMessage(err));
    }
  }

  async function askStep(text: string) {
    if (!(await ask(text))) setAsking(text);
  }

  function follow(item: FlowItem) {
    if (!item.link) return;
    if (item.link.startsWith("#")) {
      document.getElementById(item.link.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (item.link === "/case") {
      window.location.assign(`/case?id=${encodeURIComponent(c.id)}`);
    } else {
      window.location.assign(item.link);
    }
  }

  const answered = c.answers.occurredOn || c.answers.story || c.answers.wants.length;

  return (
    <section>
      <PageHeader title={flow.label} back={onBack} />

      <Card className="animate-enter p-5">
        <div className="flex items-center gap-3">
          <IconBadge icon={meta.icon} tone={meta.tone} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-slate-500">
              完成 {c.done} / {c.total} 步
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${(c.done / Math.max(1, c.total)) * 100}%` }} />
            </div>
          </div>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-slate-600">{flow.intro}</p>
      </Card>

      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-3 flex w-full items-center gap-3 rounded-3xl bg-white p-4 text-left shadow-card transition active:scale-[0.98]"
      >
        <IconBadge icon={Pencil} tone="slate" size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-slate-900">案件資料</span>
          <span className="block truncate text-sm text-slate-500">
            {answered ? [c.answers.occurredOn, c.answers.city, c.answers.wants.join("、")].filter(Boolean).join("・") : "發生日期、經過、你希望的結果"}
          </span>
        </span>
        <ChevronRight className="size-5 text-slate-300" aria-hidden="true" />
      </button>
      {error && <ErrorText>{error}</ErrorText>}

      {STAGES.map((stage) => {
        const st = flow.stages[stage];
        return (
          <div key={stage}>
            <SectionTitle icon={ClipboardList} tone={stage === "now" ? "rose" : "slate"}>
              {STAGE_LABEL[stage]}
            </SectionTitle>
            <Card className="mt-3 divide-y divide-slate-100 px-4 py-1">
              {st.items.map((item) => {
                const key = stepKey(stage, item.id);
                const checked = done.has(key);
                return (
                  <div key={key} className="py-3">
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        aria-label={item.text}
                        onClick={() => void toggle(key)}
                        className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg border-2 transition active:scale-90 ${
                          checked ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 bg-white"
                        }`}
                      >
                        {checked && <Check className="size-4 animate-pop" strokeWidth={3} aria-hidden="true" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className={`text-[15px] leading-relaxed ${checked ? "text-slate-400 line-through decoration-slate-300" : "text-slate-900"}`}>
                          {item.text}
                          {item.key && !checked && <span className="ml-1.5 rounded-full bg-amber-50 px-2 py-0.5 align-middle text-[11px] font-semibold text-amber-700">重要</span>}
                        </p>
                        {item.link && <StepLink item={item} onFollow={() => follow(item)} />}
                        {item.sources && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {item.sources.map((s) => (
                              <a
                                key={s.url}
                                href={s.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex min-h-8 items-center gap-1 rounded-full bg-slate-100 px-3 text-xs font-medium text-slate-700 transition active:scale-95"
                              >
                                <ExternalLink className="size-3.5" aria-hidden="true" />
                                {s.label}
                              </a>
                            ))}
                            <span className="inline-flex min-h-8 items-center text-xs text-slate-400">其他縣市請查當地消防局網站</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div className="py-2">
                <button
                  type="button"
                  onClick={() => void askStep(st.ask)}
                  className="flex min-h-11 w-full items-center gap-2 rounded-2xl px-1 text-sm font-medium text-emerald-700 transition active:bg-emerald-50"
                >
                  <MessageCircleQuestion className="size-4" aria-hidden="true" />
                  問這一步
                </button>
              </div>
            </Card>
          </div>
        );
      })}

      <SectionTitle icon={Images} tone="amber" count={c.evidenceIds.length}>
        這個案件的證據
      </SectionTitle>
      <Card className="mt-3 p-4">
        <p className="text-sm leading-relaxed text-slate-600">
          {c.evidenceIds.length ? `已選 ${c.evidenceIds.length} 筆存證，會列進案件摘要。` : "從存證廊挑選和這件事有關的照片、對話紀錄，會列進案件摘要。"}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="secondary" icon={Check} onClick={() => setPicking(true)}>
            選擇證據
          </Button>
          <LinkButton variant="secondary" icon={Plus} href="/evidence">
            去存證廊
          </LinkButton>
        </div>
      </Card>

      <div id="articles" className="scroll-mt-20">
        <SectionTitle icon={BookOpen} tone="emerald" count={detail.articles.length}>
          相關條文
        </SectionTitle>
        <div className="mt-3 space-y-3">
          {detail.articles.length === 0 && <Notice tone="slate">相關條文待查，請先洽詢法扶專線。</Notice>}
          {detail.articles.map((a) => (
            <Disclosure key={`${a.lawName}-${a.articleNo}`} icon={BookOpen} title={`${a.lawName} 第 ${a.articleNo} 條`}>
              <p className="text-sm leading-relaxed whitespace-pre-line text-slate-700">{a.text}</p>
              <div className="mt-3">
                <SourceChip href={a.sourceUrl}>全國法規資料庫</SourceChip>
              </div>
            </Disclosure>
          ))}
        </div>
      </div>

      {detail.fireRule && (
        <div id="fireRule" className="scroll-mt-20">
          <SectionTitle icon={Building2} tone="orange">
            住警器規定{detail.fireRule.city ? `（${detail.fireRule.city}）` : ""}
          </SectionTitle>
          <div className="mt-3 space-y-3">
            {detail.fireRule.note && <Notice tone="slate">{detail.fireRule.note}</Notice>}
            {[...(detail.fireRule.national ? [detail.fireRule.national] : []), ...detail.fireRule.local].map((a) => (
              <Disclosure key={`${a.lawName}-${a.articleNo}`} icon={BookOpen} title={`${a.lawName} 第 ${a.articleNo} 條`}>
                <p className="text-sm leading-relaxed whitespace-pre-line text-slate-700">{a.text}</p>
                <div className="mt-3">
                  <SourceChip href={a.sourceUrl}>官方原文</SourceChip>
                </div>
              </Disclosure>
            ))}
          </div>
        </div>
      )}

      <SectionTitle icon={Phone} tone="sky">
        可以洽詢
      </SectionTitle>
      <div className="mt-3 space-y-3">
        {detail.referrals.map((r) => (
          <Card key={r.id} className="p-4">
            <p className="font-semibold text-slate-900">{r.name}</p>
            <p className="mt-1 text-sm text-slate-700">{r.contact}</p>
            {r.hours && <p className="text-xs text-slate-500">{r.hours}</p>}
            <p className="mt-1 text-xs text-slate-500">{r.note}</p>
          </Card>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setDeleting(true)}
        className="mx-auto mt-8 flex min-h-11 items-center gap-1.5 px-4 text-sm text-slate-400 transition active:text-red-600"
      >
        <Trash2 className="size-4" aria-hidden="true" />
        刪除這個案件
      </button>
      <Disclaimer />

      <BottomBar>
        <LinkButton variant="primary" icon={FileText} href={`/case?id=${encodeURIComponent(c.id)}`} className="w-full">
          產生案件摘要
        </LinkButton>
      </BottomBar>

      {editing && (
        <AnswersSheet
          flow={flow}
          answers={c.answers}
          onClose={() => setEditing(false)}
          onSave={async (answers) => {
            const r = await client.update({ id: c.id, answers });
            setDetail((d) => (d ? { ...d, case: r.case } : d));
            setEditing(false);
            // 縣市改了，火災的住警器規定要重抓
            if (c.scenario === "fire" && answers.city !== c.answers.city) client.get(c.id).then(setDetail, () => undefined);
          }}
        />
      )}
      {picking && (
        <EvidencePicker
          client={client}
          selected={c.evidenceIds}
          onClose={() => setPicking(false)}
          onSave={async (ids) => {
            const r = await client.update({ id: c.id, evidenceIds: ids });
            setDetail((d) => (d ? { ...d, case: r.case } : d));
            setPicking(false);
          }}
        />
      )}
      {asking && (
        <Sheet title="問這一步" onClose={() => setAsking(null)}>
          <p className="text-sm leading-relaxed text-slate-600">複製下面的問題，回到租安心的聊天室貼上送出，就會收到附條文出處的回答。</p>
          <p className="mt-3 rounded-2xl bg-slate-50 p-4 text-[15px] text-slate-900">{asking}</p>
          <div className="mt-4">
            <CopyButton text={asking} label="複製問題" />
          </div>
        </Sheet>
      )}
      {deleting && (
        <ConfirmSheet
          title="刪除這個案件？"
          message="勾選紀錄、案件資料和摘要都會刪除，無法復原。存證廊裡的證據不會被刪。"
          confirmLabel="刪除"
          busy={deleteBusy}
          onCancel={() => setDeleting(false)}
          onConfirm={async () => {
            setDeleteBusy(true);
            try {
              await client.remove(c.id);
              onDeleted();
            } catch (err) {
              setError(errorMessage(err));
              setDeleting(false);
            } finally {
              setDeleteBusy(false);
            }
          }}
        />
      )}
    </section>
  );
}

function StepLink({ item, onFollow }: { item: FlowItem; onFollow: () => void }) {
  const link = item.link!;
  const label = link.startsWith("tel:")
    ? `撥打 ${link === "tel:024128518" ? "412-8518" : link.slice(4)}`
    : link === "/evidence"
      ? "打開存證廊"
      : link === "/case"
        ? "產生摘要"
        : link === "#fireRule"
          ? "看住警器規定"
          : "看條文";
  const Icon = link.startsWith("tel:") ? Phone : link === "/evidence" ? Images : link === "/case" ? FileText : BookOpen;
  const cls = "mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-full bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 transition active:scale-95";
  if (link.startsWith("tel:")) {
    return (
      <a href={link} className={cls}>
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </a>
    );
  }
  return (
    <button type="button" onClick={onFollow} className={cls}>
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}

/* ───────────── 案件資料 ───────────── */

function AnswersSheet({ flow, answers, onClose, onSave }: { flow: Flow; answers: CaseAnswers; onClose: () => void; onSave: (a: CaseAnswers) => Promise<void> }) {
  const [a, setA] = useState<CaseAnswers>(answers);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave(a);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Sheet title="案件資料" onClose={onClose} busy={busy}>
      <div className="space-y-5">
        <label className="block">
          <span className={FIELD_LABEL}>發生日期</span>
          <input type="date" max={today} className={FIELD} value={a.occurredOn ?? ""} onChange={(e) => setA({ ...a, occurredOn: e.target.value || null })} />
        </label>
        <label className="block">
          <span className={FIELD_LABEL}>租屋處所在縣市</span>
          <select className={FIELD} value={a.city ?? ""} onChange={(e) => setA({ ...a, city: e.target.value || null })}>
            <option value="">請選擇</option>
            {ALL_CITIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend className={FIELD_LABEL}>房東是</legend>
          <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1">
            {LANDLORD.map((l) => (
              <button
                key={l.id}
                type="button"
                aria-pressed={a.landlordType === l.id}
                onClick={() => setA({ ...a, landlordType: l.id })}
                className={`min-h-10 rounded-xl text-sm font-medium transition ${a.landlordType === l.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-400">業者：包租代管公司、經營二房東的公司</p>
        </fieldset>
        <label className="block">
          <span className={FIELD_LABEL}>事情經過</span>
          <textarea
            rows={4}
            maxLength={800}
            className={`${FIELD} py-3 leading-relaxed`}
            placeholder="用幾句話寫下發生了什麼、和房東說過什麼。不用寫房東姓名或電話。"
            value={a.story}
            onChange={(e) => setA({ ...a, story: e.target.value })}
          />
          <span className="mt-1 block text-xs text-slate-400">身分證字號、手機號碼等個資會自動遮蔽。</span>
        </label>
        <fieldset>
          <legend className={FIELD_LABEL}>你希望的結果（可複選）</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {flow.wants.map((w) => {
              const on = a.wants.includes(w);
              return (
                <button
                  key={w}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setA({ ...a, wants: on ? a.wants.filter((x) => x !== w) : [...a.wants, w] })}
                  className={`min-h-10 rounded-full px-4 text-sm font-medium ring-1 transition active:scale-95 ${
                    on ? "bg-emerald-600 text-white ring-emerald-600" : "bg-white text-slate-700 ring-slate-200"
                  }`}
                >
                  {w}
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="mt-6 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          取消
        </Button>
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? "儲存中…" : "儲存"}
        </Button>
      </div>
    </Sheet>
  );
}

/* ───────────── 選證據 ───────────── */

function EvidencePicker({ client, selected, onClose, onSave }: { client: CaseClient; selected: string[]; onClose: () => void; onSave: (ids: string[]) => Promise<void> }) {
  const [items, setItems] = useState<EvidenceItem[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set(selected));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client.evidenceList().then(
      (r) => setItems(r.items),
      (err: unknown) => setError(errorMessage(err)),
    );
  }, [client]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave([...picked]);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Sheet title="選擇證據" onClose={onClose} busy={busy}>
      {!items && !error && <div className="skeleton h-40 rounded-3xl" role="status" aria-label="載入中" />}
      {items && items.length === 0 && (
        <EmptyState icon={Images} tone="amber" title="存證廊還是空的" desc="先到存證廊拍照或寫紀錄，再回來選。">
          <LinkButton href="/evidence" variant="primary" className="w-full">
            去存證廊
          </LinkButton>
        </EmptyState>
      )}
      {items && items.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {items.map((it) => {
            const on = picked.has(it.id);
            return (
              <li key={it.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => {
                    const next = new Set(picked);
                    if (on) next.delete(it.id);
                    else next.add(it.id);
                    setPicked(next);
                  }}
                  className="flex min-h-14 w-full items-center gap-3 py-2 text-left"
                >
                  <span
                    className={`flex size-6 shrink-0 items-center justify-center rounded-lg border-2 transition ${on ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300"}`}
                  >
                    {on && <Check className="size-4" strokeWidth={3} aria-hidden="true" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] text-slate-900">{it.text || it.fileName || "（沒有描述）"}</span>
                    <span className="block text-xs text-slate-500">{dateLabel(it.occurredAt)} 發生</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {items && items.length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? "儲存中…" : `確定（${picked.size}）`}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
