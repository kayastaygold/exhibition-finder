// 臺中市立美術館（TcAM，中美館）官網：https://www.tcam.museum/zh
//
// 展覽列表頁（/zh/exhibition）的展覽是瀏覽器端再向 WordPress API（/wp-json/api）取的，
// 而 robots.txt 明確禁止 /wp-json/api，所以不用列表頁、也不碰那個 API，改成：
//   1. 從首頁找出展覽詳細頁網址：首頁 <a href="/zh/exhibition/<slug>"> 的連結，加上首頁
//      內嵌 Nuxt 資料（__NUXT_DATA__）裡 post_type 是 "exhibition" 的物件的 url
//   2. 逐一抓詳細頁（伺服器端產生），取 <h1> 標題、「時間」「地點」兩欄、主圖（hero-clip）
// robots.txt 允許首頁跟 /zh/exhibition/*。見 schema.md 11.7。
//
// 限制：只抓得到首頁（含內嵌資料）有提到的展覽；每月查證時會核對官網是否有漏（schema.md 11.8）。
//
// 詳細頁結構（2026/10 實測）：
//   <h1 class="text-head-2 text-black">搖擺阿哥哥—時代跨域者王水河</h1>
//   <img class="hero-clip …" src="https://www.tcam.museum/wp-content/uploads/…jpg">
//   <span class="text-body-1-r text-nowrap">時間</span> … <p class="text-body-1-l text-txt">2026/08/29 (六) – 2026/10/25(日)</p>
//   <span class="text-body-1-r text-nowrap">地點</span> … <p class="text-body-1-l text-txt">臺中市立美術館 展覽室D、E</p>

import { decodeEntities, htmlToText, parseDateRange, parseSingleDate, reviveNuxtData, assertValidMuseumRecords } from "./common.mjs";

const SITE = "https://www.tcam.museum";
const MAX_DETAIL_PAGES = 40;

const text = (html) => htmlToText(html).replace(/\n/g, " ").trim();

// 首頁 → 展覽詳細頁的 slug（已 decode），依出現順序、去重。
export function parseTcamHome(html) {
  const slugs = [];
  const add = (raw) => {
    if (!raw) return;
    let slug = raw;
    try { slug = decodeURIComponent(raw); } catch {}
    slug = slug.replace(/^\/?zh\/exhibition\//, "").replace(/[/?#].*$/, "").trim();
    if (slug && !slugs.includes(slug)) slugs.push(slug);
  };
  for (const m of (html ?? "").matchAll(/href=["']\/zh\/exhibition\/([^"'#?]+)["']/g)) add(m[1]);

  const nd = /<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html ?? "");
  if (nd) {
    let root;
    try { root = reviveNuxtData(JSON.parse(nd[1])); } catch { root = null; }
    const seen = new Set();
    (function walk(o) {
      if (!o || typeof o !== "object" || seen.has(o)) return;
      seen.add(o);
      if (!Array.isArray(o) && o.post_type === "exhibition" && typeof o.url === "string") add(o.url);
      for (const v of Object.values(o)) walk(v);
    })(root);
  }
  return slugs;
}

// 「時間」「地點」這種標籤欄位：<span>標籤</span> 之後第一個 <p> 的內容
function labeledValue(html, label) {
  const i = html.search(new RegExp(`<span[^>]*>\\s*${label}\\s*</span>`));
  if (i < 0) return "";
  const m = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(html.slice(i, i + 1500));
  return m ? text(m[1]) : "";
}

export function parseTcamDetail(html) {
  const h = html ?? "";
  const heroImg = /<img\b[^>]*class=["'][^"']*\bhero-clip\b[^"']*["'][^>]*>/i.exec(h)?.[0] ?? "";
  const metaDesc = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(h)?.[1] ?? "";
  return {
    title: text(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(h)?.[1] ?? ""),
    timeText: labeledValue(h, "時間"),
    venueText: labeledValue(h, "地點"),
    imageUrl: decodeEntities(/\bsrc=["']([^"']+)["']/i.exec(heroImg)?.[1] ?? ""),
    description: decodeEntities(metaDesc).trim(),
  };
}

// http.getText(url) → 回應文字；http 由 fetch-sources.mjs 提供（逾時、UA、請求間隔）。
export async function fetchTcam(source, http) {
  const slugs = parseTcamHome(await http.getText(source.url));
  if (slugs.length === 0) throw new Error("首頁沒有找到任何展覽詳細頁連結");

  const records = [];
  const startOnly = [];
  for (const slug of slugs.slice(0, MAX_DETAIL_PAGES)) {
    const url = `${SITE}/zh/exhibition/${encodeURIComponent(slug)}`;
    // 單一詳細頁失效（404 等）只略過那一檔；全部失敗的話會是 0 筆，由 fetch-sources.mjs 判定失敗
    let d;
    try {
      d = parseTcamDetail(await http.getText(url));
    } catch (err) {
      console.warn(`  中美館詳細頁 ${slug} 抓取失敗（${err.message}），這次略過`);
      continue;
    }
    const range = parseDateRange(d.timeText);
    if (!range) {
      // 只寫開始日（長期展示）或寫不出日期的，先不收、記下來，見 schema.md 11.7
      const kind = parseSingleDate(d.timeText) ? "只有開始日" : "沒有日期";
      startOnly.push(`${d.title || slug}（${kind}，時間欄：${d.timeText || "空白"}）`);
      continue;
    }
    records.push({
      id: slug,
      title: d.title,
      startDate: range.startDate,
      endDate: range.endDate,
      imageUrl: d.imageUrl,
      url,
      venueText: d.venueText,
      description: d.description,
    });
  }
  // 詳細頁的 meta description 目前是全站共用的一句話（2026/10 實測每檔都一樣、只有 7 個字），
  // 不是展覽自己的介紹；所有展覽的簡介都相同時就清空，不要每張卡片都顯示同一句話。
  if (records.length > 1 && records.every((r) => r.description === records[0].description)) {
    for (const r of records) r.description = "";
  }
  if (startOnly.length) {
    console.log(`  中美館：${startOnly.length} 檔沒有完整展期，這次不收：${startOnly.join("；")}`);
  }
  return assertValidMuseumRecords(records, "臺中市立美術館");
}
