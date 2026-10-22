// ThingSpeak 感測資料（公開頻道，瀏覽器可直接讀取）
// 欄位：field1 = 土壤濕度、field2 = 空氣溫度、field3 = 空氣濕度。兩塊 ESP32 分別上傳不同欄位。
import { SOIL_ADC_DRY, SOIL_ADC_WET, THINGSPEAK_CHANNEL_ID } from "./config.js";

const KEYS = ["soil", "temperature", "humidity"];

const num = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const ranged = (v, lo, hi) => (v !== null && v >= lo && v <= hi ? Math.round(v * 10) / 10 : null);

export function soilPercent(value) {
  if (value === null) return null;
  let v = value;
  if (v > 100) v = ((v - SOIL_ADC_DRY) / (SOIL_ADC_WET - SOIL_ADC_DRY || 1)) * 100; // 舊韌體的 ADC 原始值
  return Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;
}

export function normalize(feed) {
  return {
    time: feed.created_at ? new Date(feed.created_at).toLocaleString("zh-TW", { hour12: false }) : null,
    soil: soilPercent(num(feed.field1)),
    temperature: ranged(num(feed.field2), -40, 80),
    humidity: ranged(num(feed.field3), 0, 100),
  };
}

/** 回傳 { latest, readings }，readings 由新到舊。latest 合併最近幾筆，避免單筆缺欄位。 */
export async function loadSensors(results = 20) {
  const res = await fetch(`https://api.thingspeak.com/channels/${THINGSPEAK_CHANNEL_ID}/feeds.json?results=${results}`);
  if (!res.ok) throw new Error("無法讀取 ThingSpeak 感測資料");
  const readings = ((await res.json()).feeds || [])
    .map(normalize)
    .filter((r) => KEYS.some((k) => r[k] !== null))
    .reverse();
  if (!readings.length) return { latest: null, readings };
  const latest = { time: readings[0].time };
  for (const k of KEYS) latest[k] = readings.find((r) => r[k] !== null)?.[k] ?? null;
  return { latest, readings };
}
