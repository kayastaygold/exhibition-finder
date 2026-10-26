# 每月美術館查證

每月由排程自動開一個新的 Claude Code session，照這份文件執行，**最後開一個 PR 到 `main` 給使用者確認**。不要直接 push 到 `main`。

背景見 `schema.md` 第 11 節：新北市美術館、國美館、中美館的官網每週自動抓取；桃美館官網擋自動程式，只能人工維護（`data/tmofa-overrides.json`）；中美館的自動抓取只抓得到首頁有提到的展覽，可能漏抓，漏的用 `data/tcam-overrides.json` 補。

## 0. 準備

1. 從最新的 `main` 開分支：`claude/monthly-museum-check-YYYYMM`（例如 `claude/monthly-museum-check-202611`）。
2. 讀 `schema.md` 第 11 節，特別是 11.8 的 override 格式。
3. 記下「今天」（台灣時間），下面判斷展覽是否已結束都以這天為準。

## 1. 桃美館（`data/tmofa-overrides.json`）

桃美館本館預計 2028 年第一季才開館，目前營運的是**橫山書法藝術館**、**桃園市兒童美術館**兩個場館。

1. 用 WebSearch 查兩個場館目前展出中、以及未來兩個月內會開幕的展覽。本館如果已經開館，也一併查。
2. 檔案裡現有的每一筆：
   - 已經結束（`endDate` 早於今天）→ **移除**，在 PR 裡列出。
   - 還在展出 → 確認標題、展期沒變，更新 `lastVerified`。展期有變的照新的資訊改，在 PR 裡寫明改了什麼、依據哪個來源。
3. 新的展覽 → 新增一筆，格式見下方「override 格式」。`venueText` 要寫成「橫山書法藝術館」或「桃園市兒童美術館」，`sources.json` 的 `knownVenues` 才對得到地址。
4. **只用 WebSearch**。不要寫腳本、也不要用 `probe.yml` 去抓 `tmofa.tycg.gov.tw`（它的 Anti-DDoS 防護擋自動程式，不能繞過），也不要改抓 `tmofa-datastorage.tycg.gov.tw` 這類其他主機。

## 2. 中美館漏抓檢查（`data/tcam-raw.json`、`data/tcam-overrides.json`）

1. 讀 `data/tcam-raw.json`（每週自動抓到的中美館展覽）的標題清單。
2. 用 WebSearch 查中美館目前展出中、以及未來兩個月內會開幕的展覽。
3. 有完整展期（起日和迄日都有）、但 `tcam-raw.json` 裡沒有的 → 加進 `data/tcam-overrides.json`，在 PR 裡標明「中美館漏抓」。`venueText` 寫官網上的地點（例如「臺中市立美術館 展覽室A、B、C」）。
4. **不要加的**：沒有完整展期的長期展示（使用者 2026/10/26 決定不收）。目前已知的有「庫房裡的光」（只寫開始日 2025.10.28）、「角落任務」（時間欄寫「常設」）。
5. `data/tcam-overrides.json` 裡已經結束的移除；已經被自動抓到的也移除（第 3 步跑 build 時會印出「已經被自動抓到…可以從檔案刪除」）。

## 3. 檢查

```
node scripts/build-events.mjs data/moc-raw.json /tmp/events-check.json
```

- 不能有「美術館 override 格式不對」的警告。
- 「已經被自動抓到」的提示應該都處理掉了（第 2 步第 5 點）。
- 確認 log 裡桃美館、中美館的筆數合理。
- **不要 commit `events.json`**，也不要動 `data/*-raw.json`——這些由每週排程重新產生。這個 PR 只改兩個 override 檔。
- 需要改程式或 `data/sources.json` 才能處理的情況（例如官網改版、出現新的館外地點），不要自己改，寫在 PR 說明裡讓使用者決定。

## 4. 開 PR

- 標題：`chore: 每月美術館查證 YYYY-MM`
- 就算沒有任何新增或移除（只更新了 `lastVerified`），也照樣開 PR，讓使用者知道這個月查過了。
- 說明照這個格式：

```
## 桃美館
| 動作 | 展覽 | 場館 | 展期 | 來源 |
|---|---|---|---|---|
| 新增／更新／移除（已結束）／確認無誤 | … | … | YYYY/MM/DD～YYYY/MM/DD | [連結](…) |

## 中美館漏抓檢查
- 自動抓到的（tcam-raw.json）：…
- 查到但沒抓到、已補進 override 的：…（附來源）
- 刻意不收的長期展示：庫房裡的光、角落任務
- override 移除的：…（已結束／已被自動抓到）

## 無法確認的項目
（來源互相矛盾、只有單一非官方來源、日期不完整……都列在這裡，不要加進 override）
```

## 原則

- **不編造任何資料**：展期、標題要有來源；找不到圖片網址就讓 `imageUrl` 留空（前端會顯示佔位圖）。
- **來源**：優先用官網、官方粉絲頁、政府新聞稿；只有非官方來源（媒體、部落格）時，至少要兩個來源的展期一致。每一筆的 `sources` 都要附上實際用到的網址。
- 來源互相矛盾、或資訊不完整的，不要加，列在 PR 的「無法確認的項目」。

## override 格式

跟自動抓取的 raw 紀錄同一個格式（見 `schema.md` 11.4），另外加兩個給人看的欄位：

```json
{
  "id": "2026-kids-same-different",
  "title": "一樣不一樣",
  "startDate": "2026/07/04",
  "endDate": "2026/11/30",
  "venueText": "桃園市兒童美術館",
  "imageUrl": "",
  "url": "https://tmofa.tycg.gov.tw/ch/exhibitions/current-exhibitions",
  "description": "一兩句話的簡介",
  "lastVerified": "2026-10-26",
  "sources": ["https://…"]
}
```

- `id`：同一個檔案裡不能重複，事件 uid 會是 `<來源 id>-<id>`（例如 `tmofa-2026-kids-same-different`）。桃美館用「年份-簡短英文代號」；中美館用官網詳細頁網址的 slug（`/zh/exhibition/<slug>`），之後自動抓到時才對得起來。
- `startDate`／`endDate`：`YYYY/MM/DD`。格式不對的那一筆 build 時會被略過並發警告。
