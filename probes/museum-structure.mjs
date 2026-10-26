// 實作 PR 1（新北美術館＋國美館）前的結構確認：只讀、每次請求間隔 1 秒、不執行網站的 JS。
const UA = "Mozilla/5.0 (compatible; exhibition-finder-probe/1.0; +https://github.com/kayastaygold/exhibition-finder)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function req(url, opt = {}) {
  await sleep(1000);
  try {
    const res = await fetch(url, { ...opt, headers: { "User-Agent": UA, "Accept-Language": "zh-TW,zh;q=0.9", ...(opt.headers ?? {}) }, signal: AbortSignal.timeout(40000) });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, type: res.headers.get("content-type") ?? "", text: buf.toString("utf8"), size: buf.length };
  } catch (e) { return { status: 0, type: "", text: "", size: 0, error: `${e.name}: ${e.cause?.code ?? e.message}` }; }
}
const squash = (h) => h.replace(/data:[^"')\s]{40,}/g, "data:…").replace(/\s+/g, " ");

// ---- 國美館：一張卡片的原始 HTML、詳細頁「展覽地點」附近的原始 HTML ----
const list = await req("https://www.ntmofa.gov.tw/News_Actives_photo.aspx?n=1462&sms=11893");
console.log(`## 國美館當期展覽 HTTP ${list.status} ${list.size} bytes`);
const ids = [...new Set([...list.text.matchAll(/actId=(\d+)/g)].map((m) => m[1]))];
console.log(`actId（依出現順序）：${ids.join("、")}`);
const first = list.text.indexOf(`actId=${ids[0]}`), second = list.text.indexOf(`actId=${ids[1]}`);
const a = list.text.lastIndexOf("<li", first);
console.log(`第一張卡片前後的原始 HTML（從 actId=${ids[0]} 前最近的 <li 到 actId=${ids[1]} 後 200 字）：`);
console.log(squash(list.text.slice(a > 0 && first - a < 3000 ? a : first - 1500, second + 200)));
const detail = await req(`https://event.culture.tw/mocweb/reg/NTMOFA/Detail.init.ctr?actId=${ids[0]}`);
console.log(`\n## 國美館詳細頁 actId=${ids[0]} HTTP ${detail.status} ${detail.type} ${detail.size} bytes`);
const i = detail.text.indexOf("展覽地點");
console.log(squash(detail.text.slice(Math.max(0, i - 1500), i + 600)));
const title = detail.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
console.log(`<title>：${title}`);

// ---- 新北美術館：一筆完整 JSON、圖片與詳細頁的實際網址 ----
const body = new URLSearchParams({ q: "get", r: "0.5", data: JSON.stringify({ p: 1, ps: 12, Kind: "" }) });
const j = await req("https://ntcart.museum/exhibition.aspx", { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" } });
console.log(`\n## 新北 q=get HTTP ${j.status} ${j.type}`);
const item = JSON.parse(j.text).list.items[0];
console.log(JSON.stringify(Object.fromEntries(Object.entries(item).map(([k, v]) => [k, typeof v === "string" && v.length > 150 ? v.slice(0, 150) + "…" : v]))));
const page = await req(`https://ntcart.museum/exhibition_content.aspx?id=${item.ExNo}`);
console.log(`詳細頁 exhibition_content.aspx?id=${item.ExNo} HTTP ${page.status} ${page.size} bytes`);
const imgRefs = [...new Set([...page.text.matchAll(/["'(]([^"'()]*(?:retrieve|upload)[^"'()]*)["')]/gi)].map((m) => m[1]))].slice(0, 15);
console.log(`詳細頁裡含 retrieve/upload 的路徑：${imgRefs.join("、")}`);
const listPage = await req("https://ntcart.museum/exhibition.aspx");
const tmpl = listPage.text.indexOf("ExListImg");
console.log(`列表頁模板裡 ExListImg 附近：${squash(listPage.text.slice(tmpl - 300, tmpl + 200))}`);
for (const p of [`/retrieve/exhibition/${item.ExListImg}`, `/retrieve/exhibition/list/${item.ExListImg}`, `/upload/exhibition/${item.ExListImg}`, `/retrieve/exhibition/main/${item.ExMainImg}`]) {
  const r = await req("https://ntcart.museum" + p, { method: "GET" });
  console.log(`GET ${p} → HTTP ${r.status} ${r.type} ${r.size} bytes`);
}
