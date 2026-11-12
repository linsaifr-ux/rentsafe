# 縣市住警器規定（kb/local）

每個縣市一個 `.md` 檔，格式見 `functions/src/kb/local.ts` 開頭註解。

**規則**
- 條文必須**逐字**從官方來源（縣市法規查詢系統、消防局公告）複製，附 `sourceUrl` 與查證日期 `checkedAt`。
- 不得用 AI 或記憶補條文。查不到官方原文就維持 `status: pending`。
- 只有 `status: verified` 的檔案會被 `npm run kb:ingest` 匯入；`pending` 的縣市，系統只說全國規定並建議洽當地消防局（SPEC 6.3）。

**目前狀態（2026-11-12）**

| 縣市 | 檔案 | 狀態 | 線索（SPEC 6.3，需查官方原文） |
| --- | --- | --- | --- |
| 臺北市 | taipei.md | pending | 臺北市火災預防自治條例 |
| 新北市 | new-taipei.md | pending | 新北市火災預防自治條例 2026 年修正；新北市消防局 |
| 桃園市 | taoyuan.md | pending | 待查 |
| 臺中市 | taichung.md | pending | 待查 |
| 臺南市 | tainan.md | pending | 臺南市消防局公告 |
| 高雄市 | kaohsiung.md | pending | 高雄市火災預防自治條例 |
