/** 隱私權政策（草稿；正式內容於 Phase 8 依 SPEC 12 完成並請法律背景成員審閱） */
export function Privacy() {
  return (
    <section className="prose-sm">
      <h1 className="text-xl font-bold text-gray-900">隱私權政策（草稿）</h1>
      <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">正式版本準備中，內容可能調整。</p>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-gray-700">
        <li>蒐集項目：LINE 顯示名稱與使用者識別碼、你設定的縣市、你主動提供的問題、照片與檔案，以及看房健檢時你填寫的租屋處名稱或地址與勾選結果（不使用定位）。</li>
        <li>用途：提供租屋法律資訊、看房紀錄與比較、存證與案件摘要功能。</li>
        <li>你的問題與上傳內容會交給 Google Gemini API（付費方案）處理，不會用於訓練模型。</li>
        <li>租約照片分析完成後立即刪除；存證廊檔案保留到你刪除為止。</li>
        <li>你可以在「我的設定」刪除所有資料。</li>
      </ul>
    </section>
  );
}
