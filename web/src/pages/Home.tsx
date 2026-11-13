import type { PageProps } from "../router.tsx";
import { Disclaimer } from "../components/Disclaimer.tsx";
import { NavCard } from "../components/ui.tsx";

const LINKS = [
  { href: "/viewing", icon: "🔍", title: "看房健檢", desc: "看房時逐項檢查，找出安全紅燈" },
  { href: "/viewings", icon: "📋", title: "我的看房紀錄", desc: "看房、租約健檢結果都在這，可以比較" },
  { href: "/lease", icon: "📄", title: "租約健檢", desc: "拍租約，幫你找出不合理條款" },
  { href: "/evidence", icon: "📸", title: "存證廊", desc: "照片、對話依時間整理成證據" },
  { href: "/emergency", icon: "🆘", title: "出事了", desc: "火災、漏水、押金爭議，一步步處理" },
  { href: "/settings", icon: "⚙️", title: "我的設定", desc: "租屋縣市、刪除我的資料" },
];

export function Home({ me }: PageProps) {
  return (
    <section>
      <h1 className="text-2xl font-bold text-emerald-700">租安心</h1>
      <p className="mt-1 text-lg text-gray-800">你好，{me.displayName || "朋友"}！</p>
      <p className="text-sm text-gray-500">租屋縣市：{me.city ?? "尚未設定"}</p>
      <ul className="mt-4 space-y-3">
        {LINKS.map((l) => (
          <li key={l.href}>
            <NavCard {...l} />
          </li>
        ))}
      </ul>
      <Disclaimer />
    </section>
  );
}
