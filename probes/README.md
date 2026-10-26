# probes/：一次性的探測腳本

這個開發環境（sandbox）的對外網路幾乎全部被擋，連不到政府開放資料、美術館官網這些外部網站。要查證「這個 API 能不能連、回什麼格式」「這個網站的 robots.txt 怎麼寫」，就在 GitHub runner 上跑一支探測腳本，看 log 和 Job Summary。

`.github/workflows/probe.yml` 會一直留在 `main` 上（`workflow_dispatch` 規定 workflow 檔必須在預設分支才能觸發），**腳本本身不進 `main`**：

1. 從 `main` 開一個探測分支，例如 `claude/probe-<主題>`。
2. 在分支上新增 `probes/<主題>.mjs`（Node 22、ES module、不需要安裝套件）。
3. push 分支，手動觸發 `probe.yml`：`ref` 填分支名稱，`script` 填 `probes/<主題>.mjs`。
4. 看 log／Job Summary。要調整就在同一個分支上改、再觸發一次。
5. 探測結束後，分支不 merge；結論寫進 issue、PR 說明或 `schema.md`。

## 探測腳本的規則

- **只讀**：只發 GET（或照網站前端自己的方式取資料），不送表單、不登入、不寫任何東西回 repo。workflow 本身只有 `contents: read` 權限，也沒有任何 secrets。
- **探測分支不改 workflow 檔**：觸發時用的是分支上的 workflow 版本，所以探測分支只新增 `probes/` 底下的檔案，不動 `.github/workflows/`。
- **尊重 robots.txt**：先讀 robots.txt，被禁止的路徑不抓。
- **不繞過防護**：遇到 Anti-DDoS／驗證碼／JavaScript 驗證頁，只記錄回應內容，不嘗試繞過。
- **不執行外部來源的程式碼**：不 `eval`／`Function` 網站給的 JS，只當字串解析。
- **控制請求量**：每次請求之間至少間隔 1 秒，只抓判斷需要的少數頁面；User-Agent 標明是本專案的探測程式。
- **輸出**：用 `console.log` 印到 log；需要的話把摘要寫進 `process.env.GITHUB_STEP_SUMMARY`。

## 過去的探測

| 主題 | 分支 | 結論記在 |
|---|---|---|
| 桃園／台中／高雄的開放資料（臺中活動訊息、高雄文化局展覽、葫蘆墩活動表） | `claude/probe-regional-sources` | #17 |
| 中美館、國美館、桃美館、新北美術館官網 | `claude/probe-museums-r2` | `schema.md` 11.1 |
| 新北市美術館＋國美館爬取的實測 | `claude/probe-museum-adapters`、`claude/probe-museums-live` | `schema.md` 11.6 |
| 中美館詳細頁結構與爬取實測 | `claude/probe-tcam-detail`、`claude/probe-tcam-live` | `schema.md` 11.7 |
