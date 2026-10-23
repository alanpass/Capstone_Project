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
