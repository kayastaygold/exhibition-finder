#!/usr/bin/env node
// 依 data/sources.json 抓取每個啟用中來源的最新資料，寫進各自的 rawPath，
// 給 scripts/build-events.mjs 轉換用（見 schema.md 第 9.3 節）。
//
// 用法：
//   node scripts/fetch-sources.mjs
//
// 設計原則：任何一個來源抓取失敗，都只影響那個來源本身——保留上一次的 raw 檔、
// 印出警告、繼續處理下一個來源。這支腳本只在 sources.json 本身讀不到/壞掉時才會
// 以非 0 結束，其他情況一律以 0 結束，確保後面的 build 一定會跑。
//
// 以下情況都算「抓取失敗」（會重試，重試完仍失敗就沿用上一次的 raw 檔）：
//   - 網路錯誤、逾時、HTTP 不是 2xx
//   - 回應不是合法 JSON，或格式跟 responseFormat 對不上
//   - 美術館官網（type: "scrape"）：任何一筆解析不出標題或起訖日（見 scripts/scrapers/）
//   - 0 筆
//   - 筆數驟減：上一次 >= 20 筆、這次少於上一次的一半。上一次不到 20 筆的小來源
//     （例如北美館，換檔期時個位數筆數掉一半是正常的）不套用這條，只要不是 0 筆就算成功。
//
// 測試用環境變數（正式排程不用設）：
//   SOURCES_PATH           改讀別的設定檔（預設 data/sources.json）
//   FETCH_TIMEOUT_MS       單次請求逾時（預設 30000）
//   FETCH_RETRY_DELAYS_MS  重試間隔，逗號分隔（預設 "5000,15000"，也就是重試 2 次）

import { readFile, writeFile, rename, appendFile } from "node:fs/promises";
import { fetchNtcam } from "./scrapers/ntcam.mjs";
import { fetchNtmofa } from "./scrapers/ntmofa.mjs";
import { fetchTcam } from "./scrapers/tcam.mjs";

const SOURCES_PATH = process.env.SOURCES_PATH ?? "data/sources.json";
const TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS ?? 30000);
const RETRY_DELAYS_MS = (process.env.FETCH_RETRY_DELAYS_MS ?? "5000,15000")
  .split(",")
  .filter((s) => s.trim() !== "")
  .map(Number);

// 筆數驟減規則的兩個門檻（見檔案開頭說明）。
const SMALL_SOURCE_THRESHOLD = 20;
const MIN_RATIO_VS_PREVIOUS = 0.5;

// data.taipei 一次最多回 1000 筆，用 limit/offset 分頁；設上限避免 count 欄位異常時無限迴圈。
const DATA_TAIPEI_PAGE_SIZE = 1000;
const DATA_TAIPEI_MAX_PAGES = 20;

const USER_AGENT = "exhibition-finder (+https://github.com/kayastaygold/exhibition-finder)";

// 爬美術館官網時，同一次執行裡任兩個請求至少間隔這麼久，避免對官網造成負擔。
const SCRAPE_MIN_INTERVAL_MS = Number(process.env.SCRAPE_MIN_INTERVAL_MS ?? 1000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 給美術館爬取函式用的 HTTP 小工具：統一逾時、User-Agent、請求間隔，HTTP 不是 2xx 就丟錯。
let lastScrapeRequestAt = 0;
async function scrapeRequest(url, init = {}) {
  const wait = lastScrapeRequestAt + SCRAPE_MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastScrapeRequestAt = Date.now();
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "zh-TW,zh;q=0.9", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}（${url}）`);
  return res.text();
}
const scrapeHttp = {
  getText: (url) => scrapeRequest(url),
  postForm: (url, params) =>
    scrapeRequest(url, {
      method: "POST",
      body: new URLSearchParams(params),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json, text/javascript, */*; q=0.01",
      },
    }),
};

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`回應不是合法 JSON（開頭：${JSON.stringify(text.slice(0, 60))}）`);
  }
}

// 文化部、文化快遞：直接回傳 JSON 陣列，原樣存檔。
async function fetchArray({ url }) {
  const data = await fetchJson(url);
  if (!Array.isArray(data)) throw new Error("回應不是 JSON 陣列");
  return data;
}

// data.taipei：回傳 { result: { count, results: [...] } }，只存 results 陣列
// （build-events.mjs 的 loadTfamEvents() 讀的是攤平後的陣列）。
async function fetchDataTaipei({ url }) {
  const all = [];
  for (let page = 0; page < DATA_TAIPEI_MAX_PAGES; page++) {
    const pageUrl = new URL(url);
    pageUrl.searchParams.set("limit", String(DATA_TAIPEI_PAGE_SIZE));
    pageUrl.searchParams.set("offset", String(page * DATA_TAIPEI_PAGE_SIZE));
    const data = await fetchJson(pageUrl);
    const results = data?.result?.results;
    if (!Array.isArray(results)) throw new Error("回應裡找不到 result.results 陣列");
    all.push(...results);
    const total = Number(data.result.count);
    if (results.length < DATA_TAIPEI_PAGE_SIZE || (Number.isFinite(total) && all.length >= total)) {
      break;
    }
  }
  return all;
}

// 每個 fetcher 收到整筆 source 設定跟 scrapeHttp，回傳要寫進 rawPath 的陣列。
const FETCHERS = {
  array: fetchArray,
  "data-taipei": fetchDataTaipei,
  ntcam: fetchNtcam,
  ntmofa: fetchNtmofa,
  tcam: fetchTcam,
};

async function readPreviousCount(rawPath) {
  try {
    const data = JSON.parse(await readFile(rawPath, "utf-8"));
    return Array.isArray(data) ? data.length : null;
  } catch {
    return null; // 檔案不存在或壞掉，都當作沒有上一次的資料
  }
}

function validate(records, previousCount) {
  if (records.length === 0) throw new Error("抓到 0 筆");
  if (
    previousCount !== null &&
    previousCount >= SMALL_SOURCE_THRESHOLD &&
    records.length < previousCount * MIN_RATIO_VS_PREVIOUS
  ) {
    throw new Error(
      `筆數驟減：這次 ${records.length} 筆，少於上一次 ${previousCount} 筆的 ${MIN_RATIO_VS_PREVIOUS * 100}%`
    );
  }
}

// 先寫暫存檔再改名，寫到一半中斷也不會弄壞上一次的 raw 檔。
async function writeAtomic(path, content) {
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, content, "utf-8");
  await rename(tmpPath, path);
}

async function processSource(source) {
  const previousCount = await readPreviousCount(source.rawPath);
  const previousText = previousCount === null ? "無檔案" : `${previousCount} 筆`;
  const fetcher = FETCHERS[source.responseFormat];
  if (!fetcher) {
    return { ok: false, error: `不支援的 responseFormat：${source.responseFormat}`, previousCount, previousText };
  }

  const attempts = RETRY_DELAYS_MS.length + 1;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const records = await fetcher(source, scrapeHttp);
      validate(records, previousCount);
      await writeAtomic(source.rawPath, JSON.stringify(records));
      return { ok: true, count: records.length, previousCount, previousText, sampleKeys: Object.keys(records[0]) };
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    }
  }
  const reason = lastError?.name === "TimeoutError" ? `逾時（${TIMEOUT_MS / 1000} 秒）` : lastError?.message;
  return { ok: false, error: `${reason}，已重試 ${RETRY_DELAYS_MS.length} 次`, previousCount, previousText };
}

async function main() {
  const sources = JSON.parse(await readFile(SOURCES_PATH, "utf-8"));
  if (!Array.isArray(sources)) throw new Error(`${SOURCES_PATH} 不是陣列`);

  const summaryRows = [];
  for (const source of sources) {
    if (!source.enabled) {
      console.log(`[${source.id}] ⏸️ enabled: false，略過`);
      summaryRows.push(`| ${source.id} | ⏸️ 停用 | — | — |`);
      continue;
    }
    // 人工維護的來源（例如桃美館：官網擋自動程式，見 schema.md 11.8）沒有東西要抓，
    // 資料直接寫在 overridesPath，由每月查證更新。
    if (source.responseFormat === "manual") {
      console.log(`[${source.id}] ✍️ 人工維護（${source.overridesPath}），不抓取`);
      summaryRows.push(`| ${source.id} | ✍️ 人工維護 | — | — |`);
      continue;
    }

    const result = await processSource(source);
    if (result.ok) {
      console.log(
        `[${source.id}] ✅ 抓取成功：${result.count} 筆（上次：${result.previousText}）→ ${source.rawPath}`
      );
      // data.taipei 的欄位名稱還沒用真實回傳驗證過，印出來方便第一次排程時核對。
      if (source.responseFormat === "data-taipei") {
        console.log(`[${source.id}]    欄位：${result.sampleKeys.join("、")}`);
      }
      summaryRows.push(`| ${source.id} | ✅ 成功 | ${result.count} | ${result.previousText} |`);
    } else {
      const fallback =
        result.previousCount === null
          ? `而且沒有上一次的 ${source.rawPath} 可沿用，這個來源這次沒有 raw 資料`
          : `沿用上一次的 ${source.rawPath}（${result.previousCount} 筆）`;
      console.warn(`[${source.id}] ⚠️ 抓取失敗（${result.error}），${fallback}`);
      if (process.env.GITHUB_ACTIONS) {
        console.log(`::warning title=${source.id} 抓取失敗::${result.error}，${fallback}`);
      }
      const kept = result.previousCount === null ? "—（無檔案可沿用）" : "沿用上次";
      summaryRows.push(`| ${source.id} | ⚠️ 失敗：${result.error} | ${kept} | ${result.previousText} |`);
    }
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    const table = ["### 資料來源抓取結果", "", "| 來源 | 結果 | 這次筆數 | 上次筆數 |", "|---|---|---|---|", ...summaryRows, ""];
    await appendFile(process.env.GITHUB_STEP_SUMMARY, table.join("\n") + "\n");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
