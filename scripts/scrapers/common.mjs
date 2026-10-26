// 美術館官網爬取（type: "scrape"）共用的小工具：HTML 轉文字、日期解析、輸出驗證。
// 各館的爬取函式輸出統一格式的「美術館 raw 紀錄」，存進 data/<id>-raw.json，
// 由 build-events.mjs 的 loadMuseumEvents() 轉成事件（見 schema.md 第 11 節）：
//
//   { id, title, startDate: "YYYY/MM/DD", endDate: "YYYY/MM/DD",
//     imageUrl, url, venueText, description }
//
// venueText 是官網寫的展出地點原文（可能只是「6B展覽室」，也可能是館外地點），
// 怎麼對應到縣市由 build 端決定。

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", ldquo: "“", rdquo: "”", hellip: "…" };

export function decodeEntities(s) {
  return (s ?? "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

// HTML 轉純文字；<br>、</p>、</div>、</li> 轉成換行，保留「一行一個欄位」的結構，
// 方便用「展覽地點│…」這種標籤逐行取值。
export function htmlToText(html) {
  return decodeEntities(
    (html ?? "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h\d|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

const pad = (n) => String(n).padStart(2, "0");

function validYmd(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// 從一段文字裡找出第一個日期區間，回傳 { startDate, endDate }（"YYYY/MM/DD"）或 null。
// 支援官網常見的寫法：
//   2026-09-05 ~ 2026-11-15、2026/09/05-11/15（迄日省略年份）、
//   2026.5.22—2026.10.26、2026/08/29 (六) – 2026/10/25
// 迄日省略年份時沿用起日年份；迄日早於起日就當作跨年（+1 年）。
const RANGE = /(20\d{2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})\s*(?:[(（][^)）]{1,4}[)）])?\s*[-–—~～至]\s*(?:(20\d{2})\s*[./-]\s*)?(\d{1,2})\s*[./-]\s*(\d{1,2})/;

export function parseDateRange(text) {
  const m = RANGE.exec(text ?? "");
  if (!m) return null;
  const [, y1, m1, d1, y2raw, m2, d2] = m.map((x) => (x === undefined ? x : Number(x)));
  let y2 = y2raw ?? y1;
  if (!y2raw && (m2 < m1 || (m2 === m1 && d2 < d1))) y2 = y1 + 1;
  if (!validYmd(y1, m1, d1) || !validYmd(y2, m2, d2)) return null;
  const startDate = `${y1}/${pad(m1)}/${pad(d1)}`;
  const endDate = `${y2}/${pad(m2)}/${pad(d2)}`;
  if (endDate < startDate) return null;
  return { startDate, endDate };
}

// ASP.NET 的 "/Date(1792166400000)/" → 台灣時間的 "YYYY/MM/DD"。
export function aspNetDateToSlash(value) {
  const m = /\/Date\((-?\d+)\)\//.exec(value ?? "");
  if (!m) return null;
  const d = new Date(Number(m[1]) + 8 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`;
}

const SLASH_DATE = /^\d{4}\/\d{2}\/\d{2}$/;

// 每一筆都必須有標題、合法的起訖日，否則整個來源當作抓取失敗
// （fetch-sources.mjs 會沿用上一次的 raw 檔）——網站改版、解析規則失效時，
// 寧可停在舊資料，也不要把解析壞掉的資料寫進來。
export function assertValidMuseumRecords(records, label) {
  if (!Array.isArray(records)) throw new Error(`${label}：解析結果不是陣列`);
  records.forEach((r, i) => {
    const where = `${label} 第 ${i + 1} 筆（${r?.title || r?.id || "?"}）`;
    if (!r?.id) throw new Error(`${where}：缺 id`);
    if (!r.title?.trim()) throw new Error(`${where}：缺標題`);
    if (!SLASH_DATE.test(r.startDate ?? "")) throw new Error(`${where}：起日格式不對（${r.startDate}）`);
    if (!SLASH_DATE.test(r.endDate ?? "")) throw new Error(`${where}：迄日格式不對（${r.endDate}）`);
    if (r.endDate < r.startDate) throw new Error(`${where}：迄日早於起日`);
  });
  return records;
}

// 只有一個日期（沒有區間）時用：「2025.10.28」「2025/12/13 起」→ "YYYY/MM/DD" 或 null。
const SINGLE = /(20\d{2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})/;
export function parseSingleDate(text) {
  const m = SINGLE.exec(text ?? "");
  if (!m) return null;
  const [y, mo, d] = m.slice(1).map(Number);
  return validYmd(y, mo, d) ? `${y}/${pad(mo)}/${pad(d)}` : null;
}

// Nuxt 3 頁面內嵌的 <script id="__NUXT_DATA__">（devalue 格式的扁平陣列）解碼成一般物件。
// 物件的值是「指向陣列索引的數字」，另外有 ["Reactive", i]、["Set", ...]、["Map", ...]、
// ["Date", s] 這類包裝；負數索引是 undefined 等特殊值。只解析資料，不執行任何程式碼。
export function reviveNuxtData(arr) {
  const memo = new Map();
  const WRAP = new Set(["Reactive", "ShallowReactive", "Ref", "ShallowRef", "EmptyRef", "EmptyShallowRef", "NuxtError", "Island"]);
  const at = (i) => {
    if (typeof i !== "number") return i;
    if (i < 0) return undefined;
    if (memo.has(i)) return memo.get(i);
    const v = arr[i];
    let out;
    if (Array.isArray(v)) {
      if (typeof v[0] === "string" && WRAP.has(v[0])) { memo.set(i, null); out = at(v[1]); }
      else if (v[0] === "Date") out = v[1];
      else if (v[0] === "Set") { out = []; memo.set(i, out); for (const x of v.slice(1)) out.push(at(x)); }
      else if (v[0] === "Map") { out = {}; memo.set(i, out); for (let k = 1; k < v.length; k += 2) out[String(at(v[k]))] = at(v[k + 1]); }
      else { out = []; memo.set(i, out); for (const x of v) out.push(at(x)); }
    } else if (v && typeof v === "object") {
      out = {}; memo.set(i, out);
      for (const [k, x] of Object.entries(v)) out[k] = at(x);
    } else out = v;
    memo.set(i, out);
    return out;
  };
  return at(0);
}
