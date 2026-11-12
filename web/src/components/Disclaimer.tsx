/** 免責聲明（SPEC 12），每則法律說明下方固定顯示 */
export const DISCLAIMER_TEXT = "本服務提供法律資訊，不是法律意見；個案請洽法扶專線或律師。";

export function Disclaimer() {
  return <p className="mt-4 text-xs text-gray-500">{DISCLAIMER_TEXT}</p>;
}
