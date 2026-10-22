// 門檻值存在 Supabase 的 thresholds 資料表（RLS 限制只能讀寫自己的），
// ESP32 以裝置權杖呼叫 device_sync() 取得。
import { requireUser } from "../session.js";
import { supabase, unwrap } from "../supabase.js";
import { busy, mountShell, showAlert } from "../ui.js";

// 畫面欄位 id → 資料表欄位
const FIELDS = { tempMin: "temp_min", tempMax: "temp_max", humidMin: "humid_min", humidMax: "humid_max", soilMin: "soil_min" };
const DEFAULTS = { tempMin: 20, tempMax: 30, humidMin: 40, humidMax: 80, soilMin: 35 };

await mountShell();
await requireUser();
const $ = (id) => document.getElementById(id);
const msg = $("msg");

const fill = (values) => Object.keys(FIELDS).forEach((id) => ($(id).value = values[id] ?? DEFAULTS[id]));
const showUpdated = (iso) => ($("updated").textContent = iso ? `上次更新：${new Date(iso).toLocaleString("zh-TW")}` : "");

try {
  const row = unwrap(await supabase.from("thresholds").select("*").maybeSingle());
  fill(row ? Object.fromEntries(Object.entries(FIELDS).map(([id, col]) => [id, row[col]])) : DEFAULTS);
  showUpdated(row?.updated_at);
} catch (err) {
  fill(DEFAULTS);
  showAlert(msg, `讀取設定失敗：${err.message}`);
}

$("defaults").addEventListener("click", () => fill(DEFAULTS));

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = Object.fromEntries(Object.keys(FIELDS).map((id) => [id, Number($(id).value)]));
  if (Object.keys(FIELDS).some((id) => $(id).value === "" || Number.isNaN(v[id]))) return showAlert(msg, "請填寫所有欄位");
  if (v.tempMin >= v.tempMax) return showAlert(msg, "溫度下限必須小於上限");
  if (v.tempMin < -10 || v.tempMax > 50) return showAlert(msg, "溫度需介於 -10~50°C");
  if (v.humidMin >= v.humidMax) return showAlert(msg, "濕度下限必須小於上限");
  if ([v.humidMin, v.humidMax, v.soilMin].some((x) => x < 0 || x > 100)) return showAlert(msg, "濕度需介於 0~100%");

  const done = busy($("submit"), "儲存中…");
  try {
    const now = new Date().toISOString();
    const row = Object.fromEntries(Object.entries(FIELDS).map(([id, col]) => [col, v[id]]));
    unwrap(await supabase.from("thresholds").upsert({ ...row, updated_at: now }));
    showAlert(msg, "設定已儲存，裝置將在下次同步時套用（約 1 分鐘內）。", "ok");
    showUpdated(now);
  } catch (err) {
    showAlert(msg, `儲存失敗：${err.message}`);
  } finally {
    done();
  }
});
