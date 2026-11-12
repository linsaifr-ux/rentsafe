# 租安心（RentSafe）

在 LINE 裡使用的 AI 租屋法律小幫手：看房健檢、租約健檢、存證廊、情境急救包、法條問答、案件摘要與轉介。NextWave 2026 AI 法創黑客松參賽作品。

**開始任何工作前，先讀 `SPEC.md`。** 它是唯一的規格來源。規格要改時，先問我，確認後同步更新 `SPEC.md`。

## 工作方式

- 依 `SPEC.md` 第 13 節的 Phase 順序開發。一次只做一個 Phase；完成驗收條件、測試全過、部署後，在 `SPEC.md` 第 17 節寫一行進度，再問我要不要進下一個 Phase。
- 每個 Phase 開始前，先用 3–5 行告訴我這個 Phase 要建立或修改哪些檔案，再動手。
- 需要我在外部平台操作的事（LINE Developers、Firebase Console、設定 Secret），列成清單請我做，不要假設已經完成。
- 時程很緊：初賽截圖日 11/24、決賽繳件 12/25。遇到要花超過半天的技術選擇，先問我。

## 法律內容的鐵則

- **條文內容只能來自 `kb/` 與全國法規資料庫的官方資料，絕對不可以用模型記憶補條文或條號。** 找不到官方來源就標「待查」，不要猜。
- 每個給使用者看的法律說明都要有出處（法規名稱＋條號或官方網址）。
- 系統不得預測訴訟勝敗、不得估算賠償金額、不得鼓勵公開房東個資。
- 每則法律回答都要附免責聲明（文字見 `SPEC.md` 第 12 節）。
- `citeCheck.ts` 是核心元件，必須有完整單元測試；改動它要先讓我知道。

## 程式慣例

- TypeScript strict。前端 React＋Vite＋Tailwind；後端 Firebase Cloud Functions 2nd gen，區域 `asia-east1`。
- 模型名稱、檢索參數、限流數字一律放 `functions/src/config.ts`。Gemini 模型名稱更新很快，實作時查官方文件確認當下可用的名稱。
- 所有 LLM 呼叫要求 JSON 輸出，並用 zod 驗證；驗證失敗重試 1 次。
- Prompt 放 `functions/src/ai/prompts/`，檔名帶版本（`answer.v1.ts`），回答紀錄存 `promptVersion`。
- Firestore 與 Storage 規則全部拒絕；所有存取經 Cloud Functions。前端不直接連 Firestore。
- 後端一律驗證 LIFF ID token 與 LINE webhook 簽章，不相信前端傳來的 userId。
- 金鑰只放 Secret Manager，不進 Git，不寫在前端。
- 回覆 LINE 訊息優先用 reply token；push 只用於非同步結果，且受每日上限限制。
- 介面文字一律繁體中文、台灣用語，對象是第一次租屋的大學生。

## 常用指令

- `npm run ci`：lint＋typecheck＋test＋build（與 GitHub Actions 相同）
- `npm test`：前後端 Vitest
- `npm run emulators`：build functions 後啟動 Emulator Suite（專案 `demo-rentsafe`，UI 在 http://127.0.0.1:4000，Hosting 在 :5050）。需要 Java 21：`export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"`；假的金鑰在 `functions/.secret.local`、`functions/.env.demo-rentsafe`
- `npm run dev -w web`：Vite 開發伺服器（`/api` 轉到 Hosting emulator）
- `npm run kb:fetch`：從全國法規資料庫下載條文到 `kb/laws/`（下載後用 git diff 檢查）
- `npm run kb:ingest -- --dry-run`：只看變更報告；`GEMINI_API_KEY=… npm run kb:ingest` 正式匯入；emulator 測試可用 `--fake-embed`
- `GEMINI_API_KEY=… npm run eval`：跑 `eval/questions.seed.jsonl`，結果寫到 `eval/results/`
- `LINE_CHANNEL_ACCESS_TOKEN=… LIFF_ID=… npm run richmenu -w functions`：建立並套用圖文選單（圖檔 `functions/assets/richmenu.jpg`，原稿 `.svg`）
- `npm run deploy`：build 後部署（需先在 `.firebaserc` 填正式專案 ID、建立 `functions/.env.<專案ID>`）
