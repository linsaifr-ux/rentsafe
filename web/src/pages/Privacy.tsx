import { Bot, Database, FileX2, Target, Trash2, type LucideIcon } from "lucide-react";
import { Card, IconBadge, Notice, PageHeader } from "../components/ui.tsx";

const ITEMS: Array<{ icon: LucideIcon; title: string; text: string }> = [
  {
    icon: Database,
    title: "蒐集項目",
    text: "LINE 顯示名稱與使用者識別碼、你設定的縣市、你主動提供的問題、照片與檔案，以及看房健檢時你填寫的租屋處名稱或地址與勾選結果（不使用定位）。",
  },
  { icon: Target, title: "用途", text: "提供租屋法律資訊、看房紀錄與比較、存證與案件摘要功能。" },
  { icon: Bot, title: "AI 處理", text: "你的問題與上傳內容會交給 Google Gemini API（付費方案）處理，不會用於訓練模型。" },
  { icon: FileX2, title: "保存期間", text: "租約照片分析完成後立即刪除；存證廊檔案保留到你刪除為止。" },
  { icon: Trash2, title: "刪除", text: "你可以在「我的設定」刪除所有資料。" },
];

/** 隱私權政策（草稿；正式內容於 Phase 8 依 SPEC 12 完成並請法律背景成員審閱） */
export function Privacy() {
  return (
    <section className="animate-enter">
      <PageHeader title="隱私權政策（草稿）" back="/settings" />
      <Notice className="mt-0">正式版本準備中，內容可能調整。</Notice>
      <ul className="stagger mt-3 space-y-3">
        {ITEMS.map((it) => (
          <li key={it.title}>
            <Card className="flex gap-3">
              <IconBadge icon={it.icon} tone="sky" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-900">{it.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{it.text}</p>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
