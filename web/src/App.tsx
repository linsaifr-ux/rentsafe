import { useEffect, useState } from "react";
import { api, errorMessage, type Me } from "./api.ts";
import { initLiff, LiffConfigError } from "./liff.ts";
import { ROUTES, resolvePath } from "./router.tsx";
import { ShieldCheck } from "lucide-react";
import { Notice } from "./components/ui.tsx";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; me: Me };

export interface AppProps {
  /** 測試時可注入；預設初始化 LIFF 後呼叫 /api/me */
  load?: () => Promise<Me>;
  path?: string;
}

async function defaultLoad(): Promise<Me> {
  await initLiff();
  return api.me();
}

export default function App({ load = defaultLoad, path }: AppProps) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const route = path ?? resolvePath(window.location.pathname, window.location.search);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((me) => !cancelled && setState({ kind: "ready", me }))
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof LiffConfigError ? err.message : errorMessage(err);
        setState({ kind: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const Page = ROUTES[route] ?? ROUTES["/"]!;

  return (
    <main className="mx-auto min-h-dvh max-w-md bg-slate-50 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      {state.kind === "loading" && <Splash />}
      {state.kind === "error" && (
        <div className="pt-6">
          <Notice tone="red">{state.message}</Notice>
        </div>
      )}
      {state.kind === "ready" && <Page me={state.me} onMeChange={(me) => setState({ kind: "ready", me })} />}
    </main>
  );
}

/** 開啟時的品牌畫面 */
function Splash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center" role="status" aria-label="載入中">
      <span className="flex size-20 animate-pop items-center justify-center rounded-[28px] bg-gradient-to-br from-emerald-500 to-teal-600 shadow-brand">
        <ShieldCheck className="size-10 text-white" strokeWidth={1.8} aria-hidden="true" />
      </span>
      <p className="mt-5 animate-enter text-lg font-bold tracking-wide text-slate-900">租安心</p>
      <span className="mt-6 flex gap-1.5" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-2 animate-bounce rounded-full bg-emerald-500" style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </span>
    </div>
  );
}
