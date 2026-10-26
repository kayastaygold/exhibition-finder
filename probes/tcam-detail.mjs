// PR 2（中美館）實作前的結構確認：詳細頁的標題／時間／主圖／地點在 HTML 哪裡、
// Nuxt payload 裡有沒有這檔展覽本身的結構化資料。只讀、間隔 1 秒、不執行網站的 JS。
const UA = "Mozilla/5.0 (compatible; exhibition-finder-probe/1.0; +https://github.com/kayastaygold/exhibition-finder)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) { await sleep(1000); const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "zh-TW" }, signal: AbortSignal.timeout(40000) }); return { status: r.status, text: await r.text() }; }
const squash = (h) => h.replace(/data:[^"')\s]{40,}/g, "data:…").replace(/\s+/g, " ");
function revive(arr) {
  const memo = new Map(), WRAP = new Set(["Reactive", "ShallowReactive", "Ref", "ShallowRef", "EmptyRef", "EmptyShallowRef", "NuxtError", "Island"]);
  const at = (i) => {
    if (typeof i !== "number") return i; if (i < 0) return undefined; if (memo.has(i)) return memo.get(i);
    const v = arr[i]; let o;
    if (Array.isArray(v)) {
      if (typeof v[0] === "string" && WRAP.has(v[0])) { memo.set(i, null); o = at(v[1]); }
      else if (v[0] === "Date") o = v[1];
      else if (v[0] === "Set") { o = []; memo.set(i, o); for (const x of v.slice(1)) o.push(at(x)); }
      else if (v[0] === "Map") { o = {}; memo.set(i, o); for (let k = 1; k < v.length; k += 2) o[String(at(v[k]))] = at(v[k + 1]); }
      else { o = []; memo.set(i, o); for (const x of v) o.push(at(x)); }
    } else if (v && typeof v === "object") { o = {}; memo.set(i, o); for (const [k, x] of Object.entries(v)) o[k] = at(x); }
    else o = v;
    memo.set(i, o); return o;
  };
  return at(0);
}
const home = await get("https://www.tcam.museum/zh");
const links = [...new Set([...home.text.matchAll(/href=["'](\/zh\/exhibition\/[^"'#?]+)["']/g)].map((m) => m[1]))];
console.log(`首頁展覽連結 ${links.length} 個`);
for (const [n, path] of links.entries()) {
  const r = await get("https://www.tcam.museum" + path);
  const h = r.text;
  console.log(`\n## ${decodeURIComponent(path)}（HTTP ${r.status}）`);
  if (n < 2) {
    const i = h.search(/<h1\b/i);
    console.log(`  <h1> 附近原始 HTML：${squash(h.slice(Math.max(0, i - 600), i + 1800))}`);
    const t = h.indexOf("時間");
    console.log(`  「時間」附近原始 HTML：${squash(h.slice(Math.max(0, t - 300), t + 600))}`);
  }
  const imgs = [...h.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]).filter((t) => /wp-content\/uploads/.test(t));
  console.log(`  wp-content <img>（依出現順序）：`);
  for (const t of imgs.slice(0, 6)) console.log(`    ${squash(t).slice(0, 260)}`);
  const bg = [...h.matchAll(/background-image:\s*url\(([^)]*wp-content[^)]*)\)/gi)].map((m) => m[1]);
  if (bg.length) console.log(`  background-image：${bg.slice(0, 3).join("、")}`);
  const nd = h.match(/<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!nd) { console.log("  沒有 __NUXT_DATA__"); continue; }
  const root = revive(JSON.parse(nd[1]));
  const h1 = (h.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "").replace(/<[^>]+>/g, "").trim();
  const found = [], seen = new Set();
  (function walk(o, path) {
    if (!o || typeof o !== "object" || seen.has(o)) return; seen.add(o);
    if (!Array.isArray(o) && typeof o.title === "string" && h1 && (o.title.includes(h1.slice(0, 8)) || h1.includes(o.title.slice(0, 8)))) found.push({ path, o });
    for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
  })(root, "$");
  console.log(`  payload 裡 title 符合 <h1>「${h1.slice(0, 20)}」的物件：${found.length} 個`);
  for (const { path, o } of found.slice(0, 3)) {
    const flat = Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 90) : Array.isArray(v) ? `[陣列 ${v.length}]` : v && typeof v === "object" ? `{${Object.keys(v).slice(0, 8).join(",")}}` : v]));
    console.log(`    ${path.slice(0, 80)}：${JSON.stringify(flat).slice(0, 900)}`);
  }
}
