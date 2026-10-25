// 美術館官網探測第二輪：第一輪發現中美館、新北美術館是前端框架網站（HTML 裡沒有展覽資料），
// 國美館的列表頁被候選篩選規則漏掉，桃美館全部回 HTTP 428。這輪逐館看資料實際在哪裡。
// 只讀、每次請求間隔 1 秒；不嘗試繞過任何防護（桃美館只記錄回應內容）。

const UA = "Mozilla/5.0 (compatible; exhibition-finder-probe/1.0; +https://github.com/kayastaygold/exhibition-finder)";
const summary = [];
const say = (s = "") => { console.log(s); summary.push(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, accept = "*/*") {
  await sleep(1000);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "zh-TW,zh;q=0.9" }, signal: AbortSignal.timeout(40000) });
    const text = await res.text();
    return { ok: res.ok, status: res.status, headers: res.headers, type: res.headers.get("content-type") ?? "", text, ms: Date.now() - t0 };
  } catch (err) {
    return { ok: false, status: 0, text: "", type: "", error: `${err.name}: ${err.cause?.code ?? err.message}`, ms: Date.now() - t0 };
  }
}
const fmt = (r) => (r.status ? `HTTP ${r.status}, ${r.type.split(";")[0] || "?"}, ${r.text.length} bytes, ${r.ms}ms` : `連線失敗（${r.error}）`);
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const DATE_RANGE = /(20\d{2})\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{1,2}\s*(?:\([^)]*\)|（[^）]*）)?\s*[-–—~～至]\s*(?:(20\d{2})\s*[./-]\s*)?\d{1,2}\s*[./-]\s*\d{1,2}/g;
const og = (html, p) => (html.match(new RegExp(`<meta[^>]+property=["']og:${p}["'][^>]+content=["']([^"']*)`, "i")) ?? [, ""])[1];
function anchors(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try { out.push({ href: new URL(m[1].replace(/&amp;/g, "&"), base).href, text: strip(m[2]).slice(0, 70) }); } catch {}
  }
  return out;
}
function around(text, needle, n = 300) {
  const i = text.indexOf(needle);
  return i < 0 ? null : text.slice(Math.max(0, i - n / 3), i + n);
}
function datesWithContext(text, max = 8) {
  return [...text.matchAll(DATE_RANGE)].slice(0, max).map((m) => `${m[0].replace(/\s+/g, "")} ← …${text.slice(Math.max(0, m.index - 60), m.index).trim().slice(-60)}`);
}

// ---------------- 中美館 ----------------
async function tcam() {
  say(`\n## 中美館 https://www.tcam.museum`);
  // 1. sitemap
  const idx = await get("https://www.tcam.museum/sitemap_index.xml");
  say(`  sitemap_index.xml：${fmt(idx)}`);
  const children = [...idx.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  for (const c of children) {
    const r = await get(c);
    const locs = [...r.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decodeURIComponent(m[1].trim()));
    const lastmods = [...r.text.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
    const ex = locs.filter((u) => /\/exhibition\//.test(u));
    say(`  ${c}：${fmt(r)}，${locs.length} 個網址，展覽頁 ${ex.length} 個，lastmod 最新 ${lastmods.sort().at(-1) ?? "?"}`);
    for (const u of ex.slice(0, 8)) say(`    · ${u}`);
  }

  // 2. 列表頁與詳細頁的 Nuxt payload
  for (const url of [
    "https://www.tcam.museum/zh/exhibition",
    "https://www.tcam.museum/zh/exhibition/%e7%9c%9f%e9%8d%8b%e5%a4%a7%e5%ba%a6%e5%80%8b%e5%b1%95%e3%80%8c%e9%97%9c%e4%bf%82%e6%99%82%e6%85%8b%e3%80%8d%ef%bc%8d-%e8%b6%85%e8%b6%8a%e6%a8%a1%e6%93%ac%e7%9a%84%e7%94%9f%e5%91%bd%e5%bd%a2%e5%bc%8f",
  ]) {
    const r = await get(url);
    say(`  ${decodeURIComponent(url)}：${fmt(r)}`);
    if (!r.ok) continue;
    const nuxt3 = r.text.match(/<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    const nuxt2 = r.text.match(/window\.__NUXT__\s*=\s*([\s\S]*?)<\/script>/i);
    const payload = nuxt3?.[1] ?? nuxt2?.[1] ?? "";
    say(`    Nuxt payload：${nuxt3 ? "Nuxt 3（__NUXT_DATA__）" : nuxt2 ? "Nuxt 2（window.__NUXT__）" : "找不到"}，${payload.length} 字`);
    if (payload) {
      const imgs = [...new Set(payload.match(/https?:\\?\/\\?\/[^"'\s]*wp-content\\?\/uploads[^"'\s]*\.(?:jpe?g|png|webp)/gi) ?? [])];
      say(`    payload 裡的 wp-content 圖片：${imgs.length} 個；例：${imgs.slice(0, 3).join("、")}`);
      const dates = payload.match(/20\d{2}[-/.]\d{2}[-/.]\d{2}/g) ?? [];
      say(`    payload 裡的日期字串：${dates.length} 個；例：${[...new Set(dates)].slice(0, 10).join("、")}`);
      const keys = [...new Set(payload.match(/"(?:title|start_?date|end_?date|exhibition_?\w*|date\w*|period\w*|thumbnail\w*|cover\w*|slug|acf)"/gi) ?? [])];
      say(`    payload 裡疑似欄位名稱：${keys.slice(0, 30).join("、") || "（沒有，可能是 Nuxt 3 的扁平陣列格式）"}`);
      for (const needle of ["關係時態", "搖擺阿哥哥", "蠍子與青蛙"]) {
        const s = around(payload, needle, 400);
        if (s) { say(`    「${needle}」附近：${JSON.stringify(s)}`); break; }
      }
    }
    const text = strip(r.text);
    say(`    頁面文字裡的日期區間：${datesWithContext(text).join("｜") || "0 個"}`);
  }

  // 3. JS bundle 裡的 API 路徑（robots.txt 禁止 /wp-json/api，但沒禁止 /nuxt/api、/api）
  const home = await get("https://www.tcam.museum/zh");
  const bundles = [...new Set([...home.text.matchAll(/["'](\/_nuxt\/[^"']+\.js)["']/g)].map((m) => m[1]))];
  say(`  首頁引用的 /_nuxt/*.js：${bundles.length} 個`);
  const apiPaths = new Set();
  for (const b of bundles.slice(0, 6)) {
    const r = await get("https://www.tcam.museum" + b);
    for (const m of r.text.matchAll(/["'`]((?:\/nuxt)?\/api\/[A-Za-z0-9_\-/{}$.:?=&]+)["'`]/g)) apiPaths.add(m[1]);
  }
  say(`  bundle 裡的 API 路徑（${apiPaths.size}）：${[...apiPaths].slice(0, 25).join("、")}`);
}

// ---------------- 國美館 ----------------
async function ntmofa() {
  say(`\n## 國美館 https://www.ntmofa.gov.tw`);
  const home = await get("https://www.ntmofa.gov.tw/");
  const feedLinks = anchors(home.text, "https://www.ntmofa.gov.tw/").filter((a) => /rss|opendata|open_data|開放資料|資料開放|xml/i.test(a.href + a.text));
  say(`  首頁跟 RSS／開放資料有關的連結：${feedLinks.length} 個`);
  for (const a of feedLinks.slice(0, 10)) say(`    · ${a.text} → ${a.href}`);
  const sm = await get("https://www.ntmofa.gov.tw/sitemap.xml");
  say(`  sitemap.xml 前 400 字：${JSON.stringify(sm.text.slice(0, 400))}`);

  let detailDone = false;
  for (const [label, url] of [
    ["當期展覽", "https://www.ntmofa.gov.tw/News_Actives_photo.aspx?n=1462&sms=11893"],
    ["展覽預告", "https://www.ntmofa.gov.tw/News_Actives_photo.aspx?n=1464&sms=11893"],
    ["典藏策劃展", "https://www.ntmofa.gov.tw/News_Actives_photo.aspx?n=1463&sms=11893"],
  ]) {
    const r = await get(url);
    say(`  ${label} ${url}：${fmt(r)}`);
    if (!r.ok) continue;
    const text = strip(r.text);
    const ds = datesWithContext(text, 30);
    say(`    頁面文字裡的日期區間：${ds.length} 個`);
    for (const d of ds.slice(0, 10)) say(`      · ${d}`);
    const details = [...new Map(anchors(r.text, url).filter((a) => /Content\.aspx|_Content|s=\d+/i.test(a.href) && a.text).map((a) => [a.href, a])).values()];
    say(`    詳細頁連結：${details.length} 個；例：${details.slice(0, 4).map((a) => `${a.text} → ${a.href}`).join("｜")}`);
    say(`    <img>：${(r.text.match(/<img\b/gi) ?? []).length} 個；例：${[...r.text.matchAll(/<img[^>]+src=["']([^"']+)/gi)].map((m) => m[1]).filter((s) => !/icon|logo|\.svg/i.test(s)).slice(0, 3).join("、")}`);
    const pager = text.match(/共\s*\d+\s*筆|第\s*\d+\s*\/\s*\d+\s*頁|\d+\s*筆資料/g);
    if (pager) say(`    分頁資訊：${[...new Set(pager)].join("、")}`);
    const rss = [...r.text.matchAll(/href=["']([^"']*(?:rss|RSS)[^"']*)["']/g)].map((m) => m[1]);
    if (rss.length) say(`    頁面裡的 RSS 連結：${[...new Set(rss)].slice(0, 5).join("、")}`);
    if (!detailDone && details.length) {
      detailDone = true;
      const d = await get(details[0].href);
      say(`  詳細頁範例 ${details[0].href}：${fmt(d)}`);
      if (d.ok) {
        say(`    og:title=${og(d.text, "title")}｜og:image=${og(d.text, "image")}`);
        say(`    日期區間：${datesWithContext(strip(d.text), 3).join("｜") || "0 個"}`);
      }
    }
  }
}

// ---------------- 桃美館 ----------------
async function tmofa() {
  say(`\n## 桃美館 https://tmofa.tycg.gov.tw`);
  for (const url of ["https://tmofa.tycg.gov.tw/robots.txt", "https://tmofa.tycg.gov.tw/ch/exhibitions/current-exhibitions"]) {
    const r = await get(url, "text/html,application/xhtml+xml");
    say(`  ${url}：${fmt(r)}`);
    if (r.headers) {
      const h = ["server", "x-powered-by", "cf-ray", "x-cdn", "via", "x-iinfo", "x-sucuri-id"].map((k) => [k, r.headers.get(k)]).filter(([, v]) => v);
      const cookies = (r.headers.getSetCookie?.() ?? []).map((c) => c.split("=")[0]);
      say(`    回應標頭：${h.map(([k, v]) => `${k}=${v}`).join("、") || "（無特別標頭）"}；set-cookie 名稱：${cookies.join("、") || "無"}`);
    }
    say(`    內容（去標籤）前 300 字：${JSON.stringify(strip(r.text).slice(0, 300))}`);
    const scriptHints = [...r.text.matchAll(/<script[^>]*src=["']([^"']+)/gi)].map((m) => m[1]);
    if (scriptHints.length) say(`    引用的 script：${scriptHints.slice(0, 5).join("、")}`);
  }
}

// ---------------- 新北美術館 ----------------
async function ntcart() {
  say(`\n## 新北美術館 https://ntcart.museum`);
  const home = await get("https://ntcart.museum/");
  const links = [...new Map(anchors(home.text, "https://ntcart.museum/").filter((a) => /exhibit|展/i.test(a.href + a.text) && !/\{\{/.test(a.href)).map((a) => [a.href, a])).values()];
  say(`  首頁跟展覽有關的實際連結：${links.length} 個`);
  for (const a of links.slice(0, 10)) say(`    · ${a.text} → ${a.href}`);

  const pages = [...new Set(["https://ntcart.museum/", ...links.map((a) => a.href).filter((u) => !/content/i.test(u))])].slice(0, 3);
  const endpoints = new Set();
  for (const p of pages) {
    const r = p === "https://ntcart.museum/" ? home : await get(p);
    say(`  ${p}：${fmt(r)}`);
    const inline = [...r.text.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
    const relevant = inline.filter((s) => /ajax|\.ashx|WebMethod|\.aspx\/|fetch\(|ExName|ExDateSt|getJSON|\$\.post|url\s*:/i.test(s));
    say(`    inline script ${inline.length} 個，跟資料載入有關 ${relevant.length} 個`);
    for (const s of relevant.slice(0, 4)) {
      for (const m of s.matchAll(/(?:url\s*:\s*|\$\.(?:get|post|getJSON)\(\s*|fetch\(\s*)["'`]([^"'`]+)["'`]/gi)) endpoints.add(new URL(m[1], p).href);
      const i = s.search(/ajax|\.ashx|ExName|url\s*:/i);
      say(`      · …${JSON.stringify(s.slice(Math.max(0, i - 200), i + 500))}`);
    }
    const srcs = [...r.text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => new URL(m[1], p).href).filter((u) => u.includes("ntcart.museum"));
    for (const s of srcs.slice(0, 8)) {
      const js = await get(s);
      for (const m of js.text.matchAll(/(?:url\s*:\s*|\$\.(?:get|post|getJSON)\(\s*|fetch\(\s*)["'`]([^"'`]+\.(?:ashx|aspx\/\w+|json)[^"'`]*)["'`]/gi)) endpoints.add(new URL(m[1], p).href);
    }
  }
  say(`  找到的資料端點（${endpoints.size}）：${[...endpoints].join("、")}`);
  for (const e of [...endpoints].filter((u) => !/\{\{|\$\{/.test(u)).slice(0, 4)) {
    const r = await get(e, "application/json, text/javascript, */*");
    say(`  GET ${e}：${fmt(r)}`);
    say(`    前 600 字：${JSON.stringify(r.text.slice(0, 600))}`);
  }
}

for (const fn of [tcam, ntmofa, tmofa, ntcart]) {
  try { await fn(); } catch (err) { say(`  ❌ 探測程式錯誤：${err.stack?.split("\n").slice(0, 3).join(" ")}`); }
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, "```\n" + summary.join("\n") + "\n```\n");
}
