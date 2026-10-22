// 感測資料來源：
//   1. 已登入且 ESP32 有上傳 → 讀取自己 Supabase 裡的 sensor_readings
//   2. 否則 → 讀取 ThingSpeak 公開頻道當作示範資料（不需要帳號，頻道維持公開即可）
// ThingSpeak 欄位：field1 = 土壤濕度、field2 = 空氣溫度、field3 = 空氣濕度
import { DEMO_THINGSPEAK_CHANNEL_ID, DEMO_THINGSPEAK_READ_KEY, SOIL_ADC_DRY, SOIL_ADC_WET } from "./config.js";

const KEYS = ["soil", "temperature", "humidity"];

const num = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const ranged = (v, lo, hi) => (v !== null && v >= lo && v <= hi ? Math.round(v * 10) / 10 : null);

export function soilPercent(value) {
  if (value === null) return null;
  let v = value;
  if (v > 100) v = ((v - SOIL_ADC_DRY) / (SOIL_ADC_WET - SOIL_ADC_DRY || 1)) * 100; // 舊韌體的 ADC 原始值
  return Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;
}

/** ThingSpeak feed → 統一格式 */
export function normalize(feed) {
  return {
    at: feed.created_at ?? null,
    soil: soilPercent(num(feed.field1)),
    temperature: ranged(num(feed.field2), -40, 80),
    humidity: ranged(num(feed.field3), 0, 100),
  };
}

/** 讀數由新到舊；latest 合併最近幾筆的各欄位，避免單筆只有部分欄位（兩塊 ESP32 分開上傳）。 */
export function summarize(readings) {
  if (!readings.length) return null;
  const latest = { at: readings[0].at };
  for (const k of KEYS) latest[k] = readings.find((r) => r[k] !== null)?.[k] ?? null;
  return latest;
}

export const formatTime = (iso) => (iso ? new Date(iso).toLocaleString("zh-TW", { hour12: false }) : "—");

async function fromThingSpeak(results) {
  const params = new URLSearchParams({ results });
  if (DEMO_THINGSPEAK_READ_KEY) params.set("api_key", DEMO_THINGSPEAK_READ_KEY);
  const res = await fetch(`https://api.thingspeak.com/channels/${DEMO_THINGSPEAK_CHANNEL_ID}/feeds.json?${params}`);
  const body = res.ok ? await res.json() : null;
  // 私人頻道且沒有金鑰時，ThingSpeak 會回傳 -1
  if (!body || body === -1) throw new Error("無法讀取 ThingSpeak 頻道：請將頻道設為公開，或在 config.js 填入 Read API Key");
  return (body.feeds || [])
    .map(normalize)
    .filter((r) => KEYS.some((k) => r[k] !== null))
    .reverse();
}

async function fromSupabase(results) {
  const { supabase, unwrap } = await import("./supabase.js");
  const rows = unwrap(await supabase.from("sensor_readings")
    .select("recorded_at, soil, temperature, humidity")
    .order("recorded_at", { ascending: false })
    .limit(results));
  return rows.map((r) => ({ at: r.recorded_at, soil: r.soil, temperature: r.temperature, humidity: r.humidity }));
}

/** 回傳 { source: "device" | "demo", latest, readings }，readings 由新到舊。 */
export async function loadSensors(user, results = 60) {
  if (user) {
    const own = await fromSupabase(results).catch(() => []);
    if (own.length) return { source: "device", latest: summarize(own), readings: own };
  }
  const demo = await fromThingSpeak(results);
  return { source: "demo", latest: summarize(demo), readings: demo };
}
