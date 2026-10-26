// 新北市美術館（NTCAM）官網：https://ntcart.museum/exhibition.aspx
//
// 網站沒有 RSS 或公開 API。展覽列表頁本身是空的 JsRender 模板，資料是頁面自己用
// $.ajax POST 回同一頁（q=get、data={"p":頁碼,"ps":每頁筆數,"Kind":""}）取回的 JSON：
//   { list: { items: [...], total: 總頁數, totalCnt: 總筆數 }, future_list: {...}, kinds: [...] }
// 這裡照前端同樣的方式 POST，不執行任何網站的 JS。robots.txt 不存在（404，沒有限制）。
// 見 schema.md 11.2。

import { aspNetDateToSlash, htmlToText, assertValidMuseumRecords } from "./common.mjs";

const SITE = "https://ntcart.museum";
const PAGE_SIZE = 12;
const MAX_PAGES = 10;

// 前端模板的寫法：檔名含路徑分隔符號時放在後台的 Upload 目錄，否則在 /retrieve/exhibition/。
// （/retrieve/exhibition/<檔名> 已實測回 200 image/jpeg。）
function imageUrl(file) {
  if (!file) return "";
  if (/[\\/]/.test(file)) return `https://admin.ntcart.museum/Upload/${file.replace(/\\/g, "/").replace(/^\/+/, "")}`;
  return `${SITE}/retrieve/exhibition/${encodeURIComponent(file)}`;
}

export function parseNtcamItems(items) {
  return items
    .filter((it) => it && it.Enable !== "N" && it.ExVerifyYn !== "N")
    .map((it) => ({
      id: String(it.ExNo ?? ""),
      title: (it.ExName ?? "").trim(),
      startDate: aspNetDateToSlash(it.ExDateSt),
      endDate: aspNetDateToSlash(it.ExDateEn),
      imageUrl: imageUrl(it.ExListImg || it.ExMainImg),
      url: it.ExNo ? `${SITE}/exhibition_content.aspx?id=${encodeURIComponent(it.ExNo)}` : "",
      venueText: (it.ExLocationTextTW ?? "").trim(),
      description: htmlToText(it.ContentDesc ?? "").replace(/\n/g, " "),
    }));
}

// http.postForm(url, params) → 回應文字；http 由 fetch-sources.mjs 提供（逾時、UA、請求間隔）。
export async function fetchNtcam(source, http) {
  const byId = new Map();
  let totalPages = 1;
  for (let p = 1; p <= Math.min(totalPages, MAX_PAGES); p++) {
    const text = await http.postForm(source.url, {
      q: "get",
      r: String(Math.random()),
      data: JSON.stringify({ p, ps: PAGE_SIZE, Kind: "" }),
    });
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`q=get 回應不是 JSON（開頭：${JSON.stringify(text.slice(0, 60))}）`);
    }
    if (!Array.isArray(json?.list?.items)) throw new Error("回應裡找不到 list.items");
    totalPages = Number(json.list.total) || 1;
    for (const r of parseNtcamItems([...json.list.items, ...(json.future_list?.items ?? [])])) byId.set(r.id, r);
  }
  return assertValidMuseumRecords([...byId.values()], "新北市美術館");
}
