// 純邏輯單元測試：deno test tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { durationToDays, progressFor, stageFor, withProgress } from "../frontend/assets/js/growth.js";
import { normalize, soilPercent, summarize } from "../frontend/assets/js/sensors.js";
import { cityFromAddress } from "../frontend/assets/js/weather.js";

test("生長階段邊界", () => {
  assert.equal(stageFor(0, 90), "尚未開始");
  assert.equal(stageFor(7, 90), "種植期");
  assert.equal(stageFor(20, 90), "成長期");
  assert.equal(stageFor(50, 90), "開花期");
  assert.equal(stageFor(90, 90), "結果期");
  assert.equal(stageFor(91, 90), "收成期");
});

test("進度計算：當天為第 1 天，超過週期時夾在 100%", () => {
  assert.equal(progressFor("2026-10-01", 60, undefined, "2026-10-01").day, 1);
  assert.equal(progressFor("2026-10-01", 60, undefined, "2026-10-10").day, 10);
  const late = progressFor("2026-01-01", 30, undefined, "2026-03-01");
  assert.equal(late.percent, 100);
  assert.equal(late.stage, "收成期");
  assert.equal(progressFor("2026-10-01", 60, 45).stage, "結果期");
});

test("withProgress 補上畫面需要的欄位", () => {
  const p = withProgress({ id: "a", plant_name: "羅勒", start_date: "2026-10-01", total_days: 60 }, "2026-10-10");
  assert.deepEqual([p.current_day, p.progress, p.current_stage], [10, 16.7, "成長期"]);
});

test("AI 週期換算並限制在 30~365 天", () => {
  assert.equal(durationToDays(3, "months"), 90);
  assert.equal(durationToDays(2, "weeks"), 30);
  assert.equal(durationToDays(5, "years"), 365);
  assert.equal(durationToDays("abc", "days"), 90);
});

test("地址解析縣市，台/臺 皆可", () => {
  assert.equal(cityFromAddress("台中市西屯區"), "臺中市");
  assert.equal(cityFromAddress("新北市板橋區"), "新北市");
  assert.equal(cityFromAddress(""), "高雄市");
});

test("感測資料正規化：ADC 原始值換算、超出範圍視為無效", () => {
  assert.equal(soilPercent(35), 35);
  assert.equal(soilPercent(1993), 100);
  assert.equal(soilPercent(996.5), 50);
  // 頻道 3018608：field2 是馬達狀態，不應被當成溫度
  const row = normalize({ created_at: "2026-10-22T02:00:00Z", field1: "", field2: "1", field3: "150", field4: "26.44" });
  assert.equal(row.soil, null);
  assert.equal(row.temperature, 26.4);
  assert.equal(row.humidity, null);
  const custom = normalize({ field2: "25" }, { soil: "field1", temperature: "field2", humidity: "field3" });
  assert.equal(custom.temperature, 25);
});

test("summarize 合併最近幾筆中各欄位的最新值", () => {
  const latest = summarize([
    { at: "t3", soil: 40, temperature: null, humidity: null },
    { at: "t2", soil: null, temperature: 25, humidity: 70 },
    { at: "t1", soil: 38, temperature: 24, humidity: 65 },
  ]);
  assert.deepEqual(latest, { at: "t3", soil: 40, temperature: 25, humidity: 70 });
  assert.equal(summarize([]), null);
});

test("階段範圍、調整進度與門檻整理", async () => {
  const g = await import("../frontend/assets/js/growth.js");
  assert.deepEqual(["planting", "growing", "flowering", "fruiting", "harvest"].map((k) => g.stageRange(k, 90)),
    [[1, 7], [8, 29], [30, 59], [60, 90], [91, null]]);
  // 每個範圍的第一天，stageKeyFor 都要算回同一個階段
  for (const s of g.STAGES) assert.equal(g.stageKeyFor(g.stageRange(s.key, 90)[0], 90), s.key);
  assert.equal(g.stageKeyFor(0, 90), "planting");
  assert.equal(g.startDateForDay(1, "2026-10-23"), "2026-10-23");
  assert.equal(g.startDateForDay(40, "2026-10-23"), "2026-09-14");
  assert.equal(g.progressFor(g.startDateForDay(40, "2026-10-23"), 90, undefined, "2026-10-23").day, 40);
  const clean = g.sanitizeStageThresholds({ planting: { tempMin: 30, tempMax: 20, humidMin: "70", humidMax: 70, soilMin: 150 } });
  assert.deepEqual(clean.planting, { tempMin: 20, tempMax: 30, humidMin: 70, humidMax: 71, soilMin: 100 });
  assert.deepEqual(Object.keys(clean), ["planting", "growing", "flowering", "fruiting", "harvest"]);
});

test("裝置狀態：連線判斷、相對時間、運作時間與訊號", async () => {
  const { connectionOf, formatUptime, signalText, timeAgo } = await import("../frontend/assets/js/devices.js");
  const now = Date.parse("2026-10-24T12:00:00Z");
  const ago = (minutes) => new Date(now - minutes * 60000).toISOString();
  assert.deepEqual([null, ago(1), ago(3), ago(5), ago(30)].map((t) => connectionOf(t, now)),
    ["never", "online", "online", "unstable", "offline"]);
  assert.deepEqual([ago(0.2), ago(5), ago(120)].map((t) => timeAgo(t, now)), ["剛剛", "5 分鐘前", "2 小時前"]);
  assert.deepEqual([90, 4000, 200000].map(formatUptime), ["1 分鐘", "1 小時 6 分", "2 天 7 小時"]);
  assert.equal(formatUptime(undefined), "—");
  assert.deepEqual([-55, -65, -75, -90].map(signalText), ["強（-55 dBm）", "良好（-65 dBm）", "弱（-75 dBm）", "很弱（-90 dBm）"]);
});

test("植物百科：1000 種、id 不重複、分類與篩選欄位齊全", async () => {
  const { CATEGORIES, QUICK_FILTERS } = await import("../frontend/assets/js/catalog.js");
  const catalog = JSON.parse(await Deno.readTextFile(new URL("../frontend/data/plants-index.json", import.meta.url)));
  assert.equal(catalog.length, 1000);
  assert.equal(new Set(catalog.map((p) => p.id)).size, 1000, "id 不重複");
  assert.equal(new Set(catalog.map((p) => p.name)).size, 1000, "名稱不重複");
  const cats = new Set(CATEGORIES.map((c) => c.key));
  assert.deepEqual(catalog.filter((p) => !cats.has(p.cat)).map((p) => p.name), [], "分類都有定義");
  assert.ok(catalog.every((p) => p.name && p.desc), "名稱與簡介必填");
  const newOnes = catalog.filter((p) => !p.detail);
  assert.equal(newOnes.length, 900);
  assert.ok(newOnes.every((p) => p.care && p.sun && p.water && p.temp?.[0] < p.temp?.[1]), "新增植物的照護欄位齊全");
  for (const f of QUICK_FILTERS) assert.ok(catalog.some(f.test), `「${f.name}」至少有一種植物`);
});
