import { useEffect, useState } from "react";
import { api, errorMessage, type Me } from "./api.ts";
import { initLiff, LiffConfigError } from "./liff.ts";
import { ROUTES, resolvePath } from "./router.tsx";

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
    <main className="mx-auto min-h-screen max-w-md bg-gray-50 p-4">
      {state.kind === "loading" && <p className="text-gray-500">載入中…</p>}
      {state.kind === "error" && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.message}</p>}
      {state.kind === "ready" && (
        <Page me={state.me} onMeChange={(me) => setState({ kind: "ready", me })} />
      )}
    </main>
  );
}
