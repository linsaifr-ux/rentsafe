import type { PageProps } from "../router.tsx";
import { Disclaimer } from "../components/Disclaimer.tsx";

const LINKS = [
  { href: "/viewing", label: "🔍 看房健檢", desc: "看房時逐項檢查，找出安全紅燈" },
  { href: "/lease", label: "📄 租約健檢", desc: "拍租約，幫你找出不合理條款" },
  { href: "/evidence", label: "📸 存證廊", desc: "照片、對話依時間整理成證據" },
  { href: "/emergency", label: "🆘 出事了", desc: "火災、漏水、押金爭議，一步步處理" },
  { href: "/settings", label: "⚙️ 我的設定", desc: "租屋縣市、刪除我的資料" },
];

export function Home({ me }: PageProps) {
  return (
    <section>
      <h1 className="text-2xl font-bold text-emerald-700">租安心</h1>
      <p className="mt-1 text-gray-700">你好，{me.displayName || "朋友"}！</p>
      <p className="text-sm text-gray-500">租屋縣市：{me.city ?? "尚未設定"}</p>
      <ul className="mt-4 space-y-2">
        {LINKS.map((l) => (
          <li key={l.href}>
            <a href={l.href} className="block rounded-lg border border-gray-200 bg-white p-3 active:bg-gray-50">
              <span className="font-semibold text-gray-900">{l.label}</span>
              <span className="block text-xs text-gray-500">{l.desc}</span>
            </a>
          </li>
        ))}
      </ul>
      <Disclaimer />
    </section>
  );
}
