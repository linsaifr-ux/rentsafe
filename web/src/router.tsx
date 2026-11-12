import type { ComponentType } from "react";
import type { Me } from "./api.ts";
import { Home } from "./pages/Home.tsx";
import { ViewingCheck } from "./pages/ViewingCheck.tsx";
import { ViewingHistory } from "./pages/ViewingHistory.tsx";
import { LeaseCheck } from "./pages/LeaseCheck.tsx";
import { Evidence } from "./pages/Evidence.tsx";
import { Emergency } from "./pages/Emergency.tsx";
import { CaseSummary } from "./pages/CaseSummary.tsx";
import { Settings } from "./pages/Settings.tsx";
import { Privacy } from "./pages/Privacy.tsx";

export interface PageProps {
  me: Me;
  onMeChange: (me: Me) => void;
}

/**
 * 路徑對應頁面。圖文選單用 https://liff.line.me/{LIFF_ID}/viewing 這種網址開啟，
 * LIFF 會導到 {Endpoint URL}/viewing。
 */
export const ROUTES: Record<string, ComponentType<PageProps>> = {
  "/": Home,
  "/viewing": ViewingCheck,
  "/viewings": ViewingHistory,
  "/lease": LeaseCheck,
  "/evidence": Evidence,
  "/emergency": Emergency,
  "/case": CaseSummary,
  "/settings": Settings,
  "/privacy": Privacy,
};

/** LIFF 首次開啟時路徑可能在 liff.state 參數裡；這裡取最終路徑 */
export function resolvePath(pathname: string, search = ""): string {
  const state = new URLSearchParams(search).get("liff.state");
  const raw = state ? state.split("?")[0] ?? "/" : pathname;
  const p = raw.replace(/\/+$/, "") || "/";
  return p in ROUTES ? p : "/";
}
