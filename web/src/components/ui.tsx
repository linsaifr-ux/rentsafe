import { useEffect, useRef, useState, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, TriangleAlert, Trash2, type LucideIcon } from "lucide-react";

/**
 * 共用的手機介面元件。
 * 原則：不用底線文字連結、不用表情符號；圖示一律用 lucide 線條圖示，
 * 可點的東西都做成按鈕、卡片或標籤，觸控區至少 44px 高，按下有縮放回饋。
 */

/* ───────────── 色調 ───────────── */

export type Tone = "emerald" | "sky" | "violet" | "amber" | "rose" | "orange" | "slate" | "red";

/** 圖示底色＋圖示色（Tailwind 需要完整 class 字串才會打包） */
export const TONE: Record<Tone, { soft: string; icon: string; text: string; solid: string }> = {
  emerald: { soft: "bg-emerald-50", icon: "text-emerald-600", text: "text-emerald-700", solid: "bg-emerald-500" },
  sky: { soft: "bg-sky-50", icon: "text-sky-600", text: "text-sky-700", solid: "bg-sky-500" },
  violet: { soft: "bg-violet-50", icon: "text-violet-600", text: "text-violet-700", solid: "bg-violet-500" },
  amber: { soft: "bg-amber-50", icon: "text-amber-600", text: "text-amber-700", solid: "bg-amber-400" },
  rose: { soft: "bg-rose-50", icon: "text-rose-600", text: "text-rose-700", solid: "bg-rose-500" },
  orange: { soft: "bg-orange-50", icon: "text-orange-600", text: "text-orange-700", solid: "bg-orange-500" },
  slate: { soft: "bg-slate-100", icon: "text-slate-600", text: "text-slate-700", solid: "bg-slate-500" },
  red: { soft: "bg-red-50", icon: "text-red-600", text: "text-red-700", solid: "bg-red-500" },
};

/** 安全分數對應的色調與說法 */
export function scoreTone(score: number): { tone: Tone; label: string; stroke: string } {
  if (score >= 80) return { tone: "emerald", label: "大致安全", stroke: "stroke-emerald-500" };
  if (score >= 60) return { tone: "amber", label: "有些地方要注意", stroke: "stroke-amber-400" };
  return { tone: "red", label: "紅燈很多，建議再考慮", stroke: "stroke-red-500" };
}

/* ───────────── 按鈕 ───────────── */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "dangerSoft";

const VARIANT: Record<Variant, string> = {
  primary: "bg-emerald-600 text-white shadow-brand active:bg-emerald-700 disabled:bg-slate-300 disabled:shadow-none",
  secondary: "bg-white text-emerald-700 shadow-card ring-1 ring-emerald-600/20 active:bg-emerald-50 disabled:opacity-50",
  ghost: "bg-slate-100 text-slate-700 active:bg-slate-200 disabled:opacity-50",
  danger: "bg-red-600 text-white active:bg-red-700 disabled:opacity-50",
  dangerSoft: "bg-red-50 text-red-700 active:bg-red-100 disabled:opacity-50",
};

const BASE =
  "flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 text-base font-semibold transition duration-150 active:scale-[0.98] disabled:active:scale-100";

export function btnClass(variant: Variant = "primary", extra = ""): string {
  return `${BASE} ${VARIANT[variant]} ${extra}`.trim();
}

type WithIcon = { variant?: Variant; icon?: LucideIcon };

export function Button({ variant = "primary", icon: Icon, className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & WithIcon) {
  return (
    <button type="button" className={btnClass(variant, className)} {...rest}>
      {Icon && <Icon className="size-5 shrink-0" strokeWidth={2} aria-hidden="true" />}
      {children}
    </button>
  );
}

/** 看起來像按鈕的連結（換頁用） */
export function LinkButton({ variant = "secondary", icon: Icon, className = "", children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & WithIcon) {
  return (
    <a className={btnClass(variant, className)} {...rest}>
      {Icon && <Icon className="size-5 shrink-0" strokeWidth={2} aria-hidden="true" />}
      {children}
    </a>
  );
}

/* ───────────── 版面 ───────────── */

/** 頁首：固定在上方的標題列，左邊返回鍵 */
export function PageHeader({ title, back = "/", action }: { title: string; back?: string | (() => void) | null; action?: ReactNode }) {
  const cls = "flex size-11 items-center justify-center rounded-full text-slate-700 transition active:scale-90 active:bg-slate-200/70";
  return (
    <header className="sticky top-0 z-30 -mx-4 mb-2 flex h-14 items-center gap-1 bg-slate-50/95 px-2 backdrop-blur-xl">
      {back === null ? (
        <span className="size-11" />
      ) : typeof back === "string" ? (
        <a href={back} aria-label="返回" className={cls}>
          <ChevronLeft className="size-6" aria-hidden="true" />
        </a>
      ) : (
        <button type="button" aria-label="返回" onClick={back} className={cls}>
          <ChevronLeft className="size-6" aria-hidden="true" />
        </button>
      )}
      <h1 className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold text-slate-900">{title}</h1>
      <span className="flex size-11 items-center justify-center">{action}</span>
    </header>
  );
}

export function Card({ children, className = "", ...rest }: { children: ReactNode; className?: string } & Omit<HTMLAttributes<HTMLDivElement>, "className">) {
  return (
    <div className={`rounded-3xl bg-white p-4 shadow-card ${className}`} {...rest}>
      {children}
    </div>
  );
}

/** 帶底色的圓角圖示 */
export function IconBadge({ icon: Icon, tone = "emerald", size = "md" }: { icon: LucideIcon; tone?: Tone; size?: "sm" | "md" | "lg" }) {
  const box = size === "sm" ? "size-8 rounded-xl" : size === "lg" ? "size-14 rounded-2xl" : "size-11 rounded-2xl";
  const ic = size === "sm" ? "size-4" : size === "lg" ? "size-7" : "size-[22px]";
  return (
    <span className={`flex shrink-0 items-center justify-center ${box} ${TONE[tone].soft}`} aria-hidden="true">
      <Icon className={`${ic} ${TONE[tone].icon}`} strokeWidth={2} />
    </span>
  );
}

/** 區塊標題：圖示＋文字＋數量 */
export function SectionTitle({ icon, tone = "slate", count, children, className = "mt-7" }: { icon: LucideIcon; tone?: Tone; count?: number; children: ReactNode; className?: string }) {
  return (
    <h2 className={`flex items-center gap-2.5 text-[17px] font-bold text-slate-900 ${className}`}>
      <IconBadge icon={icon} tone={tone} size="sm" />
      <span className="flex-1">{children}</span>
      {count !== undefined && <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${TONE[tone].soft} ${TONE[tone].text}`}>{count}</span>}
    </h2>
  );
}

/** 提示框 */
export function Notice({ tone = "amber", icon: Icon = TriangleAlert, title, children, className = "mt-3" }: { tone?: Tone; icon?: LucideIcon; title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex gap-3 rounded-2xl p-4 text-sm leading-relaxed ${TONE[tone].soft} ${className}`}>
      <Icon className={`mt-0.5 size-5 shrink-0 ${TONE[tone].icon}`} strokeWidth={2} aria-hidden="true" />
      <div className={`min-w-0 flex-1 ${TONE[tone].text}`}>
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? "mt-0.5 opacity-90" : ""}>{children}</div>
      </div>
    </div>
  );
}

/** 功能入口卡片：圖示＋標題＋說明＋右箭頭 */
export function NavCard({ href, icon, tone = "emerald", title, desc }: { href: string; icon: LucideIcon; tone?: Tone; title: string; desc?: string }) {
  return (
    <a href={href} className="flex min-h-16 items-center gap-3 rounded-3xl bg-white p-4 shadow-card transition active:scale-[0.98] active:bg-slate-50">
      <IconBadge icon={icon} tone={tone} />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-slate-900">{title}</span>
        {desc && <span className="block text-sm text-slate-500">{desc}</span>}
      </span>
      <ChevronRight className="size-5 text-slate-300" aria-hidden="true" />
    </a>
  );
}

/** 條文出處標籤，點了開官方原文 */
export function SourceChip({ href, children }: { href: string | null; children: ReactNode }) {
  const cls = "inline-flex min-h-8 items-center gap-1.5 rounded-full bg-emerald-50 px-3 text-xs font-medium text-emerald-800 ring-1 ring-emerald-600/10";
  const icon = <BookOpen className="size-3.5 shrink-0" strokeWidth={2.2} aria-hidden="true" />;
  if (!href) {
    return (
      <span className={cls}>
        {icon}
        {children}
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className={`${cls} transition active:scale-95 active:bg-emerald-100`}>
      {icon}
      {children}
      <ChevronRight className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
    </a>
  );
}

/** 固定在畫面底部的主要動作列（長表單用，手指不用滑到最下面） */
export function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-6 rounded-t-3xl bg-white/90 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-float backdrop-blur-xl">
      {children}
    </div>
  );
}

/** 可展開的區塊 */
export function Disclosure({ title, icon: Icon, defaultOpen = false, children }: { title: ReactNode; icon?: LucideIcon; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details className="group rounded-3xl bg-white shadow-card" open={defaultOpen}>
      <summary className="flex min-h-13 cursor-pointer items-center gap-3 px-4 py-3 font-medium text-slate-900">
        {Icon && <Icon className="size-5 shrink-0 text-slate-400" aria-hidden="true" />}
        <span className="min-w-0 flex-1">{title}</span>
        <ChevronDown className="size-5 shrink-0 text-slate-400 transition-transform duration-300 group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

/** 空狀態／提示頁 */
export function EmptyState({ icon, tone = "emerald", title, desc, children }: { icon: LucideIcon; tone?: Tone; title: string; desc?: string; children?: ReactNode }) {
  return (
    <Card className="mt-4 flex flex-col items-center px-6 py-8 text-center">
      <span className="animate-float">
        <IconBadge icon={icon} tone={tone} size="lg" />
      </span>
      <p className="mt-4 text-lg font-bold text-slate-900">{title}</p>
      {desc && <p className="mt-1 text-sm leading-relaxed text-slate-500">{desc}</p>}
      {children && <div className="mt-5 w-full">{children}</div>}
    </Card>
  );
}

/** 載入中骨架 */
export function PageSkeleton() {
  return (
    <div className="space-y-3 pt-16" role="status" aria-label="載入中">
      <div className="skeleton h-28 rounded-3xl" />
      <div className="skeleton h-16 rounded-3xl" />
      <div className="skeleton h-16 rounded-3xl" />
      <div className="skeleton h-16 rounded-3xl opacity-60" />
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 animate-fade text-center text-sm text-red-700" role="alert">
      {children}
    </p>
  );
}

/* ───────────── 複製 ───────────── */

/** 複製按鈕：成功時圖示換成打勾並彈一下 */
export function CopyButton({ text, label, doneLabel = "已複製", size = "md" }: { text: string; label: string; doneLabel?: string; size?: "sm" | "md" }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2400);
    } catch {
      setCopied(false);
    }
  }

  const Icon = copied ? Check : Copy;
  const icon = <Icon key={String(copied)} className={`${size === "sm" ? "size-4" : "size-5"} shrink-0 ${copied ? "animate-pop" : ""}`} strokeWidth={2.2} aria-hidden="true" />;
  if (size === "sm") {
    return (
      <button
        type="button"
        onClick={copy}
        className={`mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition active:scale-95 ${copied ? "bg-emerald-600 text-white" : "bg-white text-emerald-700 active:bg-emerald-100"}`}
      >
        {icon}
        {copied ? doneLabel : label}
      </button>
    );
  }
  return (
    <button type="button" onClick={copy} className={btnClass(copied ? "primary" : "secondary", "mt-3")}>
      {icon}
      {copied ? doneLabel : label}
    </button>
  );
}

/* ───────────── 分數 ───────────── */

function motionOk(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    typeof window.requestAnimationFrame === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** 數字從 0 跑到 target；不支援或使用者關掉動態效果時直接顯示 */
export function useCountUp(target: number, ms = 900): number {
  const [motion] = useState(motionOk);
  const [value, setValue] = useState(motion ? 0 : target);
  useEffect(() => {
    if (!motion) return;
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [motion, target, ms]);
  return motion ? value : target;
}

/** 圓環分數：圓環從 0 畫到分數，數字同步跑上去 */
export function ScoreRing({ score, size = 168, stroke = 12, testId, small = false }: { score: number; size?: number; stroke?: number; testId?: string; small?: boolean }) {
  const shown = useCountUp(score);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(100, score)) / 100);
  const st = scoreTone(score);
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-slate-100" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className={`${st.stroke} [animation:ring_1s_var(--ease-out-soft)_both]`}
          style={{ strokeDasharray: c, strokeDashoffset: offset, "--ring-from": c } as CSSProperties}
        />
      </svg>
      <span className={`absolute font-bold tabular-nums ${TONE[st.tone].text} ${small ? "text-base" : "text-5xl"}`} data-testid={testId}>
        {shown}
      </span>
    </span>
  );
}

/* ───────────── 底部面板 ───────────── */

/** 從底部滑出的面板（表單、提醒用） */
export function Sheet({ title, onClose, busy = false, children }: { title: string; onClose: () => void; busy?: boolean; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex animate-fade items-end justify-center bg-slate-900/40 backdrop-blur-[2px]" onClick={busy ? undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[92dvh] w-full max-w-md animate-sheet overflow-y-auto rounded-t-[28px] bg-white px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto h-1.5 w-10 rounded-full bg-slate-200" aria-hidden="true" />
        <p className="mt-4 text-center text-lg font-bold text-slate-900">{title}</p>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

/* ───────────── 確認面板 ───────────── */

/** 從底部滑出的確認面板（刪除等不可復原的動作用） */
export function ConfirmSheet({
  title,
  message,
  confirmLabel,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex animate-fade items-end justify-center bg-slate-900/40 backdrop-blur-[2px]" onClick={busy ? undefined : onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md animate-sheet rounded-t-[28px] bg-white px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto h-1.5 w-10 rounded-full bg-slate-200" aria-hidden="true" />
        <div className="mt-5 flex justify-center">
          <span className="animate-pop">
            <IconBadge icon={Trash2} tone="red" size="lg" />
          </span>
        </div>
        <p className="mt-4 text-center text-lg font-bold text-slate-900">{title}</p>
        <p className="mt-2 text-center text-sm leading-relaxed text-slate-600">{message}</p>
        {error && <ErrorText>{error}</ErrorText>}
        <div className="mt-6 space-y-3">
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? "處理中…" : confirmLabel}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            取消
          </Button>
        </div>
      </div>
    </div>
  );
}
