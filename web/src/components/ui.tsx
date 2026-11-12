import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

/**
 * 共用的手機介面元件。
 * 原則：不用底線文字連結；可點的東西都做成按鈕、卡片或標籤，觸控區至少 44px 高。
 */

type Variant = "primary" | "secondary" | "ghost";

const VARIANT: Record<Variant, string> = {
  primary: "bg-emerald-600 text-white active:bg-emerald-700 disabled:bg-emerald-600/50",
  secondary: "border border-emerald-600 bg-white text-emerald-700 active:bg-emerald-50 disabled:opacity-50",
  ghost: "bg-gray-100 text-gray-700 active:bg-gray-200 disabled:opacity-50",
};

const BASE = "flex min-h-11 w-full items-center justify-center rounded-xl px-4 text-base font-semibold transition-colors";

export function btnClass(variant: Variant = "primary", extra = ""): string {
  return `${BASE} ${VARIANT[variant]} ${extra}`.trim();
}

export function Button({ variant = "primary", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" className={btnClass(variant, className)} {...rest} />;
}

/** 看起來像按鈕的連結（換頁用） */
export function LinkButton({ variant = "secondary", className = "", ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant }) {
  return <a className={btnClass(variant, className)} {...rest} />;
}

/** 功能入口卡片：圖示＋標題＋說明＋右箭頭 */
export function NavCard({ href, icon, title, desc }: { href: string; icon: string; title: string; desc?: string }) {
  return (
    <a href={href} className="flex min-h-16 items-center gap-3 rounded-2xl bg-white p-4 shadow-sm active:bg-gray-50">
      <span className="text-2xl" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-gray-900">{title}</span>
        {desc && <span className="block text-sm text-gray-500">{desc}</span>}
      </span>
      <span className="text-xl text-gray-300" aria-hidden="true">
        ›
      </span>
    </a>
  );
}

/** 條文出處標籤，點了開官方原文 */
export function SourceChip({ href, children }: { href: string | null; children: ReactNode }) {
  const cls = "inline-flex min-h-8 items-center gap-1 rounded-full bg-emerald-50 px-3 text-xs font-medium text-emerald-800";
  if (!href) return <span className={cls}>📖 {children}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className={`${cls} active:bg-emerald-100`}>
      📖 {children}
      <span aria-hidden="true">›</span>
    </a>
  );
}

/** 固定在畫面底部的主要動作列（長表單用，手指不用滑到最下面） */
export function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 -mx-4 mt-4 border-t border-gray-200 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
      {children}
    </div>
  );
}
