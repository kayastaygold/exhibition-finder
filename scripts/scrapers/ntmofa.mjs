// 國立臺灣美術館（NTMoFA）官網：當期展覽、展覽預告兩個列表頁（政府網站 CMS，伺服器端產生）。
//
// 網站沒有 RSS 或可用的開放資料（data.gov.tw 只有 2015 年的舊資料集）。robots.txt 不存在
// （404，沒有限制）；展覽詳細頁放在文化部活動平台 event.culture.tw，robots.txt 也不存在。
// 見 schema.md 11.3。
//
// 列表頁每張卡片的結構（2026/10 實測）：
//   <a href="https://event.culture.tw/mocweb/reg/NTMOFA/Detail.init.ctr?actId=60149"
//      class="div-activity" title="標題">
//     <div class="img">…<img src="…/NTMOFA/JpgFile/01/60149/…jpg">…</div>
//     <div class="essay"> … <div class="p"><p>摘要（截斷）</p></div>
//       … <p class="activity-time">日期：2026-09-05 ~ 2026-11-15</p> …</div>
//   </a>
//
// 卡片上的「日期」是活動平台的上架期間，有時是佔位值（例如「黯像：看見不見」卡片寫
// 2025-11-19 ~ 2030-12-31，實際展期是 2026.5.22—2026.10.26），所以展期優先用詳細頁
// （其次是摘要）裡明確標示「展期／展覽日期」的區間，找不到才用卡片日期。

import { decodeEntities, htmlToText, parseDateRange, assertValidMuseumRecords } from "./common.mjs";

const attr = (attrs, name) => decodeEntities((new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(attrs) ?? [, ""])[1]).trim();

export function parseNtmofaList(html) {
  const cards = [];
  for (const m of (html ?? "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const [, attrs, inner] = m;
    if (!/\bdiv-activity\b/.test(attr(attrs, "class"))) continue;
    const href = attr(attrs, "href");
    const actId = (/[?&]actId=(\d+)/.exec(href) ?? [])[1];
    if (!actId) continue;
    const caption = htmlToText((/<div class="caption">([\s\S]*?)<\/div>/i.exec(inner) ?? [, ""])[1]);
    const summary = htmlToText((/<div class="p">([\s\S]*?)<\/div>/i.exec(inner) ?? [, ""])[1]).replace(/\n/g, " ");
    const time = htmlToText((/<p class="activity-time">([\s\S]*?)<\/p>/i.exec(inner) ?? [, ""])[1]);
    cards.push({
      actId,
      title: attr(attrs, "title") || caption,
      url: href,
      imageUrl: attr((/<img\b([^>]*)>/i.exec(inner) ?? [, ""])[1], "src"),
      cardRange: parseDateRange(time),
      summary,
    });
  }
  return cards;
}

// 「展期│2026.5.22—2026.10.26」「展覽日期：2026/09/05-11/15」這種有標籤的區間
const LABELED_RANGE = /(?:展期|展覽日期|展覽期間)\s*[│|｜:：]?\s*([^\n]{6,60})/;
// 「展覽地點│韓國光州國立亞洲文化殿堂（ACC）」；摘要是單行截斷文字，遇到下一個欄位名稱就停
const LABELED_VENUE = /(?:展覽地點|展出地點|地點)\s*[│|｜:：]\s*([^\n]{2,80}?)(?=\s*(?:展覽簡介|展覽介紹|簡介|策展人|主辦|指導|協辦|展覽日期|展期|開放時間|\n|$))/;

// 摘要是截斷過的文字，取出來的地點可能帶著結尾的「...」「…」
const cleanVenue = (s) => (s ?? "").replace(/(?:\.{2,}|…)+$/, "").trim();

export function parseNtmofaDetail(html) {
  // 只看活動介紹的內文區塊，避開頁面其他地方（場次表、頁尾）的日期跟地點
  const body = (/<div class="html">([\s\S]*?)<\/div>\s*<\/div>/i.exec(html ?? "") ?? [, html ?? ""])[1];
  const text = htmlToText(body);
  const rangeLine = (LABELED_RANGE.exec(text) ?? [])[1];
  return {
    labeledRange: rangeLine ? parseDateRange(rangeLine) : null,
    venueText: cleanVenue((LABELED_VENUE.exec(text) ?? [])[1]),
    description: text.replace(/\n/g, " "),
  };
}

// http.getText(url) → 回應文字；http 由 fetch-sources.mjs 提供（逾時、UA、請求間隔）。
export async function fetchNtmofa(source, http) {
  const listUrls = source.urls?.length ? source.urls : [source.url];
  const cards = new Map();
  for (const url of listUrls) {
    const found = parseNtmofaList(await http.getText(url));
    if (found.length === 0) throw new Error(`列表頁沒有解析到任何展覽卡片：${url}`);
    for (const c of found) if (!cards.has(c.actId)) cards.set(c.actId, c);
  }

  const records = [];
  for (const c of cards.values()) {
    // 詳細頁抓不到不算整個來源失敗，退回卡片／摘要上的資訊
    let detail = { labeledRange: null, venueText: "", description: "" };
    try {
      detail = parseNtmofaDetail(await http.getText(c.url));
    } catch (err) {
      console.warn(`  國美館詳細頁 actId=${c.actId} 抓取失敗（${err.message}），改用列表頁資訊`);
    }
    const summaryRangeLine = (LABELED_RANGE.exec(c.summary) ?? [])[1];
    const range = detail.labeledRange ?? (summaryRangeLine ? parseDateRange(summaryRangeLine) : null) ?? c.cardRange;
    records.push({
      id: c.actId,
      title: c.title,
      startDate: range?.startDate ?? null,
      endDate: range?.endDate ?? null,
      imageUrl: c.imageUrl,
      url: c.url,
      venueText: detail.venueText || cleanVenue((LABELED_VENUE.exec(c.summary) ?? [])[1]),
      description: detail.description || c.summary,
    });
  }
  return assertValidMuseumRecords(records, "國立臺灣美術館");
}
