// 植物生長進度計算（純函式）
const DAY_MS = 86400000;

/** 以「瀏覽器所在時區」的日期為準，回傳 YYYY-MM-DD。 */
export function todayISO(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function stageFor(day, totalDays) {
  if (day <= 0) return "尚未開始";
  if (day <= 7) return "種植期";
  if (day <= totalDays * 0.33) return "成長期";
  if (day <= totalDays * 0.66) return "開花期";
  if (day <= totalDays) return "結果期";
  return "收成期";
}

/** day 省略時代表今天；回傳 { day, totalDays, percent, stage }。 */
export function progressFor(startISO, totalDays, day, today = todayISO()) {
  const total = Math.max(1, Math.round(Number(totalDays) || 90));
  const current = day ?? Math.round((Date.parse(today) - Date.parse(startISO)) / DAY_MS) + 1;
  const percent = Math.round(Math.min(100, Math.max(0, (current / total) * 100)) * 10) / 10;
  return { day: current, totalDays: total, percent, stage: stageFor(current, total) };
}

/** AI 回傳的「數字 + 單位」換算成天數，限制在 30~365 天。 */
export function durationToDays(value, unit = "days") {
  const u = String(unit).toLowerCase();
  const mult = u.includes("year") ? 365 : u.includes("month") ? 30 : u.includes("week") ? 7 : 1;
  const days = Math.round(Number(value) * mult);
  return Number.isFinite(days) ? Math.min(365, Math.max(30, days)) : 90;
}

/** 把 Firestore 的種植紀錄加上進度欄位，供畫面使用。 */
export function withProgress(record, today = todayISO()) {
  const p = progressFor(record.start_date, record.total_days, undefined, today);
  return {
    ...record,
    total_days: p.totalDays,
    current_day: p.day,
    progress: p.percent,
    current_stage: p.stage,
  };
}

// ---------- 生長階段（與資料庫 growth_stage() 一致） ----------
export const STAGES = [
  { key: "planting", name: "種植期" },
  { key: "growing", name: "成長期" },
  { key: "flowering", name: "開花期" },
  { key: "fruiting", name: "結果期" },
  { key: "harvest", name: "收成期" },
];

export const stageName = (key) => STAGES.find((s) => s.key === key)?.name ?? key;

/** 第 day 天屬於哪個階段（英文鍵，day ≤ 0 視為種植期）。 */
export function stageKeyFor(day, totalDays) {
  const name = stageFor(Math.max(1, day), totalDays);
  return STAGES.find((s) => s.name === name).key;
}

/** 各階段涵蓋的天數範圍 [第一天, 最後一天]；收成期沒有最後一天（null）。 */
export function stageRange(key, totalDays) {
  const t = Math.max(1, Math.round(totalDays));
  const g = Math.floor(t * 0.33);
  const f = Math.floor(t * 0.66);
  return {
    planting: [1, 7],
    growing: [8, Math.max(8, g)],
    flowering: [Math.max(9, g + 1), Math.max(9, f)],
    fruiting: [Math.max(10, f + 1), Math.max(10, t)],
    harvest: [t + 1, null],
  }[key];
}

/** 要讓今天成為第 day 天，開始日期應該是哪一天。 */
export function startDateForDay(day, today = todayISO()) {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (Math.round(day) - 1));
  return d.toISOString().slice(0, 10);
}

const DEFAULT_RANGE = { tempMin: 20, tempMax: 30, humidMin: 40, humidMax: 80, soilMin: 35 };

/** 把 AI 或使用者輸入的階段門檻整理成資料庫接受的格式（限制範圍、確保下限 < 上限）。 */
export function sanitizeStageThresholds(input) {
  const clamp = (v, lo, hi, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(Math.min(hi, Math.max(lo, n)) * 10) / 10 : fallback;
  };
  const out = {};
  for (const { key } of STAGES) {
    const s = { ...DEFAULT_RANGE, ...(input?.[key] || {}) };
    let tempMin = clamp(s.tempMin, -10, 49, DEFAULT_RANGE.tempMin);
    let tempMax = clamp(s.tempMax, -9, 50, DEFAULT_RANGE.tempMax);
    if (tempMin >= tempMax) [tempMin, tempMax] = tempMin === tempMax ? [tempMin, Math.min(50, tempMin + 1)] : [tempMax, tempMin];
    let humidMin = clamp(s.humidMin, 0, 99, DEFAULT_RANGE.humidMin);
    let humidMax = clamp(s.humidMax, 1, 100, DEFAULT_RANGE.humidMax);
    if (humidMin >= humidMax) [humidMin, humidMax] = humidMin === humidMax ? [humidMin, Math.min(100, humidMin + 1)] : [humidMax, humidMin];
    out[key] = { tempMin, tempMax, humidMin, humidMax, soilMin: clamp(s.soilMin, 0, 100, DEFAULT_RANGE.soilMin) };
  }
  return out;
}
