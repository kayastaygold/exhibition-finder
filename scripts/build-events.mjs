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
// 縣市、行政區都要用同一個「最後一次出現的縣市位置」當基準去抽——樣本裡有
// 「臺中市40453 臺中市北區館前路一號」這種縣市名重複、中間夾著郵遞區號的寫法
// （見 schema.md 4-6），只有取最後一次出現的位置，才能正確跳過郵遞區號、
// 落在真正的縣市名之後去找行政區。用 "g" 旗標才能配合 matchAll 找出全部出現位置。
const COUNTY_PATTERN = new RegExp(`(${COUNTIES.join("|")})`, "g");

// 正體/俗體字同一縣市的顯示名稱一律正規化成正體（例如「台北市」→「臺北市」），
// 避免下拉選單裡出現同一縣市兩種寫法。
const COUNTY_CANONICAL = {
  "台北市": "臺北市",
  "台中市": "臺中市",
  "台南市": "臺南市",
  "台東縣": "臺東縣",
};

// 行政區（鄉/鎮/市/區）緊接在縣市名稱之後。用「非貪婪」比對，抽到第一個
// 鄉/鎮/市/區字尾就停——如果貪婪比對，像「花蓮縣壽豐鄉市場1號」的行政區會被
// 誤判成「壽豐鄉市」（把「市場」的「市」也吃進去），非貪婪才會正確停在「壽豐鄉」。
// （這個陷阱是實際用 sample.json 驗證時抓到的，見 schema.md 4-14）
const DISTRICT_PATTERN = /^([一-鿿]{1,6}?[鄉鎮市區])/;

// 找 location 字串裡「最後一次」出現的縣市名稱，回傳含比對位置的 match 物件或 null。
function findLastCountyMatch(location) {
  if (!location) return null;
  let last = null;
  for (const m of location.matchAll(COUNTY_PATTERN)) {
    last = m;
  }
  return last;
}

function extractCounty(location) {
  const m = findLastCountyMatch(location);
  if (!m) return null;
  return COUNTY_CANONICAL[m[1]] ?? m[1];
}

// 行政區在「最後一次出現的縣市名稱」之後緊接的文字裡找。找不到縣市時
// （見 schema.md 4-6：4.4% 的地址完全沒有縣市前綴），退而求其次直接對整個
// location 字串比對——樣本裡有 13 筆地址是「中正區羅斯福路...」這種直接以
// 行政區開頭、沒有縣市前綴的寫法，一樣抽得出行政區，只是沒有對應的縣市。
function extractDistrict(location) {
  if (!location) return null;
  const countyMatch = findLastCountyMatch(location);
  const remainder = countyMatch
    ? location.slice(countyMatch.index + countyMatch[0].length)
    : location;
  const m = DISTRICT_PATTERN.exec(remainder);
  return m ? m[1] : null;
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

// "YYYY/MM/DD" -> Date（UTC 午夜即可，這裡只用來比較日期，不管時區）
function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = s.split("/").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

// 判斷一筆活動是否為「常設展」（沒有真實限定展期，理論上會一直展出）。
//
// 這是啟發式判斷，不是資料源提供的欄位，來源資料完全沒有「是否為常設展」這種
// 欄位可以直接讀——只能從標題文字和日期形狀去猜。三個訊號任一成立就判定為常設展：
//
//   1. 標題關鍵字：含「常設」或「常態」（例如「○○常設展」），最直接的訊號。
//   2. 年度佔位日期：展期剛好卡在「1/1(或 1/2) ～ 12/31(或 12/30)」這種年度
//      邊界上。原本的規則只抓「某一年 1/1~12/31」的精確配對，太脆弱——樣本裡
//      同時有 1/2 起、12/30 迄的變形寫法，年份本身也不該寫死比對，所以改成看
//      「月/日」是否落在年度頭尾，不管年份、也放寬 1 天的容差。
//      （見 schema.md 4-13：42%+ 的資料用這種「全年」佔位值代替真實展期）
//   3. 展期長度：起訖日相差超過 2 年（730 天）。日期本身沒有卡在年度邊界、
//      標題也沒有關鍵字，但展期長達數年的，實務上也是常設/長期展（例如常設展
//      公告內文提到「更新常設展區」但標題沒寫「常設」兩個字的情況）。
//
// 這條規則不可能 100% 準確（樣本中仍有例如「大英博物館《埃及之王》」這種
// 展期近 11 個月、剛好卡到年底但屬於真正限時特展的案例，靠日期形狀本身無法
// 跟常設展完全區分開），但比單純比對「起訖日剛好等於某一年 1/1~12/31」穩健。
function isPermanentExhibition({ title, startDate, endDate }) {
  const titleHasKeyword = /常設|常態/.test(title ?? "");

  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end) return titleHasKeyword;

  const startsAtYearBoundary = start.getUTCMonth() === 0 && start.getUTCDate() <= 2;
  const endsAtYearBoundary = end.getUTCMonth() === 11 && end.getUTCDate() >= 30;
  const looksLikeYearPlaceholder = startsAtYearBoundary && endsAtYearBoundary;

  const durationDays = Math.round((end - start) / 86400000);
  const isVeryLongRunning = durationDays > 730;

  return titleHasKeyword || looksLikeYearPlaceholder || isVeryLongRunning;
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
    district: extractDistrict(s.location),
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
    isPermanent: isPermanentExhibition(raw),
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
