// 使用者花園資料（Supabase）。Row Level Security 限制每個人只能存取自己的資料。
//   plants         種植專案
//   plant_guides   AI 指南快取（同一天不重複呼叫 AI）
//   plants.stage_thresholds  各生長階段的自動控制門檻（依生長計畫控制 ESP32）
import { checkPlant, generateGuide, suggestThresholds } from "./ai.js";
import {
  durationToDays, progressFor, sanitizeStageThresholds, startDateForDay, todayISO, withProgress,
} from "./growth.js";
import { loadSensors } from "./sensors.js";
import { getProfile } from "./session.js";
import { supabase, unwrap } from "./supabase.js";
import { forecast } from "./weather.js";

const COLUMNS = "id, plant_name, summary, start_date, total_days, stage_thresholds";

export async function listPlants() {
  const rows = unwrap(await supabase.from("plants").select(COLUMNS).order("start_date", { ascending: false }));
  return rows.map((r) => withProgress(r));
}

/** 先用 AI 確認是植物並估算週期，再建立種植專案。 */
export async function createPlant(rawName) {
  const name = rawName.trim();
  if (!name) throw new Error("請輸入植物名稱");
  if (name.length > 40) throw new Error("植物名稱太長了");
  const check = await checkPlant(name);
  if (!check.is_plant) {
    const err = new Error(`系統判斷「${name}」不是可種植的植物，請輸入正確的作物或花卉名稱`);
    err.kind = "warn";
    throw err;
  }
  const row = unwrap(await supabase.from("plants").insert({
    plant_name: String(check.normalized_name || name).trim().slice(0, 40),
    summary: String(check.summary || "").slice(0, 500),
    start_date: todayISO(),
    total_days: durationToDays(check.duration_value || 90, check.duration_unit),
  }).select(COLUMNS).single());
  return withProgress(row);
}

export async function deletePlant(plantId) {
  unwrap(await supabase.from("plants").delete().eq("id", plantId)); // 指南會一併刪除（on delete cascade）
}

/** 取得第 day 天（省略為今天）的指南；今天的指南會參考即時天氣與感測器。 */
export async function getGuide(user, plant, { day, refresh = false } = {}) {
  const isToday = !day || day === plant.current_day;
  const targetDay = isToday ? plant.current_day : day;
  if (targetDay < 1 || targetDay > plant.total_days + 30) {
    throw new Error(`天數需介於 1 到 ${plant.total_days + 30} 之間`);
  }
  const { stage } = progressFor(plant.start_date, plant.total_days, targetDay);
  // 今天的指南依日期＋天數快取：使用者調整進度後會重新產生
  const cacheKey = isToday ? `today-${todayISO()}-d${targetDay}` : `day-${targetDay}`;

  if (!refresh) {
    const cached = unwrap(await supabase.from("plant_guides").select("payload")
      .eq("plant_id", plant.id).eq("cache_key", cacheKey).maybeSingle());
    if (cached) return { ...cached.payload, plant, day: targetDay, stage, cached: true };
  }

  let weather = null;
  let sensor = null;
  if (isToday) {
    const [profile, sensors] = await Promise.all([getProfile(user), loadSensors(user).catch(() => null)]);
    weather = await forecast(profile.address);
    sensor = sensors?.latest ?? null;
  }
  const guide = await generateGuide({
    plantName: plant.plant_name, day: targetDay, totalDays: plant.total_days, stage, weather, sensor,
  });
  const payload = { guide, weather, sensor, generated_at: new Date().toISOString() };
  unwrap(await supabase.from("plant_guides").upsert({ plant_id: plant.id, cache_key: cacheKey, payload }));
  return { ...payload, plant, day: targetDay, stage, cached: false };
}

/** 調整進度：把開始日期改成「今天是第 day 天」。資料庫會據此重新計算階段與自動控制門檻。 */
export async function setPlantDay(plantId, day) {
  const d = Math.round(Number(day));
  if (!Number.isFinite(d) || d < 1 || d > 400) throw new Error("天數需介於 1 到 400 之間");
  const row = unwrap(await supabase.from("plants").update({ start_date: startDateForDay(d) })
    .eq("id", plantId).select(COLUMNS).single());
  return withProgress(row);
}

/** 請 AI 建議各生長階段門檻並存檔。 */
export async function suggestStageThresholds(plant) {
  const suggested = sanitizeStageThresholds(await suggestThresholds(plant.plant_name, plant.total_days));
  return saveStageThresholds(plant.id, suggested);
}

export async function saveStageThresholds(plantId, thresholds) {
  const clean = sanitizeStageThresholds(thresholds);
  unwrap(await supabase.from("plants").update({ stage_thresholds: clean }).eq("id", plantId));
  return clean;
}
