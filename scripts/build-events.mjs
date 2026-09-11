#!/usr/bin/env node
// 把文化部展覽 API 的原始 JSON（見 schema.md）轉成前端讀取用的精簡靜態檔 events.json，
// 再疊上北美館（TFAM，見 schema.md 第 8 節、issue #5）跟文化快遞（Culture Express，
// 見 schema.md 第 10 節）的資料。
//
// 用法：
//   node scripts/build-events.mjs [文化部輸入檔路徑] [輸出檔路徑]
//   預設文化部輸入 ./sample.json，輸出 ./events.json
//
// 這支腳本只做「轉換」，不做「抓取」——抓取（呼叫 cloud.culture.tw、data.taipei、
// cultureexpress.taipei）之後由 GitHub Actions 排程另外處理（見 schema.md 第 5 節），
// 這裡先用本地的 sample.json 當輸入，之後把抓取結果換掉輸入檔即可,不用改這支腳本。
//
// 北美館資料源固定讀 data/tfam-raw.json（data.taipei API 的原始回傳，選用——
// 這個檔案還不存在也沒關係，見下方 loadTfamEvents() 的說明）跟
// data/tfam-overrides.json（人工補值，必要）。
//
// 文化快遞資料源固定讀 data/culture-express-raw.json（cultureexpress.taipei
// C000003 端點的原始回傳快照，選用——不存在就跳過，見下方 loadCultureExpressEvents()）。

import { readFile, writeFile } from "node:fs/promises";

const inputPath = process.argv[2] ?? "sample.json";
const outputPath = process.argv[3] ?? "events.json";
const TFAM_RAW_PATH = "data/tfam-raw.json";
const TFAM_OVERRIDES_PATH = "data/tfam-overrides.json";
const CULTURE_EXPRESS_RAW_PATH = "data/culture-express-raw.json";

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

// 判斷一筆活動是否為「線上展」（純線上平台展出，沒有實體場地可去）。
// 來源資料仍會把線上展掛在某個縣市底下（見 issue #2），對地點篩選是雜訊。
//
// 只比對**標題**，不比對簡介——驗證時發現比對簡介會誤判：「量水器室特展」的
// 簡介提到「文資網線上特展」，但那其實是一檔首度開放現場參觀的實體特展，線上
// 只是附加的導覽形式，不該被歸類成線上展。標題比對在樣本裡沒有這個問題。
//
// 關鍵字「雲端」限定要接「展/策展/平台」才算數（`雲端(展|策展|平台)`），不能
// 裸比對「雲端」兩個字——「雲端上的白鷹－熊鷹特展」標題有「雲端」，但那是一檔
// 在遊客中心展出標本、3D 列印模型的實體特展，「雲端」在這裡是「翱翔雲端」的
// 字面意思，跟「雲端平台」無關，裸比對會誤判。
function isOnlineExhibition({ title }) {
  return /線上|virtual|雲端(展|策展|平台)/i.test(title ?? "");
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
    isOnline: isOnlineExhibition(raw),
    // 跟 tfam/culture_express 事件一樣標出資料來源，方便除錯／未來依來源篩選
    // （見 schema.md 第 10 節整合文化快遞時一併補上，之前只有 tfam 事件有這個欄位）。
    source: "moc",
    // showInfo 保留成陣列 — 一個展覽可能對應多個場次/地點（巡迴展），
    // 即使本次樣本每筆都恰好長度 1，資料模型仍不能寫死成單一地點。
    // 見 schema.md 第 3 節。
    showInfo,
  };
}

// 北美館（TFAM）用 data.taipei 的展覽 API 當主要資料源，但這支 API 缺
// startDate/endDate/imageUrl/location 四個欄位（見 issue #5 調查結果），要靠
// data/tfam-overrides.json 人工補值。兩邊用 title 當比對 key（data.taipei 的
// 展覽資料沒有 UID 可用）。
//
// 欄位對應（data.taipei → 我們的資料模型，見 issue #5）：
//   title      → title
//   內容        → description（品質好，直接用，不用像 descriptionFilterHtml 那樣消毒摘要）
//   發布單位     → showUnit
//   （countycode 固定是台北市，但既然 override 本來就要手動給 location，
//     county/district 交給 extractCounty/extractDistrict 從 override 的 location 算，
//     不用另外處理 countycode）
//
// 為什麼要能在「raw 沒有這筆」的情況下還是產生事件：overrides 裡有兩筆
// （王雅慧、調）是北美館官網有、但 data.taipei API 沒有的展覽，整筆資料都是
// 人工建的，不是「補值」而是「新增」，見 issue #5 討論。

// 簡單、無相依套件的字串雜湊（djb2），拿來把 title 轉成穩定的 uid 後綴——
// 同一個 title 每次 build 都會產生同一個 uid，不會因為陣列順序變動而跳號。
function stableSlug(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

// 讀取 data.taipei 的原始 TFAM 展覽資料（如果檔案存在）跟人工 override
// （data/tfam-overrides.json，必要），合併成跟 buildEvent() 輸出一樣的事件物件陣列。
//
// tfam-raw.json 目前還沒有抓取流程（見檔案開頭的說明），所以刻意設計成
// 「檔案不存在就當作空陣列」而不是拋錯——這樣 overrides 裡的每一筆還是會照樣
// 產生事件（只是 description/showUnit 會是空字串，因為沒有 raw 資料可以補），
// 之後接上真正的抓取流程也不用改這支腳本。
async function loadTfamEvents() {
  let overrides;
  try {
    overrides = JSON.parse(await readFile(TFAM_OVERRIDES_PATH, "utf-8"));
  } catch (err) {
    if (err.code === "ENOENT") {
      console.log(`${TFAM_OVERRIDES_PATH} 不存在，略過北美館資料`);
      return [];
    }
    throw err;
  }

  let rawByTitle = new Map();
  try {
    const raw = JSON.parse(await readFile(TFAM_RAW_PATH, "utf-8"));
    for (const r of raw) {
      rawByTitle.set(r.title, r);
    }
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    console.log(`${TFAM_RAW_PATH} 不存在，北美館展覽的 description/showUnit 先留空`);
  }

  return overrides.map((override) => {
    const raw = rawByTitle.get(override.title) ?? {};

    const showInfoEntry = {
      location: override.location ?? "",
      locationName: override.locationName ?? "",
      county: extractCounty(override.location),
      district: extractDistrict(override.location),
      latitude: normalizeCoord(override.latitude, -90, 90),
      longitude: normalizeCoord(override.longitude, -180, 180),
      time: "",
      endTime: "",
      onSales: "UNKNOWN",
      price: "",
    };

    const merged = {
      title: override.title,
      startDate: override.startDate,
      endDate: override.endDate,
    };

    return {
      uid: `tfam-${stableSlug(override.title)}`,
      title: override.title,
      startDate: override.startDate,
      endDate: override.endDate,
      imageUrl: override.imageUrl && override.imageUrl.trim() !== "" ? override.imageUrl : null,
      description: raw.內容 ?? "",
      showUnit: raw.發布單位 ?? "",
      isPermanent: isPermanentExhibition(merged),
      // isOnline 優先用 override 明講的值（例如 Net.Open 標題沒有「線上」兩個字，
      // 一般的關鍵字規則抓不到，靠人工標記），override 沒講才用一般規則猜。
      isOnline: "isOnline" in override ? Boolean(override.isOnline) : isOnlineExhibition(merged),
      source: "tfam",
      showInfo: [showInfoEntry],
    };
  });
}

// 文化快遞（台北市文化局，cultureexpress.taipei C000003）資料源整合。
// 見 schema.md 第 10 節、issue 討論的分析結果與整合方案。
//
// 跟文化部/北美館不同，文化快遞這支 API 一次回傳「展覽、講座、表演、音樂現場…」
// 共 9 種 Category 混在同一個陣列裡，所以要先篩出 Category === "展覽" 才是我們要的。
//
// 日期格式是 "YYYY-MM-DD HH:MM:SS"（文化部是 "YYYY/MM/DD"），要先轉換格式，
// 這樣才能重用既有的 parseDate()/isPermanentExhibition() 等函式，不用另外寫一套。
function toSlashDate(s) {
  if (!s) return "";
  const datePart = s.split(" ")[0];
  const [y, m, d] = datePart.split("-");
  if (!y || !m || !d) return "";
  return `${y}/${m}/${d}`;
}

// showInfo.time/endTime 保留完整日期+時間（跟文化部樣本裡 "2026/09/08 09:00:00"
// 這種格式一致），只把日期部分的連字號換成斜線，時間部分原樣保留。
function toSlashDateTime(s) {
  if (!s) return "";
  const [datePart, timePart] = s.split(" ");
  const slashDate = toSlashDate(datePart);
  if (!slashDate) return "";
  return timePart ? `${slashDate} ${timePart}` : slashDate;
}

// 座標欄位有兩種已知的髒值模式（實測樣本，見 schema.md 第 10 節）：
//   1. sentinel 值：地點未知時 Longitude/Latitude 都是 0.0（不是 null），
//      直接判 0/0 為「無座標」，避免被 normalizeCoord() 誤判成大西洋幾內亞灣的座標。
//   2. 兩欄互換：少數資料把經緯度寫反，數值本身仍落在合理範圍，只是欄位對調
//      （Longitude 落在台灣緯度的區間 24~26、Latitude 落在台灣經度的區間 120~122）。
//      這個規則抓的是「數值形狀」不是欄位名稱，抓到就對調回來。
// 兩個規則都不成立的情況，維持原樣，最後仍會過 normalizeCoord() 做範圍防呆。
function fixCoordSwap(lng, lat) {
  const lngNum = Number(lng);
  const latNum = Number(lat);
  if (lngNum === 0 && latNum === 0) return { lat: null, lng: null };
  if (
    !Number.isNaN(lngNum) &&
    !Number.isNaN(latNum) &&
    lngNum >= 24 &&
    lngNum <= 26 &&
    latNum >= 120 &&
    latNum <= 122
  ) {
    return { lat: lngNum, lng: latNum };
  }
  return { lat: latNum, lng: lngNum };
}

// 去標點、去空白、轉小寫，拿掉常見的全形/半形符號差異對比對結果的影響。
// 用來給 titleSimilarity()/venuesMatch() 比對前正規化字串。
function normalizeForCompare(s) {
  if (!s) return "";
  return s
    .replace(/[「」『』【】[\]（）()\-—－:：,，。.!！?？、\s]/g, "")
    .toLowerCase();
}

// 無相依套件的最長共同子序列（LCS）長度（標準 DP 寫法）。
function longestCommonSubsequenceLength(a, b) {
  const m = a.length;
  const n = b.length;
  let prev = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    const curr = new Array(n + 1).fill(0);
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    prev = curr;
  }
  return prev[n];
}

// 標題相似度：2 * LCS長度 / (兩字串長度總和)，範圍 0~1，兩邊都是空字串視為相同（1）。
// 這個公式（Dice 係數）刻意選來貼近分析階段用 Python difflib.SequenceMatcher.ratio()
// 算出來的數字，而不是用編輯距離（Levenshtein）——實測編輯距離版本會誤判「加了場館
// 前綴」的狀況：文化快遞常把場館名當標題前綴（例如「北美館 - 共感：存在的節奏」對應
// 文化部/北美館那邊單純的「共感：存在的節奏」），這種「整段前綴」在編輯距離下會被
// 當成一長串插入成本，把相似度拉到 0.8 門檻以下；但用 LCS 為基礎的比率，因為分母是
// 「兩邊長度總和」而不是「較長字串長度」，這種前綴差異影響小很多，「共感：存在的節奏」
// 這組算出來是 0.82，跟分析階段的數字一致，門檻抓 > 0.8 也一樣能排除掉
// 「大稻埕戲苑【請戲–布袋戲一條街】特展」vs「【特展】「請戲-布袋戲一條街」特展」
// 這種措辭差異較大、不該視為同一筆的案例（算出來 0.71，低於門檻）。
function titleSimilarity(a, b) {
  const normA = normalizeForCompare(a);
  const normB = normalizeForCompare(b);
  const totalLen = normA.length + normB.length;
  if (totalLen === 0) return 1;
  const lcsLen = longestCommonSubsequenceLength(normA, normB);
  return (2 * lcsLen) / totalLen;
}

// 場地是否相同：把兩個事件物件（buildEvent()/loadTfamEvents()/
// buildCultureExpressEvent() 輸出的統一格式）能代表「場地」的字串都收集起來
// （showUnit 主辦單位 + 每個 showInfo 的 locationName/location），正規化後
// 互相比對是否有任一組是子字串關係。用「互相包含」而不要求完全相等，是因為
// 同一場館在不同資料源常有不同寫法（例如「朱銘美術館」vs「(中華民國)朱銘」、
// 「臺博館古生物館」vs「國立臺灣博物館」），完全相等比對會漏掉太多真正相同的場地。
function collectVenueStrings(event) {
  const strings = [event.showUnit ?? ""];
  for (const s of event.showInfo ?? []) {
    if (s.locationName) strings.push(s.locationName);
    if (s.location) strings.push(s.location);
  }
  return strings.map(normalizeForCompare).filter((s) => s !== "");
}

function venuesMatch(eventA, eventB) {
  const venuesA = collectVenueStrings(eventA);
  const venuesB = collectVenueStrings(eventB);
  for (const a of venuesA) {
    for (const b of venuesB) {
      if (a.includes(b) || b.includes(a)) return true;
    }
  }
  return false;
}

// 是否為同一檔展覽：場地要相同，且標題相似度 > 0.8（見 titleSimilarity() 的
// 演算法選擇說明）。這是您在分析階段確認的去重標準。
function isSameExhibition(eventA, eventB) {
  if (!venuesMatch(eventA, eventB)) return false;
  return titleSimilarity(eventA.title, eventB.title) > 0.8;
}

// 把文化快遞單筆原始資料（Category === "展覽" 的那些）轉成跟 buildEvent()/
// loadTfamEvents() 一致的事件物件。
//
// location 欄位的組法：文化快遞的 Address 欄位實測發現永遠等於 Area（都只是
// 行政區名稱，不是完整街址，例：Area/Address 都是 "中正區"），所以不直接用
// Address，改用 City + Area 組出 "臺北市中正區" 這種字串餵給既有的
// extractCounty()/extractDistrict()；City 是 null 時（實測 343 筆裡有 3 筆
// 展覽類是 null，通常是純線上/海外活動）location 就是空字串，county/district
// 自然算出 null，不硬湊假資料。
function buildCultureExpressEvent(raw) {
  const startDate = toSlashDate(raw.StartDate);
  const endDate = toSlashDate(raw.EndDate);
  const { lat, lng } = fixCoordSwap(raw.Longitude, raw.Latitude);

  const showInfoEntry = {
    location: `${raw.City ?? ""}${raw.Area ?? ""}`,
    locationName: raw.Venue ?? "",
    county: extractCounty(`${raw.City ?? ""}${raw.Area ?? ""}`),
    district: extractDistrict(`${raw.City ?? ""}${raw.Area ?? ""}`),
    latitude: normalizeCoord(lat, -90, 90),
    longitude: normalizeCoord(lng, -180, 180),
    time: toSlashDateTime(raw.SessionStartDate),
    endTime: toSlashDateTime(raw.SessionEndDate),
    // onSales 沿用文化部樣本的語意（見 schema.md 4-11："Y"=售票、"N"=不須購票、
    // "UNKNOWN"=未知），文化快遞的 TicketType 用「免費」對應 "N"、「售票」/「索票」
    // 對應 "Y"，沒有 TicketType 資訊的才算 "UNKNOWN"。
    onSales: raw.TicketType === "免費" ? "N" : raw.TicketType ? "Y" : "UNKNOWN",
    price: raw.TicketPrice ?? "",
  };

  const merged = { title: raw.Caption, startDate, endDate };

  return {
    uid: `ce-${raw.ID}`,
    title: raw.Caption ?? "",
    startDate,
    endDate,
    // ImageFile 原封不動使用（先測試能否正常顯示，見整合方案討論），
    // 不像 descriptionFilterHtml 那樣需要另外消毒或轉址。
    imageUrl: raw.ImageFile && raw.ImageFile.trim() !== "" ? raw.ImageFile : null,
    description: shortDescription(raw.Introduction),
    showUnit: raw.Company ?? "",
    isPermanent: isPermanentExhibition(merged),
    isOnline: isOnlineExhibition(merged),
    source: "culture_express",
    showInfo: [showInfoEntry],
  };
}

// 讀取文化快遞原始快照（data/culture-express-raw.json，如果不存在就優雅降級、
// 回傳空陣列——這支腳本目前還沒有真正呼叫 cultureexpress.taipei 的抓取步驟，
// 跟 tfam-raw.json 是一樣的設計）。
//
// 只保留 Category === "展覽" 的資料；同一個活動有多個場次時，原始資料會有多筆
// ID 相同、只有 SessionStartDate/SessionEndDate 不同的列——實測目前只有 1 組
// 這種情況，而且兩筆內容完全相同，所以用 ID 去重時直接保留第一筆即可，不需要
// 把多個場次合併進同一個事件的 showInfo 陣列（跟文化部那種一個展覽對應多個
// showInfo 的情況不一樣）。
async function loadCultureExpressEvents() {
  let raw;
  try {
    raw = JSON.parse(await readFile(CULTURE_EXPRESS_RAW_PATH, "utf-8"));
  } catch (err) {
    if (err.code === "ENOENT") {
      console.log(`${CULTURE_EXPRESS_RAW_PATH} 不存在，略過文化快遞資料`);
      return [];
    }
    throw err;
  }

  const exhibitions = raw.filter((r) => r.Category === "展覽");
  const seenIds = new Set();
  const deduped = [];
  for (const r of exhibitions) {
    if (seenIds.has(r.ID)) continue;
    seenIds.add(r.ID);
    deduped.push(r);
  }

  return deduped.map(buildCultureExpressEvent);
}

async function main() {
  const raw = JSON.parse(await readFile(inputPath, "utf-8"));
  if (!Array.isArray(raw)) {
    throw new Error(`輸入檔不是陣列：${inputPath}`);
  }

  const cultureEvents = raw.map(buildEvent);
  const tfamEvents = await loadTfamEvents();
  const ceEvents = await loadCultureExpressEvents();

  // 文化快遞資料跟文化部/北美館重疊時（同一檔展覽，標題相似度 > 0.8 且場地相同），
  // 保留文化快遞版本（有圖片，資料品質較好），從對應的來源陣列移除被取代的那筆。
  // tfam-overrides.json 本身不刪這兩筆——只是 build 出來的 events.json 不會再包含
  // 它們的 tfam 版本，改用文化快遞版本。見整合方案討論。
  let remainingCultureEvents = [...cultureEvents];
  let remainingTfamEvents = [...tfamEvents];
  let mocReplacedCount = 0;
  let tfamReplacedCount = 0;

  for (const ce of ceEvents) {
    const mocMatchIdx = remainingCultureEvents.findIndex((ev) => isSameExhibition(ce, ev));
    if (mocMatchIdx !== -1) {
      remainingCultureEvents.splice(mocMatchIdx, 1);
      mocReplacedCount++;
      continue;
    }
    const tfamMatchIdx = remainingTfamEvents.findIndex((ev) => isSameExhibition(ce, ev));
    if (tfamMatchIdx !== -1) {
      remainingTfamEvents.splice(tfamMatchIdx, 1);
      tfamReplacedCount++;
    }
  }

  const events = [...remainingCultureEvents, ...remainingTfamEvents, ...ceEvents];

  await writeFile(outputPath, JSON.stringify(events), "utf-8");
  console.log(
    `已從 ${inputPath}（${raw.length} 筆，去重後 ${remainingCultureEvents.length} 筆）` +
      `+ 北美館（${tfamEvents.length} 筆，去重後 ${remainingTfamEvents.length} 筆）` +
      `+ 文化快遞（${ceEvents.length} 筆，取代了文化部 ${mocReplacedCount} 筆、北美館 ${tfamReplacedCount} 筆）` +
      `產生 ${outputPath}（${events.length} 筆）`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
