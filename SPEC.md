# 租安心（RentSafe）規格書（實作計畫）

版本：2026-11-11
用途：NextWave 2026「AI 法創黑客松」參賽作品。本文件是唯一的規格來源，所有產品與技術決定以本文件為準。

---

## 0. 一頁看懂

**產品**：在 LINE 裡使用的 AI 租屋法律小幫手。使用者加官方帳號好友即可使用，不需下載 App。

**三個階段、六個 MVP 功能**

| 代號 | 功能 | 階段 | 入口 |
| --- | --- | --- | --- |
| F1 | 看房健檢 | 簽約前 | LIFF |
| F2 | 租約健檢（拍照） | 簽約前 | LIFF |
| F3 | 存證廊 | 居住中 | 聊天室收件＋LIFF 瀏覽 |
| F4 | 情境急救包 | 出事時 | 聊天室（Flex Message 引導）＋LIFF |
| F5 | 法條問答 | 全程 | 聊天室 |
| F6 | 案件摘要與轉介 | 出事時 | LIFF 產生，聊天室收到卡片 |

**最重要的原則**：每個法律回答都必須依據自建知識庫、附條文出處，並經程式驗證引用；個案判斷（會不會贏、能求償多少）一律不回答，改為轉介。

**截止日**

| 日期 | 事項 | 開發要求 |
| --- | --- | --- |
| 2026-11-24 | 初賽截圖日 | Phase 0–4 完成（LINE 串接、知識庫、法條問答、看房健檢可用） |
| 2026-11-30 23:59 | 初賽繳件 | 提案書附原型連結與截圖 |
| 2026-12-18 | 功能凍結 | Phase 5–8 完成 |
| 2026-12-20 | 驗證完成 | Phase 9 測試集結果出爐 |
| 2026-12-25 23:59 | 決賽繳件 | 簡報與成品上傳 |
| 2026-12-27 | 決賽 | 現場 Demo |

---

## 1. 技術選擇（已定案）

沿用作者先前「燕食趣」專案的架構，降低風險。

| 層 | 選擇 |
| --- | --- |
| 前端 | React（Vite）＋ TypeScript ＋ Tailwind CSS ＋ LIFF SDK，部署 Firebase Hosting |
| 後端 | Firebase Cloud Functions（2nd gen，Node 22，TypeScript），區域 `asia-east1`（2026-11-12 改：Node 20 runtime 已於 2026-10-30 停用） |
| 資料庫 | Firestore（含向量檢索 `findNearest`） |
| 檔案 | Cloud Storage for Firebase |
| 模型 | Gemini API：對話用 Flash 系列，租約影像用支援圖片的 Flash 系列，嵌入用 Gemini embedding 模型。**模型名稱一律放 `functions/src/config.ts`，不寫死在程式其他地方**，實作時查官方文件取得當下可用名稱 |
| 機密 | Firebase Secret Manager（`defineSecret`） |
| LINE | Messaging API（webhook、reply、Flex Message、圖文選單）、LINE Login＋LIFF |
| 測試 | Vitest（前後端單元測試）、Firebase Emulator Suite（整合測試） |

不使用：任何需要另外架設的向量資料庫、LangChain 等大型框架（流程簡單，自己寫比較好除錯）。

---

## 2. 專案結構

```
rentsafe/
├─ SPEC.md                    # 本文件
├─ CLAUDE.md                  # 給 Claude Code 的工作守則
├─ firebase.json / .firebaserc / firestore.rules / firestore.indexes.json / storage.rules
├─ web/                       # LIFF 前端
│  ├─ src/
│  │  ├─ main.tsx, App.tsx, router.tsx
│  │  ├─ liff.ts              # LIFF 初始化、取得 ID token
│  │  ├─ api.ts               # 呼叫後端（帶 Authorization: Bearer <LIFF ID token>）
│  │  ├─ pages/
│  │  │  ├─ ViewingCheck.tsx  # F1
│  │  │  ├─ LeaseCheck.tsx    # F2
│  │  │  ├─ Evidence.tsx      # F3
│  │  │  ├─ Emergency.tsx     # F4
│  │  │  ├─ CaseSummary.tsx   # F6
│  │  │  ├─ Settings.tsx      # 縣市設定、刪除我的資料
│  │  │  └─ Privacy.tsx       # 隱私權政策
│  │  └─ components/          # LawCitation, Disclaimer, TrafficLight, Checklist …
├─ functions/
│  ├─ src/
│  │  ├─ index.ts             # 匯出所有 functions
│  │  ├─ config.ts            # 模型名稱、檢索參數、限流
│  │  ├─ line/
│  │  │  ├─ webhook.ts        # 簽章驗證、事件分派
│  │  │  ├─ flex.ts           # Flex Message 樣板
│  │  │  └─ richmenu.ts       # 建立圖文選單的腳本
│  │  ├─ api/                 # LIFF 呼叫的 HTTPS endpoints（onRequest＋自寫路由）
│  │  │  ├─ auth.ts           # 驗證 LIFF ID token → userId
│  │  │  ├─ viewing.ts        # F1
│  │  │  ├─ lease.ts          # F2
│  │  │  ├─ evidence.ts       # F3
│  │  │  ├─ emergency.ts      # F4
│  │  │  ├─ caseSummary.ts    # F6
│  │  │  └─ me.ts             # 設定、刪除資料
│  │  ├─ ai/
│  │  │  ├─ orchestrator.ts   # F5 主流程
│  │  │  ├─ safety.ts         # 緊急狀況偵測
│  │  │  ├─ classify.ts       # 情境、縣市、房東類型判斷
│  │  │  ├─ retrieve.ts       # 向量檢索＋縣市過濾
│  │  │  ├─ generate.ts       # 生成回答（JSON 輸出）
│  │  │  ├─ citeCheck.ts      # 引用驗證
│  │  │  ├─ referral.ts       # 轉介判斷與名單
│  │  │  └─ prompts/          # 每個 prompt 一個 .ts 檔，含版本號
│  │  ├─ lease/
│  │  │  ├─ extract.ts        # 影像 → 結構化欄位
│  │  │  ├─ rules.ts          # 數值規則引擎
│  │  │  ├─ semantic.ts       # 語意條款比對
│  │  │  └─ pii.ts            # 個資遮蔽
│  │  └─ kb/
│  │     ├─ ingest.ts         # 匯入法規、切片、嵌入、寫入 Firestore
│  │     └─ sources.ts        # 要匯入的法規清單
│  └─ test/
├─ kb/                        # 知識庫原始資料（版本控制）
│  ├─ laws/                   # 從全國法規資料庫下載的條文 JSON
│  ├─ local/                  # 縣市自治條例摘錄（手動整理，附來源網址與日期）
│  ├─ contract-rules.yaml     # 定型化契約應記載／不得記載事項規則
│  ├─ viewing-checklist.yaml  # 看房健檢清單
│  ├─ emergency-flows.yaml    # 情境急救包流程
│  └─ referrals.yaml          # 轉介名單
├─ eval/
│  ├─ questions.seed.jsonl    # 測試題（初稿，需法律背景成員複核）
│  ├─ run-eval.ts             # 跑測試集、輸出指標
│  └─ results/
└─ demo/
   ├─ sample-lease.pdf        # 埋好問題的示範租約
   └─ demo-script.md
```

---

## 3. 資料模型（Firestore）

所有使用者資料都放在 `users/{lineUserId}` 底下，方便一鍵刪除。

```
users/{uid}
  displayName: string
  city: string | null            # 例：「新北市」，用於縣市過濾
  landlordType: "individual" | "business" | "unknown"
  createdAt, updatedAt
  consentAt: Timestamp | null    # 同意隱私權政策的時間

users/{uid}/evidence/{id}        # F3 存證廊
  type: "photo" | "chat" | "note" | "document"
  category: "repair" | "rent" | "dispute" | "safety" | "other"
  text: string                   # 使用者描述或 OCR 摘要（已遮蔽個資）
  storagePath: string | null     # Cloud Storage 路徑
  occurredAt: Timestamp          # 事件發生時間（預設＝收到時間，可修改）
  createdAt: Timestamp           # 系統收到時間（不可改，作為證據時間戳）
  sha256: string | null          # 檔案雜湊，證明未被修改

users/{uid}/viewings/{id}        # F1 結果
  label: string                  # 使用者填的租屋處名稱或地址（選填，未填自動命名「縣市＋房型＋日期」）
  city, housingType, answers: map, score: number, redFlags: string[], questions: string[], createdAt

users/{uid}/leaseChecks/{id}     # F2 結果（不存原圖）
  fields: map                    # 抽出的欄位（已遮蔽）
  findings: Finding[]            # {ruleId, level: "red"|"yellow"|"green", title, explanation, citations[]}
  createdAt

users/{uid}/cases/{id}           # F4/F6
  scenario: "fire" | "leak" | "no_repair" | "deposit" | "early_termination" | "other"
  answers: map, checklistDone: string[], summary: CaseSummary | null, createdAt, updatedAt

users/{uid}/qa/{id}              # F5 紀錄（供除錯與評估；使用者可刪）
  question, answer, citations[], referred: boolean, latencyMs, promptVersion, createdAt

kb_chunks/{id}                   # 知識庫（只有後端可讀寫）
  lawName: string                # 「民法」
  pcode: string | null           # 全國法規資料庫代碼
  article: string                # 「第 424 條」
  articleNo: string              # 「424」或「6-1」
  text: string                   # 條文全文
  plain: string                  # 白話說明（人工撰寫或審過的 AI 草稿）
  scope: "national" | string     # "national" 或縣市名
  tags: string[]                 # ["修繕","終止","火災"…]
  sourceUrl: string
  updatedAt: string              # 法規最後修正日期
  fetchedAt: Timestamp
  embedding: Vector              # Firestore vector
```

`firestore.rules`：全部 `allow read, write: if false;`。所有存取都經過 Cloud Functions（Admin SDK）。
`storage.rules`：同上，全部拒絕；前端上傳一律經由後端產生的簽名網址，或直接傳給後端。

---

## 4. 系統流程

### 4.1 LINE 入口

- **圖文選單（6 格）**：看房健檢｜租約健檢｜存證廊｜出事了｜問法條｜我的設定。前四格與「我的設定」開 LIFF 對應頁；「問法條」送出一則提示訊息，引導使用者直接打字提問。
- **加好友（follow 事件）**：回一張歡迎卡片，說明三個階段、免責聲明、隱私權政策連結，並請使用者選縣市（Quick Reply：臺北、新北、桃園、臺中、臺南、高雄、其他）。
- **文字訊息**：進 F5 法條問答。
- **圖片、檔案訊息**：存進 F3 存證廊，回覆「已存證」卡片（含時間戳），並提供「改分類」按鈕。
- **unfollow**：標記停用，不再推播。
- **回覆一律用 reply token**（不吃推播額度）。push 只用於非同步完成的工作（例如租約健檢跑完），且每位使用者每天上限 3 則。

### 4.2 LIFF 呼叫後端

- 前端 `liff.getIDToken()` → 每個請求帶 `Authorization: Bearer <idToken>`。
- 後端 `api/auth.ts` 呼叫 LINE 的 verify endpoint 驗證 ID token，取得 `sub` 作為 uid。**不相信前端傳的 userId。**
- 所有 endpoint 都要限流：每位使用者每分鐘 10 次、每天 F5 問答 50 次、F2 租約健檢 10 次。

---

## 5. F5 法條問答（核心，先做）

### 5.1 流程

```
使用者訊息
 → safety.ts：緊急狀況？（現在著火、有人受傷、被威脅、被鎖在門外…）
      是 → 回固定訊息：先撥 119／110，確保安全；附「出事了」急救包按鈕。結束。
 → classify.ts（一次 LLM 呼叫，JSON 輸出）
      { scenario, city | null, landlordType, needsClarification: string | null, asksOutcome: boolean }
      needsClarification 有值 → 用 Quick Reply 反問一句（例如「租屋在哪個縣市？」）。結束。
 → retrieve.ts：以問題嵌入向量檢索 kb_chunks，
      過濾 scope ∈ {"national", city}，取前 8 筆；另外依 scenario 必帶的條文（見 5.3）補進去。
 → generate.ts（一次 LLM 呼叫，JSON 輸出，見 5.2）
 → citeCheck.ts：驗證 citations
      失敗 → 用「只能引用以下條號」的更嚴格 prompt 重試 1 次；仍失敗 → 移除未驗證的引用，並在回答末尾加註「部分內容未能對應條文，請洽專業人士確認」。
 → referral.ts：asksOutcome 為真、或 scenario 屬於高風險（fire、early_termination、deposit 金額 > 2 萬）→ 附轉介卡片。
 → 組成 Flex Message 回覆：結論、依據條文（可點開原文）、你可以做的事、建議洽詢、免責聲明。
```

### 5.2 生成的輸出格式（模型必須輸出 JSON）

```json
{
  "summary": "白話結論，2–3 句，不得出現「一定」「保證」「勝訴」",
  "citations": [
    { "lawName": "民法", "articleNo": "424", "quote": "條文中支撐結論的關鍵句，必須逐字出自條文" }
  ],
  "actions": ["可以做的具體步驟，最多 4 項"],
  "evidence": ["建議保留的證據，最多 4 項"],
  "referTo": ["legal_aid" | "tmm" | "mediation" | "consumer" | "none"],
  "confidence": "high" | "medium" | "low"
}
```

Prompt 要點（放 `ai/prompts/answer.v1.ts`）：
- 角色：協助台灣租屋族理解法律資訊的助理，不是律師。
- 只能根據提供的條文片段回答；片段不足以回答時 `confidence: "low"` 並建議轉介。
- 不得預測訴訟結果、不得估算賠償金額、不得建議公開房東個資。
- 語言：繁體中文、台灣用語、國中生看得懂。
- 必須區分「全國規定」與「該縣市規定」。

### 5.3 引用驗證規則（`citeCheck.ts`，要有單元測試）

1. 每個 citation 的 `(lawName, articleNo)` 必須存在於本次檢索結果中。
2. `quote` 必須是該條文 `text` 的子字串（比對前移除全形／半形空白）。
3. `summary` 與 `actions` 內出現的「第 X 條」字樣（正則：`第\s*([0-9０-９]+(?:之[0-9０-９]+|-[0-9]+)?)\s*條`）也必須能對應到 citations。
4. 任一條不通過 → 驗證失敗。

**情境必帶條文**（確保檢索不漏）：

| scenario | 必帶 |
| --- | --- |
| fire | 民法 423、424、434；消防法 6；該縣市住警器規定 |
| no_repair / leak | 民法 423、429、430 |
| deposit | 租賃條例 7；定型化契約押金相關條目 |
| early_termination | 民法 450、453；定型化契約提前終止條目 |
| sold_house | 民法 425 |
| rent_arrears | 民法 440 |

（條號以實際匯入結果為準；若有出入，以法律背景成員複核後的版本為準，並更新此表。）

---

## 6. 知識庫（Phase 2）

### 6.1 來源

| 來源 | 內容 | 取得方式 |
| --- | --- | --- |
| 民法 債編 租賃（第 421–463-1 條） | 核心權利義務 | 全國法規資料庫開放資料（JSON），以 `ingest.ts` 下載並過濾條號 |
| 租賃住宅市場發展及管理條例 | 租賃專法 | 同上，全條 |
| 消防法 第 6 條 | 住警器設置義務 | 同上 |
| 鄉鎮市調解條例（重點條文） | 調解程序 | 同上 |
| 住宅租賃定型化契約應記載及不得記載事項 | F2 規則來源 | 手動整理成 `kb/contract-rules.yaml`，每條附官方網址 |
| 六都火災預防自治條例（住警器相關條文與公告） | 縣市規定 | 手動整理成 `kb/local/*.md`，每份附來源網址與查證日期 |

實作前先到全國法規資料庫確認各法規的 pcode 與開放資料下載格式，記在 `kb/sources.ts`。**不得用模型記憶補條文內容。**

### 6.2 切片與嵌入

- 一個條文 = 一個 chunk（條文很短，不需再切）。
- 嵌入內容 = `「{lawName} 第 {articleNo} 條」＋ 條文 ＋ plain（白話）＋ tags`。
- `plain` 白話說明：先用模型產生草稿 → 存成 `kb/plain/*.yaml` → 法律背景成員審過才標記 `reviewed: true`。未審過的不顯示給使用者，只用於檢索。
- 建立 Firestore 向量索引（`firestore.indexes.json`）：`kb_chunks.embedding`，維度依嵌入模型。
- `npm run kb:ingest` 可重跑；以 `(lawName, articleNo, scope)` 為鍵覆寫。輸出變更報告（新增、修改、刪除幾條）。

### 6.3 縣市住警器規定（`kb/local/`）

目前已查到、需在實作時再次核對來源的資料：

| 縣市 | 規定重點 | 來源 |
| --- | --- | --- |
| 新北市 | 2026 年修正後擴大至全市「供居住使用建築物」應設住警器；未設置或維護可罰 6 千至 3 萬元 | 聯合新聞網 2026-06 報導；新北市消防局 |
| 高雄市 | 2025-09-01 起一般住宅（含透天、公寓等五樓以下住宅）應設住警器；最高罰 3 萬元 | 高雄市火災預防自治條例 |
| 臺南市 | 出租住宅場所經公告應設住警器；限期不改善可罰 6 千至 3 萬元 | 臺南市消防局公告（自由時報報導） |
| 臺北市 | 火災預防自治條例要求出租住宅設置住警器 | 臺北市火災預防自治條例（需查證現行條文） |
| 桃園市、臺中市 | 待查 | — |

任何「待查」的縣市，系統回答時只說全國規定，並建議洽當地消防局確認。

---

## 7. F1 看房健檢（Phase 4）

- 輸入：縣市（預設帶使用者設定）、房型（整層、獨立套房、分租套房、雅房、頂樓加蓋、地下室）、清單勾選、可選拍照（照片存進存證廊，分類 safety）。
- 清單放 `kb/viewing-checklist.yaml`，每題有：`id, question, why（為什麼重要）, weight（1–3）, redFlagIf（哪個答案是紅燈）, citations（可空）, askLandlord（要問房東的話）`。
- 題目範圍（至少 15 題）：住警器、滅火器、逃生路線與第二出口、鐵窗是否可開、隔間材質（木板／鐵皮）、電線與插座、瓦斯熱水器位置與通風、是否頂加或違建、建物登記用途、房東是否為所有權人或二房東、能否申請租金補貼與設籍、押金與租金、電費計價、修繕責任、是否提供定型化契約。
- 輸出：安全分數（0–100）、紅燈清單、當地住警器規定、「要問房東的 5 個問題」。可一鍵把問題複製成訊息。
- 純規則計分，不呼叫模型（快、穩、可重現）。
- 租屋處名稱或地址：選填文字欄位（最多 60 字），不使用定位；未填自動命名「縣市＋房型＋日期」。
- 看房紀錄與比較（2026-11-12 新增）：「我的看房紀錄」列出每間的名稱、分數、紅燈數、日期；點開看當時結果；勾選 2–3 間並排比較分數、紅燈與各題答案差異。結果以儲存的回答依現行清單重新計算。

---

## 8. F2 租約健檢（Phase 5）

### 8.1 流程

```
LIFF 上傳 1–6 張租約照片（或 PDF）
 → 後端暫存（Storage 的 tmp/，24 小時 lifecycle 自動刪）
 → extract.ts：模型讀圖，輸出結構化欄位 JSON（見 8.2）＋每個欄位的原文片段
 → pii.ts：遮蔽身分證字號（/[A-Z][12][0-9]{8}/）、手機（/09\d{2}-?\d{3}-?\d{3}/）、地址門牌、姓名欄位
 → rules.ts：數值規則
 → semantic.ts：語意條款比對（只送遮蔽後的條款文字）
 → 合併成 findings，存 leaseChecks，**刪除原圖**
 → 若處理超過 10 秒：先回「分析中」，完成後 push 一張結果卡片
```

### 8.2 抽取欄位

`monthlyRent, deposit, depositMonths（計算）, leaseStart, leaseEnd, reviewPeriodDays, electricityRule（文字）, electricityPricePerKwh, waterRule, managementFee, repairClause（文字）, earlyTerminationClause（文字）, earlyTerminationPenalty（數字或月數）, taxClause（文字）, subsidyOrRegistrationClause（文字）, otherClauses: string[]`

### 8.3 規則（`kb/contract-rules.yaml`，每條附 `source` 官方網址；實作時以最新官方版本逐條核對）

| ruleId | 檢查 | 類型 | 判定 |
| --- | --- | --- | --- |
| deposit_max | 押金不超過 2 個月租金 | 數值 | 超過 → 紅 |
| electricity_cap | 分租電費每度不超過台電當期最高級距 | 數值 | 超過 → 紅；未載明 → 黃。台電級距存 `config`，附來源與日期 |
| review_period | 契約審閱期 | 數值／語意 | 約定拋棄審閱期 → 黃 |
| early_termination_penalty | 提前終止違約金上限 | 數值 | 超過官方範本上限 → 紅 |
| tax_burden | 房屋稅、地價稅由出租人負擔 | 語意 | 約定由承租人負擔 → 紅 |
| deposit_waiver | 不得約定拋棄押金返還請求權 | 語意 | 有 → 紅 |
| repair_all_tenant | 修繕全部由承租人負擔 | 語意 | 有 → 黃（說明民法 429 原則與可另約定） |
| subsidy_ban | 不得約定承租人不得申報租賃費用支出 | 語意 | 有 → 紅 |
| missing_fields | 必要欄位缺漏（租期、租金、押金、修繕） | 規則 | 缺 → 黃 |

每個 finding 顯示：燈號、白話說明、依據（條文或官方規定連結）、「可以怎麼跟房東談」。

---

## 9. F3 存證廊（Phase 6）

- 聊天室收到圖片／檔案／以「#存證」開頭的文字 → 存一筆 evidence，計算 sha256，回覆時間戳卡片。
- LIFF 時間軸：依 occurredAt 排序，可篩分類、加描述、改發生時間（createdAt 不可改，兩者都顯示）。
- 匯出：產生「證據清單」PDF（時間、類型、描述、雜湊值、縮圖），匯出前顯示個資與誹謗風險提醒。
- 不提供刪除單筆以外的修改原檔功能（保持證據完整）。

---

## 10. F4 情境急救包（Phase 7）

- 流程放 `kb/emergency-flows.yaml`。每個情境分四段：**現在**、**今天**、**本週**、**下一步**，每段是清單項目，可勾選，勾選狀態存 `cases`。
- 首批情境：fire（決賽主軸，最完整）、no_repair、leak、deposit、early_termination。
- fire 內容（實作時與法律背景成員核對）：
  - 現在：確認人身安全、撥 119、就醫並保留單據。
  - 今天：拍攝現場與損失物品；保存租約、房東對話、繳租紀錄（直接存進存證廊）。
  - 本週：向消防局申請火災相關證明文件；查詢當地住警器規定；了解民法 423、424、434 條。
  - 下一步：產生案件摘要（F6）；法扶專線；區公所調解。
- 每段可以「問這一步」→ 帶情境進 F5。

---

## 11. F6 案件摘要與轉介（Phase 7）

- 輸入：cases 的答案、勾選、相關 evidence、F5 問答紀錄。
- 輸出（一頁）：基本事實（時間、地點縣市、房東類型）、時間軸、已有證據、可能相關條文（只列 citeCheck 通過的）、使用者想要的結果、尚缺資料。**不寫勝敗評估。**
- 產生 PDF ＋ 可複製文字，方便打電話或帶去調解時使用。
- 轉介名單（`kb/referrals.yaml`，每筆附來源與查證日期）：

| 代號 | 單位 | 聯絡 | 備註 |
| --- | --- | --- | --- |
| legal_aid | 法扶基金會 住宅租賃糾紛諮詢專線 | 市話 412-8518（手機加 02），撥通後轉 2 再轉 6；週一至週五 9:00–12:30、13:30–17:00 | 免費，律師諮詢 |
| tmm | 崔媽媽基金會 | 網路搜尋「崔媽媽好搬法」預約；電話 02-2365-8140 | 預約後約 5 個工作天回電 |
| mediation | 戶籍地或租屋地區公所調解委員會 | 各區公所 | 免費；成立經法院核定有執行力 |
| dispute_board | 縣市不動產糾紛調處委員會 | 各縣市地政局 | 住宅租賃爭議可申請調處 |
| consumer | 消費者服務專線 1950 | 1950 | 房東為業者（包租代管、二房東業者）時適用 |
| emergency | 119／110 | — | 緊急狀況 |

---

## 12. 安全、隱私、法遵

- 每則法律回答下方固定顯示：「本服務提供法律資訊，不是法律意見；個案請洽法扶專線或律師。」
- 第一次使用 LIFF 須同意隱私權政策（`Privacy.tsx`），記錄 `consentAt`。內容：蒐集項目、用途、交給 Gemini 處理、保存期間、刪除方式。
- 「刪除我的資料」：刪除 `users/{uid}` 底下所有子集合與 Storage 檔案，回覆確認卡片。
- 原始租約影像分析完即刪；存證廊檔案保留到使用者刪除。
- Gemini 使用付費方案的 API（資料不用於訓練），在隱私權政策說明。
- Webhook 必須驗證 `x-line-signature`；所有金鑰放 Secret Manager；不進 Git。
- 不提供任何「公開房東資訊」的功能；匯出證據時提醒個資法與誹謗風險。
- 成本控管：Google Cloud 預算提醒（每月 NT$300）；Gemini 每日請求上限；限流（見 4.2）。

---

## 13. 開發階段與驗收條件

每個 Phase 完成時：測試全過、部署到正式環境、在本文件末「進度紀錄」寫一行。**未通過驗收不進下一個 Phase。**

| Phase | 內容 | 驗收條件 | 目標日 |
| --- | --- | --- | --- |
| 0 基礎建置 | monorepo、Firebase 專案、Emulator、CI（lint＋test）、Secrets 設定 | `npm test` 通過；emulator 可啟動 | 11/13 |
| 1 LINE 串接 | webhook、簽章驗證、follow 歡迎卡、縣市 Quick Reply、圖文選單腳本、LIFF 登入＋ID token 驗證 | 手機加好友收到歡迎卡；點圖文選單能開 LIFF 並顯示名稱 | 11/15 |
| 2 知識庫 | `kb:ingest`、民法租賃章＋租賃條例＋消防法 6 條入庫、向量索引、六都住警器摘錄 | 任意輸入能檢索出相關條文；變更報告正確 | 11/18 |
| 3 法條問答 | safety、classify、retrieve、generate、citeCheck、referral、Flex 回覆 | citeCheck 單元測試全過；`eval/questions.seed.jsonl` 引用正確率 ≥ 80%（初版） | 11/22 |
| 4 看房健檢 | F1 全功能 | 新北頂加範例能產出紅燈與住警器規定 | 11/24 |
| — | **初賽截圖與錄影** | 截 3–5 張真實畫面放進提案書 | 11/25–29 |
| 5 租約健檢 | F2 全流程、個資遮蔽、原圖刪除 | `demo/sample-lease.pdf` 能標出押金、電費、稅負三個紅燈；遮蔽測試全過 | 12/8 |
| 6 存證廊 | F3 收件、時間軸、匯出 PDF | 傳圖後 3 秒內收到時間戳卡；PDF 含雜湊值 | 12/11 |
| 7 急救包＋摘要 | F4 五個情境、F6 摘要 PDF 與轉介 | 火災情境從頭走到摘要不卡關 | 12/16 |
| 8 收尾 | 刪除我的資料、隱私權政策、限流、錯誤頁、載入狀態 | 刪除後 Firestore 與 Storage 無殘留 | 12/18 |
| 9 驗證 | 50 題測試集、對照組（直接問通用模型、無檢索）、試用問卷 | 產出 `eval/results/` 報告與圖表 | 12/20 |

---

## 14. 評估（Phase 9）

- 測試題格式（JSONL，一行一題）：

```json
{"id":"q001","question":"…","city":"新北市","expectedArticles":[{"lawName":"民法","articleNo":"424"}],"mustRefer":false,"notes":"…","reviewedBy":null}
```

- `npm run eval` 對每題跑完整流程，計算：
  - **引用正確率**：回答 citations 與 expectedArticles 的交集 ÷ expectedArticles（recall）以及 citations 中正確的比例（precision）。
  - **幻覺率**：citeCheck 前，模型輸出中引用不存在條號的比例。
  - **轉介正確率**：mustRefer 題目被轉介的比例。
  - **延遲**：P50、P95。
- 對照組：同一模型、同一題目、**不給檢索片段**，只要求「附條號回答」。比較兩者幻覺率與引用正確率。這是決賽最有說服力的一張圖。
- 測試題由法律背景成員擴充到 50 題並填 `reviewedBy`；未複核的題目不計入最終報告。

---

## 15. Demo 準備（Phase 9 後）

- `demo/sample-lease.pdf`：虛構房東與房客，埋入押金 3 個月、每度電 7 元、房屋稅由承租人負擔、修繕全由承租人負擔。
- 準備一個 Demo 用 LINE 帳號，預先存好存證廊資料（虛構）。
- 錄一支完整操作的螢幕錄影，現場網路失敗時切換。
- `demo/demo-script.md`：對應決賽簡報 2:30–6:30 的三段 Demo。

---

## 16. 開發前使用者要準備的東西

- [ ] LINE Developers：新 Provider、Messaging API 頻道（取得 Channel secret、Channel access token）
- [ ] LINE Developers：LINE Login 頻道，新增 LIFF app（Size: Full，Scope: profile, openid），Endpoint 填 Firebase Hosting 網址
- [ ] Firebase：新專案，升級 Blaze，設定預算提醒
- [ ] Google AI Studio 或 Vertex：Gemini API 金鑰（付費方案）
- [ ] 本機：Node.js 22、Firebase CLI、Git、GitHub repo

---

## 17. 進度紀錄

（每完成一個 Phase 加一行：日期｜Phase｜結果｜備註）

- 2026-11-12｜Phase 0｜`npm run ci` 通過（lint、typecheck、7 個測試、build）；emulator 可啟動，`/api/health` 回 200｜Functions 改用 Node 22；尚未部署與設定 Secrets（等 Firebase 正式專案建好）
- 2026-11-12｜Phase 1｜**已驗收**：部署到 rentsafe-eed02，手機加好友收到歡迎卡、選縣市寫入成功，圖文選單開 LIFF 正常（/api 無錯誤紀錄）｜webhook 簽章、follow 歡迎卡＋縣市 Quick Reply、unfollow、圖文選單、LIFF 登入＋ID token 驗證、/api/me、每分鐘限流。注意：LINE Login 頻道須 Publish，否則非管理員帳號開 LIFF 會 400；Storage 尚未開通，存證廊（Phase 6）前要在 Console 啟用
- 2026-11-12｜Phase 2｜**部分驗收**：137 條已匯入 rentsafe-eed02（重跑顯示全部未變動），向量檢索正常｜**未完成**：六都住警器摘錄（kb/local 六個檔案仍為「待查」，需從市府官方法規逐字複製）
- 2026-11-12｜Phase 3｜**已驗收（初版）**：eval 12 題引用正確率 100%、精確率 76.4%、幻覺率 0%、轉介正確率 100%，延遲 P50 17.5 秒／P95 30.7 秒（`eval/results/2026-11-12T07-02-51-512Z.md`）｜驗收時修正：模型的 referTo 不能單獨觸發轉介（原本 12 題全被轉介）；問勝敗／求償時不反問、直接轉介。citeCheck 另外檢查國字條號。題庫尚未經人工複核（reviewedBy 皆為 null）
- 2026-11-12｜Phase 4｜程式完成並部署，自動測試通過驗收範例（新北市頂樓加蓋 → 紅燈＋新北住警器規定），**待手機實機確認**｜`kb/viewing-checklist.yaml` 18 題（引用只來自 kb/laws，測試檢查）、純規則計分、`/api/viewing`、LIFF 頁面；新北市火災預防自治條例第 5、14 條已從新北市法規系統逐字匯入（官方現行版本 111-04-27，SPEC 6.3 所稱 2026 年修正查無）；拍照存證留待 Phase 6
- 2026-11-12｜Phase 4 追加｜看房健檢加「租屋處名稱或地址」（選填，不用定位）、「我的看房紀錄」、2–3 間並排比較；已部署，**待手機實機確認**｜`GET /api/viewing/history`、`POST /api/viewing/detail`（只能讀自己的紀錄）、`web/src/pages/ViewingHistory.tsx`；隱私政策草稿補上蒐集項目
