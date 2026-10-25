// 美術館官網探測第三輪：確認「能不能穩定解析出標題、展期、圖片」。
//   - 中美館：解碼列表頁內嵌的 Nuxt 3 payload（__NUXT_DATA__），列出所有展覽
//     （robots.txt 禁止 /wp-json/api，所以只讀頁面本身，不碰那個 API）
//   - 國美館：當期展覽／展覽預告列表頁，逐筆對出「標題、連結、展期、圖片」
//   - 新北美術館：找出前端 $.ajax 取資料的頁面，照它自己的參數 POST 一次
// 桃美館是 HiNet Anti-DDoS JavaScript 驗證，不嘗試繞過，這輪不再存取。
// 只讀、每次請求間隔 1 秒。

const UA = "Mozilla/5.0 (compatible; exhibition-finder-probe/1.0; +https://github.com/kayastaygold/exhibition-finder)";
const summary = [];
const say = (s = "") => { console.log(s); summary.push(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(url, { method = "GET", body, headers = {} } = {}) {
  await sleep(1000);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method, body, headers: { "User-Agent": UA, "Accept-Language": "zh-TW,zh;q=0.9", ...headers }, signal: AbortSignal.timeout(40000) });
    const text = await res.text();
    return { ok: res.ok, status: res.status, type: res.headers.get("content-type") ?? "", text, ms: Date.now() - t0 };
  } catch (err) {
    return { ok: false, status: 0, type: "", text: "", error: `${err.name}: ${err.cause?.code ?? err.message}`, ms: Date.now() - t0 };
  }
}
const fmt = (r) => (r.status ? `HTTP ${r.status}, ${r.type.split(";")[0] || "?"}, ${r.text.length} bytes, ${r.ms}ms` : `連線失敗（${r.error}）`);
const decode = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const strip = (h) => decode(h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const short = (s, n = 50) => (s ?? "").toString().replace(/\s+/g, " ").slice(0, n);

// ---------------- 中美館：Nuxt 3 payload 解碼 ----------------
// __NUXT_DATA__ 是 devalue 格式的扁平陣列：物件的值是「指向陣列索引的數字」，
// 另外有 ["Reactive", i]、["ShallowReactive", i]、["Ref", i]、["Set", ...]、["Map", ...]、["Date", s] 這類包裝。
function reviveNuxt(arr) {
  const memo = new Map();
  const WRAP = new Set(["Reactive", "ShallowReactive", "Ref", "ShallowRef", "EmptyRef", "EmptyShallowRef", "NuxtError", "Island"]);
  function at(i) {
    if (typeof i !== "number") return i;
    if (i < 0) return undefined; // devalue 的特殊值（undefined、NaN…）
    if (memo.has(i)) return memo.get(i);
    const v = arr[i];
    let out;
    if (Array.isArray(v)) {
      if (typeof v[0] === "string" && WRAP.has(v[0])) { memo.set(i, null); out = at(v[1]); }
      else if (v[0] === "Date") out = v[1];
      else if (v[0] === "Set") { out = []; memo.set(i, out); for (const x of v.slice(1)) out.push(at(x)); }
      else if (v[0] === "Map") { out = {}; memo.set(i, out); for (let k = 1; k < v.length; k += 2) out[String(at(v[k]))] = at(v[k + 1]); }
      else if (v[0] === "null") out = Object.create(null);
      else { out = []; memo.set(i, out); for (const x of v) out.push(at(x)); }
    } else if (v && typeof v === "object") {
      out = {}; memo.set(i, out);
      for (const [k, x] of Object.entries(v)) out[k] = at(x);
    } else out = v;
    memo.set(i, out);
    return out;
  }
  return at(0);
}
function collect(root, pred) {
  const found = [], seen = new Set();
  (function walk(n) {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (!Array.isArray(n) && pred(n)) found.push(n);
    for (const v of Array.isArray(n) ? n : Object.values(n)) walk(v);
  })(root);
  return found;
}
function firstImage(o) {
  const s = JSON.stringify(o.image ?? o.cover ?? o.thumbnail ?? "");
  return (s.match(/https?:[^"]+?\.(?:jpe?g|png|webp)/i) ?? [""])[0];
}

async function tcam() {
  say(`\n## 中美館：解碼 https://www.tcam.museum/zh/exhibition 內嵌的 Nuxt payload`);
  for (const url of ["https://www.tcam.museum/zh/exhibition", "https://www.tcam.museum/zh"]) {
    const r = await req(url);
    say(`  ${url}：${fmt(r)}`);
    const m = r.text.match(/<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!m) { say(`    找不到 __NUXT_DATA__`); continue; }
    let root;
    try { root = reviveNuxt(JSON.parse(m[1])); } catch (e) { say(`    解碼失敗：${e.message}`); continue; }
    const items = collect(root, (o) => "title" in o && "start_date" in o && "end_date" in o);
    const bySlug = new Map(items.map((o) => [o.slug ?? o.title, o]));
    say(`    有 title＋start_date＋end_date 的物件：${items.length} 個（依 slug 去重 ${bySlug.size} 個）`);
    const keys = [...new Set(items.flatMap((o) => Object.keys(o)))];
    say(`    這些物件的欄位：${keys.join("、")}`);
    const catOf = (o) => short(typeof o.category === "object" ? JSON.stringify(o.category) : o.category, 40);
    const cats = new Map(); const sts = new Map();
    for (const o of bySlug.values()) { cats.set(catOf(o), (cats.get(catOf(o)) ?? 0) + 1); sts.set(String(o.status), (sts.get(String(o.status)) ?? 0) + 1); }
    say(`    category 分布：${[...cats].map(([k, v]) => `${k}×${v}`).join("、")}`);
    say(`    status 分布：${[...sts].map(([k, v]) => `${k}×${v}`).join("、")}`);
    for (const o of [...bySlug.values()].slice(0, 30)) {
      const loc = typeof o.location === "object" ? JSON.stringify(o.location) : o.location;
      say(`      · ${short(o.title, 40)} | ${o.start_date} ~ ${o.end_date} | status=${o.status} | category=${catOf(o)} | location=${short(loc, 40)} | img=${short(firstImage(o), 90)} | slug=${short(decodeURIComponent(o.slug ?? ""), 30)}`);
    }
  }
}

// ---------------- 國美館：逐筆對出標題、連結、展期、圖片 ----------------
async function ntmofa() {
  for (const [label, url] of [
    ["當期展覽", "https://www.ntmofa.gov.tw/News_Actives_photo.aspx?n=1462&sms=11893"],
    ["展覽預告", "https://www.ntmofa.gov.tw/News_Actives_photo.aspx?n=1464&sms=11893"],
  ]) {
    say(`\n## 國美館 ${label}：${url}`);
    const r = await req(url);
    say(`  ${fmt(r)}`);
    if (!r.ok) continue;
    const html = r.text;
    // 以每個日期區間在原始 HTML 的位置為準，往前找最近的 <a>（標題、連結）跟 <img>
    const DATE = /(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\s*[~～-]\s*(?:(20\d{2})[-/.])?(\d{1,2})[-/.](\d{1,2})/g;
    const rows = [];
    for (const m of html.matchAll(DATE)) {
      const before = html.slice(Math.max(0, m.index - 4000), m.index);
      const as = [...before.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*(?:title=["']([^"']*)["'])?[^>]*>([\s\S]*?)<\/a>/gi)];
      const a = as.reverse().find((x) => strip(x[3]).length > 4 || (x[2] ?? "").length > 4);
      const imgs = [...before.matchAll(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/gi)].map((x) => x[1]).filter((s) => !s.startsWith("data:"));
      rows.push({ date: m[0], title: a ? short(strip(a[3]) || decode(a[2] ?? ""), 50) : "?", href: a ? new URL(decode(a[1]), url).href : "?", img: imgs.at(-1) ?? "" });
    }
    const uniq = [...new Map(rows.map((x) => [x.href + x.date, x])).values()];
    say(`  日期區間 ${rows.length} 個，對到的展覽 ${uniq.length} 筆：`);
    for (const x of uniq) say(`    · ${x.title} | ${x.date} | ${x.href} | img=${short(x.img, 90)}`);
    const hrefPatterns = new Map();
    for (const x of uniq) { const p = x.href.replace(/\d+/g, "N"); hrefPatterns.set(p, (hrefPatterns.get(p) ?? 0) + 1); }
    say(`  連結網址樣式：${[...hrefPatterns].map(([k, v]) => `${k}×${v}`).join("、")}`);
    const pager = strip(html).match(/(?:共\s*\d+\s*(?:筆|頁)|第\s*\d+\s*頁|\d+\s*\/\s*\d+\s*頁|下一頁)/g);
    say(`  分頁相關文字：${pager ? [...new Set(pager)].join("、") : "沒有"}`);

    const sample = uniq.find((x) => x.href !== "?");
    if (sample && label === "當期展覽") {
      const d = await req(sample.href);
      say(`  詳細頁 ${sample.href}：${fmt(d)}`);
      if (d.ok) {
        const t = strip(d.text);
        const og = (p) => (d.text.match(new RegExp(`<meta[^>]+property=["']og:${p}["'][^>]+content=["']([^"']*)`, "i")) ?? [, ""])[1];
        say(`    og:title=${og("title")}｜og:image=${og("image")}`);
        for (const kw of ["展覽日期", "日期", "展期", "地點", "展覽地點", "展覽室"]) {
          const i = t.indexOf(kw);
          if (i >= 0) say(`    「${kw}」附近：${JSON.stringify(t.slice(i, i + 80))}`);
        }
      }
    }
  }
}

// ---------------- 新北美術館：找出前端取資料的頁面 ----------------
async function ntcart() {
  say(`\n## 新北美術館：找出 $.ajax 取資料的頁面`);
  const home = await req("https://ntcart.museum/");
  const aspx = [...new Set([...home.text.matchAll(/href=["']([^"'{}#]+\.aspx[^"'{}#]*)["']/gi)].map((m) => new URL(decode(m[1]), "https://ntcart.museum/").href))];
  say(`  首頁裡的 .aspx 連結（${aspx.length}）：${aspx.slice(0, 40).join("、")}`);
  const pn = [...home.text.matchAll(/pagename\s*[:=]\s*([^,;\n]+)/gi)].map((m) => m[1].trim());
  say(`  首頁 script 裡 pagename 的定義：${[...new Set(pn)].slice(0, 5).join("｜") || "沒找到"}`);

  const candidates = [...new Set([
    ...aspx.filter((u) => /exhibit|archive|exh/i.test(u) && !/content/i.test(u)),
    "https://ntcart.museum/exhibition.aspx", "https://ntcart.museum/exhibition_list.aspx", "https://ntcart.museum/archive.aspx",
  ])].slice(0, 5);
  for (const url of candidates) {
    const r = await req(url);
    say(`  ${url}：${fmt(r)}`);
    if (!r.ok) continue;
    const scripts = [...r.text.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
    const s = scripts.find((x) => /q:\s*["']get["']/.test(x));
    if (!s) { say(`    這頁沒有 q:"get" 的 ajax`); continue; }
    const searchLit = (s.match(/search\s*=\s*(\{[^;]*?\})\s*[,;]/) ?? [, ""])[1];
    const pagename = (s.match(/pagename\s*[:=]\s*["']([^"']+)["']/) ?? r.text.match(/pagename\s*[:=]\s*["']([^"']+)["']/) ?? [, ""])[1];
    say(`    search 物件：${searchLit || "?"}；pagename：${pagename || "（沒寫死，可能是 location.pathname）"}`);
    // 不執行網站的 JS：只把 { ps: 12, Kind: "" } 這種物件字面值轉成 JSON 解析，失敗就用第二輪看到的預設值
    let search = { ps: 12, Kind: "" };
    try { search = JSON.parse(searchLit.replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":').replace(/'/g, '"')); } catch {}
    const postUrl = pagename ? new URL(pagename, url).href : url;
    const body = new URLSearchParams({ q: "get", r: String(Math.random()), data: JSON.stringify(search) });
    const pr = await req(postUrl, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest", Accept: "application/json, text/javascript, */*; q=0.01" } });
    say(`    POST ${postUrl}（q=get, data=${JSON.stringify(search)}）：${fmt(pr)}`);
    try {
      const j = JSON.parse(pr.text);
      const arr = Array.isArray(j) ? j : Object.values(j).find(Array.isArray) ?? [];
      say(`    JSON 頂層：${Array.isArray(j) ? "陣列" : Object.keys(j).join("、")}；資料 ${arr.length} 筆`);
      if (arr[0]) say(`    欄位：${Object.keys(arr[0]).join("、")}`);
      for (const x of arr.slice(0, 15)) say(`      · ${short(x.ExName ?? x.EvName ?? x.Name, 45)} | ${x.ExDateSt ?? x.EvDateSt ?? "?"} ~ ${x.ExDateEn ?? x.EvDateEn ?? "?"} | img=${short(x.ExListImg ?? x.EvListImg, 70)} | id=${x.ExNo ?? x.EvNo ?? "?"}`);
      if (!Array.isArray(j)) for (const [k, v] of Object.entries(j)) if (!Array.isArray(v)) say(`    ${k}=${short(JSON.stringify(v), 80)}`);
    } catch {
      say(`    回應不是 JSON，前 300 字：${JSON.stringify(pr.text.slice(0, 300))}`);
    }
    break;
  }
}

for (const fn of [tcam, ntmofa, ntcart]) {
  try { await fn(); } catch (err) { say(`  ❌ 探測程式錯誤：${err.stack?.split("\n").slice(0, 3).join(" ")}`); }
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, "```\n" + summary.join("\n") + "\n```\n");
}
