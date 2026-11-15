import { useEffect, useState } from "react";
import { BookOpen, CalendarClock, CircleAlert, ClipboardList, Download, FileText, Fingerprint, Images, Phone, Target, UserRound } from "lucide-react";
import type { PageProps } from "../router.tsx";
import { caseApi, errorMessage, type CaseBrief, type CaseClient, type CaseSummaryData } from "../api.ts";
import { openExternal } from "../liff.ts";
import { Disclaimer } from "../components/Disclaimer.tsx";
import {
  BottomBar,
  Button,
  Card,
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
} from "../components/ui.tsx";
import { SCENARIO_META } from "./Emergency.tsx";

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", ...opts }).format(new Date(iso));
const dateTime = (iso: string) => fmt(iso, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

function idFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("id");
}

/** F6 案件摘要（SPEC 11）：一頁事實整理＋可複製文字＋PDF；不寫勝敗評估 */
export function CaseSummary({
  client = caseApi,
  openUrl = openExternal,
  initialId = idFromUrl(),
}: PageProps & { client?: CaseClient; openUrl?: (url: string) => void; initialId?: string | null }) {
  const [id] = useState(initialId);
  const [data, setData] = useState<{ summary: CaseSummaryData; text: string } | null>(null);
  const [cases, setCases] = useState<CaseBrief[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (id) client.summary(id).then(setData, (err: unknown) => setError(errorMessage(err)));
    else client.list().then((r) => setCases(r.cases), (err: unknown) => setError(errorMessage(err)));
  }, [client, id]);

  const back = id ? `/emergency?id=${encodeURIComponent(id)}` : "/emergency";

  if (error && !data && !cases) {
    return (
      <section>
        <PageHeader title="案件摘要" back={back} />
        <Notice tone="red" className="mt-0">
          {error}
        </Notice>
      </section>
    );
  }

  // 沒指定案件：選一個
  if (!id) {
    if (!cases) return <PageSkeleton />;
    return (
      <section>
        <PageHeader title="案件摘要" back="/" />
        {cases.length === 0 ? (
          <EmptyState icon={ClipboardList} tone="rose" title="還沒有案件" desc="先到「出事了」選擇發生的情況，照著步驟處理，再回來產生摘要。">
            <LinkButton href="/emergency" variant="primary" className="w-full">
              去「出事了」
            </LinkButton>
          </EmptyState>
        ) : (
          <div className="stagger space-y-3">
            {cases.map((c) => {
              const meta = SCENARIO_META[c.scenario];
              return (
                <a
                  key={c.id}
                  href={`/case?id=${encodeURIComponent(c.id)}`}
                  className="flex items-center gap-3 rounded-3xl bg-white p-4 shadow-card transition active:scale-[0.98]"
                >
                  <IconBadge icon={meta.icon} tone={meta.tone} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-slate-900">{c.label}</span>
                    <span className="block text-sm text-slate-500">
                      完成 {c.done} / {c.total} 步
                    </span>
                  </span>
                </a>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  if (!data) return <PageSkeleton />;
  const s = data.summary;
  const meta = SCENARIO_META[s.scenario];

  return (
    <section>
      <PageHeader title="案件摘要" back={back} />

      <Card className="animate-enter p-5">
        <div className="flex items-center gap-3">
          <IconBadge icon={meta.icon} tone={meta.tone} size="lg" />
          <div>
            <p className="text-xl font-bold text-slate-900">{s.scenarioLabel}案件摘要</p>
            <p className="text-xs text-slate-500">產生時間 {dateTime(s.generatedAt)}</p>
          </div>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-slate-600">打電話給法扶、崔媽媽或去調解時，可以照著這份摘要說明。摘要只整理事實和官方條文，不評估結果。</p>
      </Card>

      {s.missing.length > 0 && (
        <Notice tone="amber" icon={CircleAlert} title={`還缺 ${s.missing.length} 項資料`}>
          <ul className="mt-1 space-y-1">
            {s.missing.map((m) => (
              <li key={m}>・{m}</li>
            ))}
          </ul>
          <a href={back} className="mt-2 inline-flex min-h-9 items-center font-semibold text-amber-800">
            回案件補資料
          </a>
        </Notice>
      )}

      <SectionTitle icon={UserRound}>基本事實</SectionTitle>
      <Card className="mt-3 divide-y divide-slate-100 px-4">
        <Row k="發生日期" v={s.facts.occurredOn ?? "未填"} />
        <Row k="縣市" v={s.facts.city ?? "未填"} />
        <Row k="房東" v={s.facts.landlord} />
        {s.facts.story && <Row k="經過" v={s.facts.story} />}
      </Card>

      <SectionTitle icon={CalendarClock} count={s.timeline.length}>
        時間軸
      </SectionTitle>
      <Card className="mt-3 p-4">
        {s.timeline.length === 0 && <p className="text-sm text-slate-500">還沒有任何紀錄。</p>}
        <ol className="relative space-y-4 border-l-2 border-slate-100 pl-4">
          {s.timeline.map((t, i) => (
            <li key={i} className="relative">
              <span className="absolute top-1.5 -left-[23px] size-3 rounded-full border-2 border-white bg-emerald-500" aria-hidden="true" />
              <p className="text-xs text-slate-400">{dateTime(t.at)}</p>
              <p className="text-[15px] leading-relaxed text-slate-900">{t.text}</p>
            </li>
          ))}
        </ol>
      </Card>

      <SectionTitle icon={Images} tone="amber" count={s.evidence.length}>
        已有證據
      </SectionTitle>
      <Card className="mt-3 divide-y divide-slate-100 px-4">
        {s.evidence.length === 0 && <p className="py-4 text-sm text-slate-500">還沒有加入證據。可以在案件頁「選擇證據」。</p>}
        {s.evidence.map((e, i) => (
          <div key={e.id} className="py-3">
            <p className="text-[15px] text-slate-900">
              <span className="mr-1.5 text-slate-400">#{i + 1}</span>
              {e.type}・{e.category}
              {e.text ? `：${e.text}` : ""}
            </p>
            <p className="text-xs text-slate-500">{dateTime(e.occurredAt)} 發生</p>
            <p className="mt-1 flex items-center gap-1 font-mono text-[11px] break-all text-slate-400">
              <Fingerprint className="size-3 shrink-0" aria-hidden="true" />
              {e.sha256}
            </p>
          </div>
        ))}
      </Card>

      <SectionTitle icon={BookOpen} tone="emerald" count={s.articles.length}>
        可能相關條文
      </SectionTitle>
      <div className="mt-3 space-y-3">
        {s.articles.length === 0 && <Notice tone="slate">相關條文待查。</Notice>}
        {s.articles.map((a) => (
          <Disclosure key={`${a.lawName}-${a.articleNo}-${a.scope}`} icon={BookOpen} title={`${a.lawName} 第 ${a.articleNo} 條${a.scope === "national" ? "" : `（${a.scope}）`}`}>
            <p className="text-sm leading-relaxed whitespace-pre-line text-slate-700">{a.text}</p>
            <div className="mt-3">
              <SourceChip href={a.sourceUrl}>官方原文</SourceChip>
            </div>
          </Disclosure>
        ))}
      </div>

      <SectionTitle icon={Target} tone="violet">
        我希望的結果
      </SectionTitle>
      <Card className="mt-3 p-4">
        <p className="text-[15px] text-slate-900">{s.wants.length ? s.wants.join("、") : "未填"}</p>
      </Card>

      {s.referrals.length > 0 && (
        <>
          <SectionTitle icon={Phone} tone="sky">
            可以洽詢
          </SectionTitle>
          <div className="mt-3 space-y-3">
            {s.referrals.map((r) => (
              <Card key={r.name} className="p-4">
                <p className="font-semibold text-slate-900">{r.name}</p>
                <p className="mt-1 text-sm text-slate-700">{r.contact}</p>
                {r.hours && <p className="text-xs text-slate-500">{r.hours}</p>}
                <p className="mt-1 text-xs text-slate-500">{r.note}</p>
              </Card>
            ))}
          </div>
        </>
      )}

      <Disclaimer />

      <BottomBar>
        <div className="grid grid-cols-2 gap-2">
          <CopyButton text={data.text} label="複製文字" />
          <Button icon={Download} onClick={() => setExporting(true)}>
            下載 PDF
          </Button>
        </div>
      </BottomBar>

      {exporting && <ExportSheet id={id} client={client} openUrl={openUrl} onClose={() => setExporting(false)} />}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3 py-3">
      <span className="w-16 shrink-0 text-sm text-slate-400">{k}</span>
      <span className="min-w-0 flex-1 text-[15px] leading-relaxed break-words text-slate-900">{v}</span>
    </div>
  );
}

function ExportSheet({ id, client, openUrl, onClose }: { id: string; client: CaseClient; openUrl: (url: string) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const r = await client.exportPdf(id);
      const absolute = new URL(r.url, window.location.origin).toString();
      setUrl(absolute);
      openUrl(absolute);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="下載案件摘要 PDF" onClose={onClose} busy={busy}>
      <ul className="space-y-2 text-sm leading-relaxed text-slate-600">
        <li>・摘要可能含有你和他人的個人資料，請只提供給處理爭議的人（法扶律師、調解委員）。</li>
        <li>・不要公開張貼；公開他人個資或不實指控，可能違反個資法或構成誹謗。</li>
        <li>・下載連結 10 分鐘內有效，會用手機瀏覽器開啟。</li>
      </ul>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="mt-6 grid gap-2">
        {url ? (
          <Button icon={FileText} variant="secondary" onClick={() => openUrl(url)}>
            再開一次
          </Button>
        ) : (
          <Button icon={Download} onClick={() => void go()} disabled={busy}>
            {busy ? "準備中…" : "我了解，下載"}
          </Button>
        )}
      </div>
    </Sheet>
  );
}
