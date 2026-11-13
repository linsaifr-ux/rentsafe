import { Scale } from "lucide-react";

/** 免責聲明（SPEC 12），每則法律說明下方固定顯示 */
export const DISCLAIMER_TEXT = "本服務提供法律資訊，不是法律意見；個案請洽法扶專線或律師。";

export function Disclaimer() {
  return (
    <p className="mt-8 flex items-start justify-center gap-1.5 px-4 text-center text-xs leading-relaxed text-slate-400">
      <Scale className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{DISCLAIMER_TEXT}</span>
    </p>
  );
}
