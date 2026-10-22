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
