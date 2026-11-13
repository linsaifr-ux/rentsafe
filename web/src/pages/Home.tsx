import { Camera, ChevronRight, ClipboardCheck, FileSearch, History, MapPin, Settings, ShieldCheck, Siren, type LucideIcon } from "lucide-react";
import type { PageProps } from "../router.tsx";
import { Disclaimer } from "../components/Disclaimer.tsx";
import { IconBadge, NavCard, TONE, type Tone } from "../components/ui.tsx";

interface Feature {
  href: string;
  icon: LucideIcon;
  tone: Tone;
  title: string;
  desc: string;
}

const BEFORE: Feature[] = [
  { href: "/viewing", icon: ClipboardCheck, tone: "emerald", title: "看房健檢", desc: "逐項檢查，找出安全紅燈" },
  { href: "/lease", icon: FileSearch, tone: "sky", title: "租約健檢", desc: "拍租約，找出不合理條款" },
];

const TROUBLE: Feature[] = [
  { href: "/evidence", icon: Camera, tone: "amber", title: "存證廊", desc: "照片依時間整理成證據" },
  { href: "/emergency", icon: Siren, tone: "rose", title: "出事了", desc: "火災、漏水、押金爭議" },
];

/** 兩欄功能磚 */
function FeatureTile({ href, icon, tone, title, desc }: Feature) {
  return (
    <a href={href} className="group relative flex min-h-36 flex-col overflow-hidden rounded-3xl bg-white p-4 shadow-card transition active:scale-[0.97]">
      <span className={`absolute -top-6 -right-6 size-20 rounded-full opacity-60 ${TONE[tone].soft}`} aria-hidden="true" />
      <span className="relative">
        <IconBadge icon={icon} tone={tone} />
      </span>
      <span className="relative mt-auto block pt-3 font-bold text-slate-900">{title}</span>
      <span className="relative block text-xs leading-relaxed text-slate-500">{desc}</span>
    </a>
  );
}

export function Home({ me }: PageProps) {
  return (
    <section className="pt-4">
      <div className="relative animate-enter overflow-hidden rounded-[28px] bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700 p-5 text-white shadow-brand">
        <span className="absolute -top-10 -right-8 size-40 rounded-full bg-white/10" aria-hidden="true" />
        <span className="absolute -bottom-16 left-10 size-40 rounded-full bg-white/5" aria-hidden="true" />
        <div className="relative flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
            <ShieldCheck className="size-5" strokeWidth={2} aria-hidden="true" />
          </span>
          <h1 className="text-lg font-bold tracking-wide">租安心</h1>
        </div>
        <p className="relative mt-5 text-2xl font-bold">你好，{me.displayName || "朋友"}！</p>
        <p className="relative mt-1 text-sm text-emerald-50/90">第一次租屋，一步步陪你看清楚。</p>
        <a
          href="/settings"
          className="relative mt-4 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-white/15 px-3.5 text-sm font-medium backdrop-blur transition active:scale-95 active:bg-white/25"
        >
          <MapPin className="size-4" aria-hidden="true" />
          <span>租屋縣市：{me.city ?? "尚未設定"}</span>
          <ChevronRight className="size-4 opacity-70" aria-hidden="true" />
        </a>
      </div>

      <p className="mt-7 mb-3 px-1 text-sm font-semibold text-slate-500">簽約前</p>
      <div className="stagger grid grid-cols-2 gap-3">
        {BEFORE.map((f) => (
          <FeatureTile key={f.href} {...f} />
        ))}
      </div>
      <div className="mt-3 animate-enter [animation-delay:100ms]">
        <NavCard href="/viewings" icon={History} tone="violet" title="我的看房紀錄" desc="看房、租約結果一起比較" />
      </div>

      <p className="mt-7 mb-3 px-1 text-sm font-semibold text-slate-500">遇到問題</p>
      <div className="stagger grid grid-cols-2 gap-3">
        {TROUBLE.map((f) => (
          <FeatureTile key={f.href} {...f} />
        ))}
      </div>

      <div className="mt-3 animate-enter [animation-delay:160ms]">
        <NavCard href="/settings" icon={Settings} tone="slate" title="我的設定" desc="租屋縣市、刪除我的資料" />
      </div>
      <Disclaimer />
    </section>
  );
}
