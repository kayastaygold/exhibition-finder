// 美術館來源上線前的實測（PR 2：加入中美館）：在 runner 上用真的官網資料跑一次
// fetch-sources.mjs（只跑這兩個來源）＋ build-events.mjs，輸出寫到暫存位置，
// 不 commit 任何東西。
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const all = JSON.parse(readFileSync("data/sources.json", "utf-8"));
writeFileSync("/tmp/museum-sources.json", JSON.stringify(all.filter((s) => s.kind === "museum")));
const run = (cmd, args, env = {}) => execFileSync(cmd, args, { encoding: "utf-8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });

console.log("## fetch-sources.mjs（只跑美術館來源）");
console.log(run("node", ["scripts/fetch-sources.mjs"], { SOURCES_PATH: "/tmp/museum-sources.json" }));

for (const s of all.filter((s) => s.kind === "museum")) {
  let raw = [];
  try { raw = JSON.parse(readFileSync(s.rawPath, "utf-8")); } catch { console.log(`${s.rawPath} 沒有產生`); continue; }
  console.log(`\n## ${s.name}：${raw.length} 筆`);
  for (const r of raw) console.log(`  · [${r.id}] ${r.title} | ${r.startDate} ~ ${r.endDate} | 地點=${r.venueText || "（無）"} | 圖=${r.imageUrl ? "有" : "無"} | 簡介 ${r.description.length} 字`);
}

console.log("\n## build-events.mjs");
console.log(run("node", ["scripts/build-events.mjs", "data/moc-raw.json", "/tmp/events.json"]));
const ev = JSON.parse(readFileSync("/tmp/events.json", "utf-8"));
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10).replace(/-/g, "/");
for (const e of ev.filter((e) => ["ntcam", "ntmofa", "tcam"].includes(e.source))) {
  const si = e.showInfo[0];
  console.log(`  ${e.source.padEnd(6)}| ${e.title.slice(0, 28)} | ${si.county ?? "—"}${si.district ?? ""} | ${si.locationName.slice(0, 26)} | 常設=${e.isPermanent} 線上=${e.isOnline} | ${e.endDate < today ? "已結束" : "顯示中"}`);
}
