#!/usr/bin/env node
// 把文化部展覽 API 的原始 JSON（見 schema.md）轉成前端讀取用的精簡靜態檔 events.json。
//
// 用法：
//   node scripts/build-events.mjs [輸入檔路徑] [輸出檔路徑]
//   預設輸入 ./sample.json，輸出 ./events.json
//
// 這支腳本只做「轉換」，不做「抓取」——抓取（呼叫 cloud.culture.tw）之後由
// GitHub Actions 排程另外處理（見 schema.md 第 5 節），這裡先用本地的
// sample.json 當輸入，之後把抓取結果換掉輸入檔即可,不用改這支腳本。

import { readFile, writeFile } from "node:fs/promises";

const inputPath = process.argv[2] ?? "sample.json";
const outputPath = process.argv[3] ?? "events.json";

// 台灣 22 個縣市，用來從 location 地址字串抽出縣市（含正體「臺」與俗體「台」兩種寫法）。
// 見 schema.md 4.1.1：實測樣本中僅出現「臺」，但正則仍涵蓋「台」以防未來資料混用。
const COUNTIES = [
  "臺北市", "台北市",
  "新北市",
  "桃園市",
  "臺中市", "台中市",
  "臺南市", "台南市",
  "高雄市",
  "基隆市",
  "新竹市", "新竹縣",
  "嘉義市", "嘉義縣",
  "苗栗縣",
  "彰化縣",
  "南投縣",
  "雲林縣",
  "屏東縣",
  "宜蘭縣",
  "花蓮縣",
  "臺東縣", "台東縣",
  "澎湖縣",
  "金門縣",
  "連江縣",
];
const COUNTY_PATTERN = new RegExp(`(${COUNTIES.join("|")})`);

// 正體/俗體字同一縣市的顯示名稱一律正規化成正體（例如「台北市」→「臺北市」），
// 避免下拉選單裡出現同一縣市兩種寫法。
const COUNTY_CANONICAL = {
  "台北市": "臺北市",
  "台中市": "臺中市",
  "台南市": "臺南市",
  "台東縣": "臺東縣",
};

function extractCounty(location) {
  if (!location) return null;
  const m = COUNTY_PATTERN.exec(location);
  if (!m) return null;
  const raw = m[1];
  return COUNTY_CANONICAL[raw] ?? raw;
}

// latitude/longitude 在來源資料裡是字串或 JSON null（見 schema.md 4-3）。
// 統一轉成 number 或 null，順便擋掉非數字、超出經緯度合理範圍、以及 0 的髒值。
function normalizeCoord(value, min, max) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  if (n === 0) return null;
  if (n < min || n > max) return null;
  return n;
}

// descriptionFilterHtml 樣本中沒有 HTML 標籤（見 schema.md 4-5），但仍用簡單的
// tag-strip 防呆，避免未來資料混入標籤時原封不動塞進畫面。取前 100 字當卡片摘要。
function shortDescription(html) {
  if (!html) return "";
  const text = html
    .replace(/<[^>]*>/g, "")
    .replace(/\r\n|\r|\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= 100) return text;
  return text.slice(0, 100) + "…";
}

function buildEvent(raw) {
  const showInfo = (Array.isArray(raw.showInfo) ? raw.showInfo : []).map((s) => ({
    location: s.location ?? "",
    locationName: s.locationName ?? "",
    county: extractCounty(s.location),
    latitude: normalizeCoord(s.latitude, -90, 90),
    longitude: normalizeCoord(s.longitude, -180, 180),
    time: s.time ?? "",
    endTime: s.endTime ?? "",
    onSales: s.onSales ?? "UNKNOWN",
    price: s.price ?? "",
  }));

  return {
    uid: raw.UID,
    title: raw.title ?? "",
    startDate: raw.startDate ?? "",
    endDate: raw.endDate ?? "",
    imageUrl: raw.imageUrl && raw.imageUrl.trim() !== "" ? raw.imageUrl : null,
    description: shortDescription(raw.descriptionFilterHtml),
    showUnit: raw.showUnit ?? "",
    // showInfo 保留成陣列 — 一個展覽可能對應多個場次/地點（巡迴展），
    // 即使本次樣本每筆都恰好長度 1，資料模型仍不能寫死成單一地點。
    // 見 schema.md 第 3 節。
    showInfo,
  };
}

async function main() {
  const raw = JSON.parse(await readFile(inputPath, "utf-8"));
  if (!Array.isArray(raw)) {
    throw new Error(`輸入檔不是陣列：${inputPath}`);
  }

  const events = raw.map(buildEvent);

  await writeFile(outputPath, JSON.stringify(events), "utf-8");
  console.log(`已從 ${inputPath}（${raw.length} 筆）產生 ${outputPath}（${events.length} 筆）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
