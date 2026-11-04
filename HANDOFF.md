# 展覽查詢網站：交接文件（HANDOFF.md）

> 給接手這個專案的 AI 或工程師。這份文件整合了兩部分：
> 1. 擁有者提供的背景文件：repo 裡看不到的決策脈絡和協作方式。
> 2. 2026/11/04 當下 repo 的實際狀態：架構、設定、issues、PR。
>
> **兩者衝突時以 repo 為準**，本文件已照 repo 改寫。技術細節（欄位、演算法、門檻值）以 `schema.md` 和程式碼為準；本文件如果跟它們不一致，代表本文件過時了，請照 repo 修正本文件。

- Repo：https://github.com/kayastaygold/exhibition-finder
- 網站：https://kayastaygold.github.io/exhibition-finder/（GitHub Pages 是在 repo 設定裡開的，repo 檔案裡沒有對應的設定檔）

---

## 0. 接手第一步：閱讀順序

照這個順序讀，大約就能進入狀況：

| 順序 | 檔案 | 讀什麼 | 備註 |
|---|---|---|---|
| 1 | 本文件第 1～3 節 | 擁有者是誰、怎麼協作、不能做的事 | **最重要**，先讀完再動手 |
| 2 | `data/sources.json` | 目前有哪些來源、各自怎麼抓 | 來源的唯一真實清單 |
| 3 | `.github/workflows/update-events.yml` | 每週自動更新的流程 | 開頭的註解就是流程說明 |
| 4 | `schema.md` 第 11 節 | 美術館官網爬取、override、每月查證 | 最新、最完整的一節 |
| 5 | `schema.md` 第 9.3、10.4、8.6 節 | 抓取失敗處理、去重演算法、北美館改用文化快遞 | |
| 6 | `schema.md` 第 4、6 節 | 文化部資料特性、常設展／線上展／行政區規則、前端篩選邏輯 | 統計數字是 2026/09/07 的快照 |
| 7 | `docs/monthly-museum-check.md` | 每月查證的步驟 | 見第 10 節：11 月這次沒有成功執行 |
| 8 | `probes/README.md` | 怎麼在 GitHub runner 上探測外部網站 | sandbox 連不到外部網站時用 |
| 9 | `scripts/fetch-sources.mjs` → `scripts/build-events.mjs` → `scripts/scrapers/*.mjs` | 程式本身 | `build-events.mjs` 開頭註解有總覽 |
| 10 | GitHub 上開著的 issues（#3、#5、#14、#17） | 待辦事項 | 摘要見第 8 節 |

**讀 `schema.md` 要注意**：第 1～10 節是依時間順序寫的，有些段落描述的是當時的狀態，後面才用「更新」補註，例如：
- 第 5 節寫「每日排程」，實際是**每週**。
- 第 9.1 節說 `type` 只有兩種、列了 3 個來源，實際有三種 `type`、7 個來源。
- 第 9.3 節最後說「只有文化部跟文化快遞兩個來源」，那是美術館接入之前的狀態。

現況以 `data/sources.json`、程式碼和第 11 節為準。

---

## 1. 專案目的與擁有者

- **擁有者**：Kaya。前科技業專案經理，**沒有工程背景**，不寫程式。
- **目的**：依「地點 × 時間」查詢台灣目前有哪些展覽，主要是自己週末找展用。
- **核心期待**：最不花她的精力。AI 負責實作、驗證、優化；她負責**判斷與 merge**。
- 她的強項是需求判斷和抓問題，例如發現中美館缺漏、發現已結束的展覽沒消失。請把她當 PM 溝通：給結論、給選項、說明取捨，不要丟一堆技術細節要她自己判斷。

---

## 2. 協作規則

### 2.1 她已經習慣的工作方式

1. **先說方案，等確認再動手。** 涉及設計選擇的事，先提方案與選項。
2. **一次只做一件事。** 一個 PR 只處理一個主題；不要順手加她沒要求的功能。
3. **範圍外的問題記成 issue，不要順手修。** 避免出問題時分不清是哪個改動造成的。#14、#17 就是這樣記下來的。
4. **結論寫回 `schema.md`。** 每次發現的資料特性、踩到的坑、做的決定都要寫回去，讓下一個接手的人讀完就能進入狀況。
5. **例行流程可以自己往下走。** 她 merge 之後，可以自己觸發 workflow 驗證，沒問題就接著做下一個已核准的工作。只有以下情況要停下來問：
   - 驗證結果跟預期不符
   - 需要她做決定的設計選擇
   - 任何會刪除資料或改變現有行為的事
6. **誠實回報。** 不確定就說不確定；發現自己之前說錯，主動更正。她很重視這點。過去的例子：#21 把「角落任務」的時間欄寫成空白，實際是「常設」，在 #22 更正。
7. **她的操作能力**：會 merge PR、觸發 Actions、開 issue、用瀏覽器看 JSON。遇到 GitHub 操作要給具體步驟。

### 2.2 repo 的實際操作慣例（從過去的 PR 整理）

- **不直接 push 到 `main`**，一律開分支、開 PR，由她 merge。唯一的例外是 `update-events.yml` 的 bot commit。
- **PR 裡不 commit `events.json` 和 `data/*-raw.json`**，這兩種檔案交給每週排程重新產生。override 檔（`data/*-overrides.json`）和 `data/sources.json` 是人工維護的，會跟著 PR 一起改。
- PR 說明用繁體中文，寫清楚改了什麼、怎麼驗證、驗證結果。
- merge 後的驗證方式：手動觸發 `update-events.yml`（`workflow_dispatch`、ref 填 `main`），看 log 裡各來源的筆數和 build 的合計筆數。
- **探測外部網站**：照 `probes/README.md`。在分支上新增 `probes/<主題>.mjs`，用 `probe.yml` 指定那個分支觸發。探測分支**不 merge**，結論寫進 issue、PR 說明或 `schema.md`。

---

## 3. 核心原則

### 3.1 資料來源
- **優先順序**：官方開放資料 API ＞ 官網結構化頁面（自動抓）＞ override 人工維護（每月查證）。
- **固定來源清單，不做開放式網路搜尋。** 讓 AI 漫無目的上網找展覽，品質不可控、無法除錯。每月查證時用 WebSearch，也只查固定的那幾個館。
- **遵守 robots.txt，不繞過任何防護。**
  - 中美館的 `/wp-json/api` 被 robots.txt 禁止，所以不用。
  - 桃美館官網有 Anti-DDoS 防護，所以改人工維護。曾發現桃美館另一台可能沒有防護的主機（`tmofa-datastorage.tycg.gov.tw`），刻意不用（`schema.md` 11.8）。
- **不執行外部來源的程式碼**：網站給的 JS 只當字串解析，例如中美館的 Nuxt 資料用 `reviveNuxtData()` 解碼。
- **請求禮節**：爬取請求之間至少間隔 1 秒，User-Agent 標明本專案（`SCRAPE_MIN_INTERVAL_MS`，`schema.md` 11.5）。
- **不編造資料。** 沒有完整展期就不收，例如中美館的長期展示「庫房裡的光」（只寫開始日）、「角落任務」（時間欄寫「常設」），是擁有者 2026/10/26 決定的。沒有可靠圖片就留空。
- **只存事實，不大量轉載文案。** 標題、展期、地點、連結可以；長篇展覽論述不行（見 issue #3）。

### 3.2 穩定性（細節見 `schema.md` 9.3、11.5）
- **失敗要保守**：任一來源抓取失敗就沿用上一次的 raw 檔；合併後 0 筆時 build 直接失敗，不覆寫 `events.json`、不 commit。
- **筆數驟減規則**：上次 ≥ 20 筆的來源，這次少於一半就算失敗；上次 < 20 筆的小來源，只要不是 0 筆就算成功（小館換檔期掉一半是正常的）。
- **爬取來源要有解析驗證**（`assertValidMuseumRecords()`）：每筆都要有 `id`、標題、格式正確的開始日**和結束日**（`YYYY/MM/DD`），而且結束日不早於開始日。任何一筆不合格，整個來源就當作抓取失敗、沿用上一次的檔案。
- **raw 檔要 commit**：「失敗沿用上一次」的前提是上一次的檔案在 repo 裡。

### 3.3 前端呈現
- **已結束的展覽在前端隱藏，不在 build 時刪除**（`index.html` 的 `hasNotEnded()`）。「今天」每天在變，在 build 時刪的話，排程沒跑的那幾天反而會留下過期資料。
- **常設展、線上展預設隱藏**，可以勾選開啟（`include-permanent`、`include-online`）。理由是網站回答的是「現在有什麼可以去看」，這兩類是雜訊。
- **不用地圖當主介面**：大量資料缺座標（文化部只有 33% 有座標），地圖會誤導。主要篩選方式是縣市 → 行政區的串聯下拉。

---

## 4. 架構與檔案結構

```
GitHub Actions：update-events.yml
（每週一 08:00 台灣時間，cron "0 0 * * 1"（UTC），也可以手動觸發）
  → scripts/fetch-sources.mjs   依 data/sources.json 抓每個 enabled 的來源，寫進 data/<來源>-raw.json
                                （失敗就保留上一次的檔案；manual 來源不抓）
  → scripts/build-events.mjs    轉換、正規化、判斷常設展／線上展、抽縣市／行政區、
                                套用 override、跨來源去重 → events.json
  → events.json 或 data/*-raw.json 有變化才由 github-actions[bot] commit 到 main
前端：index.html（單一檔案、Tailwind CDN、原生 JS）讀 events.json，GitHub Pages 靜態託管
```

採用「建置階段抓取、前端讀靜態檔」，是為了避開 CORS、加快載入，也不需要後端。

```
.
├── index.html                      前端（篩選、卡片列表）
├── events.json                     build 產物，前端讀這個；bot 每週更新
├── schema.md                       資料規格與所有決策紀錄（第 1～11 節）
├── HANDOFF.md                      本文件
├── README.md                       目前只有專案名稱
├── docs/
│   └── monthly-museum-check.md     每月美術館查證的步驟
├── data/
│   ├── sources.json                來源設定（見第 5 節）
│   ├── moc-raw.json                文化部原始回傳（bot 更新）
│   ├── culture-express-raw.json    文化快遞原始回傳，全部類別（bot 更新）
│   ├── ntcam-raw.json              新北市美術館爬取結果（bot 更新）
│   ├── ntmofa-raw.json             國美館爬取結果（bot 更新）
│   ├── tcam-raw.json               中美館爬取結果（bot 更新）
│   ├── tfam-overrides.json         北美館人工修正：「鬱卒的平面」地點改成威尼斯
│   ├── tcam-overrides.json         中美館漏抓的人工補充（目前是空陣列）
│   └── tmofa-overrides.json        桃美館人工維護（目前 2 筆）
├── scripts/
│   ├── fetch-sources.mjs           抓取（重試、逾時、筆數驟減判斷、原子寫入、Job Summary）
│   ├── build-events.mjs            轉換＋去重（約 840 行，開頭註解有總覽）
│   └── scrapers/
│       ├── common.mjs              HTML 轉文字、日期區間解析、解析驗證、Nuxt 資料解碼
│       ├── ntcam.mjs               新北市美術館
│       ├── ntmofa.mjs              國美館
│       └── tcam.mjs                中美館
├── probes/
│   └── README.md                   探測腳本的用法與規則（腳本本身放在探測分支，不進 main）
└── .github/workflows/
    ├── update-events.yml           每週更新（contents: write）
    └── probe.yml                   通用探測，只能手動觸發、唯讀（contents: read）
```

**環境限制**：AI 的 sandbox 通常連不到台灣政府網站和美術館官網，要驗證外部來源請透過 GitHub Actions runner（`probe.yml` 或手動觸發 `update-events.yml`）。runner 可以連，已經驗證過很多次。高雄市資料平台 `data.kcg.gov.tw` 是例外，runner 也連不上（#16）。

---

## 5. 資料來源實際設定（`data/sources.json`，2026/11/04）

| id | 名稱 | type／responseFormat | 檔案 | enabled | 說明 |
|---|---|---|---|---|---|
| `moc-exhibitions` | 文化部展覽資訊（category=6） | `official_api`／`array` | `data/moc-raw.json` | ✅ | 只回傳當期和未來的展覽。約 47% 用「整年」當展期（2026/09/07 樣本），常設展規則判定約 51% 是常設展（`schema.md` 4.1、4.2） |
| `tfam` | 臺北市立美術館（data.taipei） | `official_api`／`data-taipei` | `data/tfam-raw.json`（已刪除） | ❌ | 資料集停更，2026/10/25 停用。北美館改從文化快遞來（`schema.md` 8.6） |
| `culture-express` | 文化快遞（臺北市文化局） | `official_api`／`array` | `data/culture-express-raw.json` | ✅ | 存全部類別，build 時只取 `Category === "展覽"`。分析時全部都有圖。跟文化部重疊時**以文化快遞版本為準**（`schema.md` 10.4） |
| `ntcam` | 新北市美術館（官網） | `scrape`／`ntcam` | `data/ntcam-raw.json` | ✅ | POST 官網前端自己用的 JSON 端點，**不是公開 API**，網站改版可能失效（`schema.md` 11.2） |
| `ntmofa` | 國立臺灣美術館（官網） | `scrape`／`ntmofa` | `data/ntmofa-raw.json` | ✅ | 列表頁（當期＋預告）加上每檔的詳細頁（放在 `event.culture.tw`）。很多展覽在館外，地點逐筆讀，館外地點對照放在 `knownVenues`（`schema.md` 11.3） |
| `tcam` | 臺中市立美術館（官網） | `scrape`／`tcam` | `data/tcam-raw.json`＋`data/tcam-overrides.json` | ✅ | 從首頁找展覽連結，再逐一解析詳細頁。**只抓得到首頁有提到的展覽，可能漏抓**，漏的靠每月查證補進 override（`schema.md` 11.7、11.8） |
| `tmofa` | 桃園市立美術館（人工維護） | `manual`／`manual` | `data/tmofa-overrides.json` | ✅ | 官網有 Anti-DDoS，不抓。本館 2028 年第一季才開館，目前只有橫山書法藝術館、桃園市兒童美術館兩個場館（`schema.md` 11.8） |

**人工 override 一覽**：

| 檔案 | 用途 | 目前內容 |
|---|---|---|
| `data/tfam-overrides.json` | 用 `cultureExpressId` 綁定一筆文化快遞事件，修正它的地點 | 「鬱卒的平面」：文化快遞誤標成臺北中山區，實際在義大利威尼斯；`endDate` 2026/11/22，過期後會自動安靜略過 |
| `data/tmofa-overrides.json` | 桃美館的全部展覽 | 「書寫的變奏與對話」（～2026/11/09，**已結束**，下次查證時移除）、「一樣不一樣」（～2026/11/30） |
| `data/tcam-overrides.json` | 中美館漏抓的展覽 | 空 |

**目前資料量**（2026/11/02 每週排程的結果）：`events.json` 共 370 筆，包含已結束的。依來源：文化部 263、文化快遞 80、國美館 10、新北市美術館 8、中美館 7、桃美館 2。

**去重**：美術館官網 ＞ 文化快遞 ＞ 文化部／北美館 override。判斷條件是「場地相同」**而且**「標題相似度 > 0.8」。標題相似度用 LCS Dice 係數，比對前去掉「場館名 - 」前綴和結尾的年份括號，取多種組合裡最高的分數（`schema.md` 10.4、11.4）。

---

## 6. 評估過但沒採用的來源（避免重複踩坑）

| 來源 | 結論 | 原因 | repo 內的紀錄 |
|---|---|---|---|
| 新北市文化局藝文活動（新北開放平台） | 不採用 | 類型雜、地址混在描述字串裡、大量他縣市轉知訊息 | 無，出自背景文件 |
| 新北市藝遊 | 不採用 | 只是月刊下載連結，不是展覽資料 | 無，出自背景文件 |
| 臺北市立文獻館常設展 | 不採用 | 只有常設展、資料停在 2023 | 無，出自背景文件 |
| data.taipei 北美館展覽資訊 | 已停用 | 2026/10 抓到的內容跟 9 月整理時完全一樣，沒在維護 | `schema.md` 8.6 |
| 臺中市政府活動訊息（data.gov.tw 84940） | **待決定（issue #17）** | 資料是活的、每天更新，但只涵蓋文化局轄下場館，展覽和講座混在一起，也不含中美館 | #17 |
| 臺中市葫蘆墩文化中心活動表（83928） | 不採用 | 已過期（2026/10 探測時 0 筆還在進行），內容也已包含在臺中活動訊息裡 | #16、#17 |
| 高雄市文化局展覽活動（47220） | 不採用 | 從 GitHub runner 連線逾時 | #16 有紀錄連線逾時。背景文件另外提到「資料約 2021 年起停更」，repo 沒有這項紀錄、無法核對 |
| 桃園市開放資料 | 無可用資料集 | 背景文件記錄「官網熱門活動資料集已下架」 | 無，出自背景文件 |
| 中美館 WordPress API（`/wp-json/api`） | 不用 | robots.txt 禁止 | `schema.md` 11.1、11.7 |
| 非池中藝術網 | **尚未評估** | 藝廊展訊的聚合站，價值高；接入之前要先確認 robots.txt 和使用條款 | 無。目前只在每月查證時當作桃美館展期的參考來源 |
| Instagram／快閃店 | 放棄 | 需要登入、使用條款禁止爬取、限時動態會消失 | 無，出自背景文件 |

---

## 7. 重要決策紀錄

| 決策 | 時間／出處 |
|---|---|
| 第一版只做縣市＋時間篩選、卡片列表，不加地圖 | #1 |
| 常設展用啟發式判斷（標題關鍵字、整年佔位日期、展期超過 2 年），前端預設隱藏 | #1、`schema.md` 4.2 |
| 行政區用**串聯下拉**（中正區在台北、基隆都有，扁平選單會混淆） | #6（issue #4） |
| 線上展只比對標題，不比對簡介（比對簡介會誤判），前端預設隱藏 | #7（issue #2）、`schema.md` 4.4 |
| 已結束的展覽在前端隱藏，不在 build 時刪除 | #11、`schema.md` 第 6 節 |
| 抓取失敗沿用上一次的 raw 檔；上次 < 20 筆的小來源，只要不是 0 筆就算成功 | #12、`schema.md` 9.3 |
| 文化快遞跟文化部重疊時以文化快遞為準（有圖） | #10 |
| 北美館改從文化快遞來，data.taipei 停用；override 改用 ID 綁定；對不到 ID 時，已結束的安靜略過、沒結束的發警告 | #13、`schema.md` 8.6 |
| 去重時去掉「場館名 - 」前綴、結尾年份括號，取最高分 | #13、#20 |
| 美術館改用「固定清單」：能自動抓的接進排程，不能的用 override 加每月查證 | 2026/10/26，`schema.md` 第 11 節 |
| 爬取來源的資料**直接 commit，不做審核流程**（已有解析驗證和失敗保護；品質出問題再加）。`requiresReview` 欄位保留，但沒有邏輯 | 2026/10/26 |
| 中美館沒有完整展期的長期展示**不收** | 2026/10/26，#21 |
| 每月查證由排程自動執行並開 PR，擁有者只負責 merge | 2026/10/26，#22（**實際執行狀況見第 10 節**） |
| `probe.yml` 改成通用探測 workflow 留在 `main`；探測腳本放探測分支，不 merge | #19 |

---

## 8. Issues（2026/11/04，GitHub 上共 6 個）

| # | 狀態 | 標題 | 摘要 |
|---|---|---|---|
| #2 | 已關閉 | 線上展覽污染地點篩選 | 由 #7 處理：`isOnline` 欄位＋前端開關 |
| #3 | **開著** | 簡介欄位直接照搬原文，需改寫 | 想在 build 階段用 Claude API 把簡介改寫成 1～2 句。需要 API 費用，自用不急，對外推廣前要處理（著作權） |
| #4 | 已關閉 | 加入行政區篩選 | 由 #6 處理 |
| #5 | **開著** | 補充大型場館資料源 | 列了北美館、新北美術館、華山、松菸等，優先度高。目前北美館（透過文化快遞）、新北市美術館、國美館、中美館、桃美館都已經接入；**華山、松菸還沒有評估**。issue 本身沒有關閉 |
| #14 | **開著** | 去重失敗：「2026 台北新藝術博覽會」文化部與文化快遞各一筆 | 場地寫法完全不同（一邊寫「光復南路 133 號」，一邊寫「松山文創園區」），所以沒有去重。issue 裡列了 5 個解法方向，偏向「標題＋展期完全相同、同一個行政區」。展覽是 2026/11/19～22，結束後問題會自然消失，但同類問題會再發生 |
| #17 | **開著** | 候選資料源：臺中市政府活動訊息（84940） | 端點、欄位、接入時要處理的事都記在 issue 裡；先記錄、不接入，等擁有者決定 |

---

## 9. Pull requests（全部已 merge）

| # | 標題 | 內容 |
|---|---|---|
| #1 | Claude/taiwan exhibition search b1ro1h | 第一版：`index.html`（縣市＋時間篩選、卡片、常設展開關）、`build-events.mjs`、`schema.md`、文化部樣本 |
| #6 | 加入行政區篩選 | 縣市 → 行政區串聯下拉、`extractDistrict()` |
| #7 | 加入線上展覽篩選 | `isOnline` 與前端開關 |
| #8 | 加入北美館（TFAM）資料源 | data.taipei＋`tfam-overrides.json`（後來在 #13 改掉） |
| #9 | 多資料來源架構：來源設定檔＋週排程自動更新 | `data/sources.json`、`update-events.yml` |
| #10 | Integrate Culture Express (文化快遞) exhibition data source | 文化快遞接入、座標髒值處理、跨來源去重 |
| #11 | Hide ended exhibitions regardless of date filter | 前端一律隱藏已結束的展覽 |
| #12 | Fetch live data from all three sources in the scheduled workflow | `fetch-sources.mjs`：真的去抓 API、失敗沿用、筆數驟減規則；`sample.json` 改名成 `data/moc-raw.json` |
| #13 | Use Culture Express as the primary TFAM source; strip venue prefixes in dedup | 北美館改用文化快遞、停用 data.taipei、override 改用 ID 綁定、去重時去掉前綴 |
| #15 | Add temporary probe workflow for Taoyuan/Taichung/Kaohsiung sources | 暫時性探測：臺中、高雄、葫蘆墩的開放資料 |
| #16 | Remove temporary probe workflow | 刪掉 #15 的 workflow，PR 說明裡有探測結果摘要 |
| #18 | Add temporary probe workflow for museum websites | 探測四間美術館官網 |
| #19 | Replace one-off probe workflow with a generic, branch-dispatched probe.yml | 通用探測 workflow 留在 `main`、新增 `probes/README.md` |
| #20 | Add NTCAM and NTMoFA museum websites as scraped sources | 新北市美術館、國美館官網爬取；美術館地點對應；去重時去掉年份括號 |
| #21 | Add Taichung Art Museum (TcAM) website as a scraped source | 中美館官網爬取 |
| #22 | 桃美館人工維護 override、中美館漏抓 override、每月查證流程 | `manual` 來源類型、override 合併、`docs/monthly-museum-check.md`；更正 #21 把「角落任務」寫成時間欄空白的錯誤 |

（#2～#5、#14、#17 是 issues，GitHub 的 issue 和 PR 共用編號。）

---

## 10. 已知風險與技術債

### 10.1 ⚠️ 每月查證排程：2026/11/01 那次沒有產生 PR
- 排程是建在 Claude Code 的 scheduled task 上（名稱「每月美術館查證」，每月 1 日台灣時間 08:52，每次開一個新的 session），**不在 repo 裡**。
- 2026/11/01 有觸發，但那個 session 大約 23 秒就結束了，**沒有建立分支，也沒有開 PR**。session 紀錄顯示它沒有掛上這個 repo。建立排程時，系統就警告過開出來的 session 不會預先帶著 repo 和 GitHub 工具。當時在指示裡加了「先用 add_repo 把 repo 加進來」的步驟，看起來沒有成功。確切原因要看那次 session 的對話紀錄才知道，這份文件寫作時沒有讀到。
- **影響**：11 月的查證沒有做。目前 `tmofa-overrides.json` 裡「書寫的變奏與對話」已經結束（11/09），還留在檔案裡。前端會自動隱藏已結束的展覽，所以使用者看不到錯誤資料，但新開的展覽不會被補進來。
- **可能的解法**（要擁有者決定）：
  1. 在 claude.ai 的排程頁面重新建立這個排程，建立時勾選 `kayastaygold/exhibition-finder` repo。
  2. 換成其他工具接手時，改用那個工具的排程功能，照 `docs/monthly-museum-check.md` 執行。
  3. 先手動照 `docs/monthly-museum-check.md` 跑一次 11 月的查證。

### 10.2 其他風險
- 文化快遞的圖片是代理網址（`UploadPlugin?file=...`），格式改變的話圖片會全部失效。
- 新北市美術館用的是網站前端自己的 JSON 端點，不是公開 API。
- 中美館抓取依賴首頁的連結結構，只抓得到首頁有提到的展覽。
- 前端用 Tailwind CDN 版本，官方不建議用在正式環境（長期經營再處理）。
- 國美館的詳細頁放在文化部的 `event.culture.tw`，但文化部 category=6 的資料裡國美館是 0 筆，原因沒查。
- 去重只靠場地字串比對，場地寫法差太多時會失敗（#14）。
- `schema.md` 第 1～10 節有過時的段落（見第 0 節），新接手的人容易誤讀。
- GitHub Actions 已經警告 `actions/checkout@v4`、`actions/setup-node@v4` 用的 Node.js 20 被淘汰、強制改用 Node.js 24 執行，目前不影響結果。

---

## 11. 接手時特別注意

- **每月查證排程不會跟著 repo 走。** 換成其他 AI 或工具接手時，這個排程不會跟著過來，要重新設定或改用其他方式觸發；而且它目前本來就沒有正常運作（見 10.1）。查證步驟在 `docs/monthly-museum-check.md`。
- **每週更新的 GitHub Actions 是 repo 層級的，不受影響**，只要 repo 在就會繼續跑。
- 不要讓 sandbox 直接抓外部網站。連不上是預期中的事，請改用 runner。
- 擁有者的 merge 就是核准；沒有 merge 的方案不要自己往下做。

---

## 12. 未來可能方向（未排程，做之前都要先跟擁有者確認）

- 捷運站篩選：前提是先補齊座標（目前很多來源缺座標）。
- 更多藝廊：優先評估非池中藝術網（先確認 robots.txt 和使用條款）。
- 華山、松菸等大型場館（issue #5 列了，還沒評估）。
- 臺中市政府活動訊息（issue #17）。
- 簡介改寫（issue #3）。
- 地圖：等座標覆蓋率夠高再考慮。
