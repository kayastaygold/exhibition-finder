// 美術館官網探測第四輪（收尾）：
//   - 新北美術館：exhibition.aspx 的 q=get JSON 裡，展覽本身的欄位
//   - 中美館：首頁連到的每個展覽詳細頁，能不能解析出標題、展期、地點、圖片
//     （展覽列表不在內嵌 payload 裡、/wp-json/api 被 robots.txt 禁止，所以走詳細頁）
//   - event.culture.tw 的 robots.txt（國美館的展覽詳細頁在這裡，地點要從詳細頁取）
// 只讀、每次請求間隔 1 秒、不執行任何網站提供的 JS。

const UA = "Mozilla/5.0 (compatible; exhibition-finder-probe/1.0; +https://github.com/kayastaygold/exhibition-finder)";
const summary = [];
const say = (s = "") => { console.log(s); summary.push(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function req(url, { method = "GET", body, headers = {} } = {}) {
  await sleep(1000);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method, body, headers: { "User-Agent": UA, "Accept-Language": "zh-TW,zh;q=0.9", ...headers }, signal: AbortSignal.timeout(40000) });
    return { ok: res.ok, status: res.status, type: res.headers.get("content-type") ?? "", text: await res.text(), ms: Date.now() - t0 };
  } catch (err) {
    return { ok: false, status: 0, type: "", text: "", error: `${err.name}: ${err.cause?.code ?? err.message}`, ms: Date.now() - t0 };
  }
}
const fmt = (r) => (r.status ? `HTTP ${r.status}, ${r.type.split(";")[0] || "?"}, ${r.text.length} bytes, ${r.ms}ms` : `連線失敗（${r.error}）`);
const decode = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const strip = (h) => decode(h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const short = (s, n = 60) => (s ?? "").toString().replace(/\s+/g, " ").slice(0, n);

async function ntcart() {
  say(`\n## 新北美術館：exhibition.aspx 的 JSON`);
  const body = new URLSearchParams({ q: "get", r: String(Math.random()), data: JSON.stringify({ p: 1, ps: 12, Kind: "" }) });
  const r = await req("https://ntcart.museum/exhibition.aspx", { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest", Accept: "application/json, text/javascript, */*; q=0.01" } });
  say(`  ${fmt(r)}`);
  let j;
  try { j = JSON.parse(r.text); } catch { say(`  不是 JSON：${JSON.stringify(r.text.slice(0, 200))}`); return; }
  for (const key of ["list", "future_list"]) {
    const block = j[key] ?? {};
    const meta = Object.fromEntries(Object.entries(block).filter(([, v]) => !Array.isArray(v)));
    say(`  ${key}：items ${block.items?.length ?? 0} 筆；其他欄位 ${JSON.stringify(meta).slice(0, 200)}`);
    const items = block.items ?? [];
    if (items[0]) {
      const scalar = Object.entries(items[0]).filter(([, v]) => v === null || typeof v !== "object");
      say(`    單筆欄位（純值）：${scalar.map(([k, v]) => `${k}=${short(JSON.stringify(v), 40)}`).join("、")}`);
      say(`    單筆欄位（陣列/物件）：${Object.entries(items[0]).filter(([, v]) => v && typeof v === "object").map(([k, v]) => `${k}[${Array.isArray(v) ? v.length : "obj"}]`).join("、")}`);
    }
    const pick = (o, rx) => Object.entries(o).find(([k, v]) => rx.test(k) && (typeof v === "string" || typeof v === "number"))?.[1];
    for (const it of items.slice(0, 15)) {
      say(`      · ${short(pick(it, /name/i), 40)} | ${pick(it, /date.*st|start|DateSt/i) ?? "?"} ~ ${pick(it, /date.*en|end|DateEn/i) ?? "?"} | 地點=${short(pick(it, /place|location|venue|地點|Loc/i), 30)} | img=${short(pick(it, /img|image|pic/i), 70)} | id=${pick(it, /^(Ex)?No$|id$/i) ?? "?"}`);
    }
  }
}

async function tcam() {
  say(`\n## 中美館：首頁連到的展覽詳細頁`);
  const home = await req("https://www.tcam.museum/zh");
  say(`  首頁：${fmt(home)}`);
  const links = [...new Map([...home.text.matchAll(/<a\b[^>]*href=["'](\/zh\/exhibition\/[^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => [m[1], short(strip(m[2]), 50)])).entries()];
  say(`  首頁上的展覽詳細頁連結：${links.length} 個`);
  for (const [path, text] of links.slice(0, 10)) {
    const url = "https://www.tcam.museum" + path;
    const r = await req(url);
    const t = strip(r.text);
    const h1 = short(strip((r.text.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) ?? [, ""])[1]), 50);
    const date = (t.match(/時間\s*(20\d{2}\/\d{1,2}\/\d{1,2}[^0-9]{0,6}[–—~～-]\s*(?:20\d{2}\/)?\d{1,2}\/\d{1,2})/) ?? t.match(/(20\d{2}[./]\d{1,2}[./]\d{1,2})(?:\s*[–—~～-]\s*(20\d{2}[./]\d{1,2}[./]\d{1,2}))?/) ?? [, ""])[1];
    const place = short((t.match(/地點\s*([^\s].{0,40}?)(?:\s{1,}(?:票價|費用|時間|主辦|策展|藝術家)|$)/) ?? [, ""])[1], 40);
    const imgs = [...r.text.matchAll(/(?:src|srcset)=["']([^"' ]*wp-content\/uploads[^"' ]+\.(?:jpe?g|png|webp))/gi)].map((m) => m[1]);
    say(`    · ${decodeURIComponent(path).slice(15, 45)}：${fmt(r)}`);
    say(`        首頁文字=${text}｜<h1>=${h1 || "（沒有 h1）"}｜時間=${date || "（找不到）"}｜地點=${place || "（找不到）"}｜wp-content 圖片 ${imgs.length} 張，例：${short(imgs[0], 90)}`);
  }
}

async function eventCulture() {
  say(`\n## event.culture.tw（國美館展覽詳細頁所在）`);
  const r = await req("https://event.culture.tw/robots.txt");
  say(`  robots.txt：${fmt(r)}`);
  if (r.ok && !/<html/i.test(r.text.slice(0, 200))) for (const l of r.text.trim().split(/\r?\n/).slice(0, 30)) say(`    ${l}`);
}

for (const fn of [ntcart, tcam, eventCulture]) {
  try { await fn(); } catch (err) { say(`  ❌ 探測程式錯誤：${err.stack?.split("\n").slice(0, 3).join(" ")}`); }
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, "```\n" + summary.join("\n") + "\n```\n");
}
