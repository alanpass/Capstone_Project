// 自動控制：
//   - 手動模式：thresholds 資料表的固定門檻
//   - 生長計畫模式：thresholds.plant_id 指定的植物，依目前生長階段套用 plants.stage_thresholds
// 實際要套用哪一組由資料庫的 effective_thresholds() 決定，ESP32 與本頁看到的一定相同。
import { listPlants, saveStageThresholds, suggestStageThresholds } from "../garden.js";
import { STAGES, stageKeyFor, stageName, stageRange } from "../growth.js";
import { requireUser } from "../session.js";
import { supabase, unwrap } from "../supabase.js";
import { busy, emptyHtml, esc, fmt, loadingHtml, mountShell, showAlert, toast } from "../ui.js";

// 畫面欄位 id → 資料表欄位
const FIELDS = { tempMin: "temp_min", tempMax: "temp_max", humidMin: "humid_min", humidMax: "humid_max", soilMin: "soil_min" };
const KEYS = Object.keys(FIELDS);
const DEFAULTS = { tempMin: 20, tempMax: 30, humidMin: 40, humidMax: 80, soilMin: 35 };
const LABELS = { tempMin: "溫度下限", tempMax: "溫度上限", humidMin: "濕度下限", humidMax: "濕度上限", soilMin: "澆水門檻" };
const UNITS = { tempMin: "°C", tempMax: "°C", humidMin: "%", humidMax: "%", soilMin: "%" };

await mountShell();
await requireUser();
const $ = (id) => document.getElementById(id);
const msg = $("msg");

let plants = [];
let row = null; // thresholds 資料列

const selectedMode = () => document.querySelector("input[name=mode]:checked")?.value ?? "manual";
const selectedPlant = () => plants.find((p) => p.id === $("plantSelect").value);

// ---------- 裝置目前套用 ----------
async function showEffective() {
  $("effective").innerHTML = loadingHtml();
  try {
    const e = unwrap(await supabase.rpc("my_effective_thresholds"));
    const source = e.source === "plan"
      ? `<span class="badge"><i class="fa-solid fa-seedling"></i> 生長計畫：${esc(e.plantName)}・第 ${esc(e.day)} 天・${esc(stageName(e.stage))}</span>`
      : e.source === "user" ? `<span class="badge"><i class="fa-solid fa-hand"></i> 手動門檻</span>` : `<span class="badge">預設值</span>`;
    $("effective").innerHTML = `
      <div class="row" style="margin-bottom:12px">${source}</div>
      <div class="stats">
        <div class="stat"><div class="label"><i class="fa-solid fa-temperature-half"></i> 溫度</div><div class="value">${fmt(e.tempMin)}~${fmt(e.tempMax)}<small>°C</small></div></div>
        <div class="stat"><div class="label"><i class="fa-solid fa-droplet"></i> 空氣濕度</div><div class="value">${fmt(e.humidMin)}~${fmt(e.humidMax)}<small>%</small></div></div>
        <div class="stat"><div class="label"><i class="fa-solid fa-faucet-drip"></i> 低於此值澆水</div><div class="value">${fmt(e.soilMin)}<small>%</small></div></div>
      </div>`;
  } catch (err) {
    $("effective").innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
  }
}

// ---------- 生長計畫門檻表 ----------
function renderPlan() {
  const plant = selectedPlant();
  const body = $("planBody");
  $("aiSuggest").disabled = !plant;
  if (!plant) {
    $("planTitle").textContent = "生長計畫門檻";
    body.innerHTML = emptyHtml("fa-seedling", "還沒有種植專案", `<a class="btn" href="planner.html" style="margin-top:12px">建立種植專案</a>`);
    return;
  }
  $("planTitle").textContent = `${plant.plant_name}的生長計畫門檻`;
  if (!plant.stage_thresholds) {
    body.innerHTML = `<div class="alert warn">這株植物還沒有各階段門檻，按右上角「AI 重新建議」讓 AI 依作物特性產生（之後可以手動修改）。</div>`;
    return;
  }
  const current = stageKeyFor(plant.current_day, plant.total_days);
  const rows = STAGES.map((s) => {
    const range = stageRange(s.key, plant.total_days);
    const values = plant.stage_thresholds[s.key] || DEFAULTS;
    return `
      <tr class="${s.key === current ? "current" : ""}" data-stage="${s.key}">
        <td class="stage-name"><strong>${s.name}</strong>${s.key === current ? ' <span class="badge">目前</span>' : ""}
          <small>${range[1] ? `第 ${range[0]}–${range[1]} 天` : `第 ${range[0]} 天起`}</small></td>
        ${KEYS.map((k) => `<td><input class="input" type="number" step="${k.startsWith("temp") ? 0.5 : 1}" name="${k}" value="${esc(values[k])}" aria-label="${s.name}${LABELS[k]}"></td>`).join("")}
      </tr>`;
  }).join("");
  body.innerHTML = `
    <div class="table-wrap"><table class="stages">
      <thead><tr><th>階段</th>${KEYS.map((k) => `<th>${LABELS[k]}<br><small>${UNITS[k]}</small></th>`).join("")}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="row" style="margin-top:14px"><button class="btn" id="savePlan"><i class="fa-solid fa-floppy-disk"></i> 儲存階段門檻</button></div>`;
  $("savePlan").addEventListener("click", savePlan);
}

async function savePlan() {
  const plant = selectedPlant();
  const values = {};
  for (const tr of $("planBody").querySelectorAll("tr[data-stage]")) {
    values[tr.dataset.stage] = Object.fromEntries(KEYS.map((k) => [k, Number(tr.querySelector(`[name=${k}]`).value)]));
  }
  const done = busy($("savePlan"), "儲存中…");
  try {
    plant.stage_thresholds = await saveStageThresholds(plant.id, values);
    renderPlan(); // 顯示整理後的值（例如自動修正下限 > 上限）
    toast("階段門檻已儲存");
    showEffective();
  } catch (err) {
    showAlert(msg, `儲存失敗：${err.message}`);
    done();
  }
}

async function aiSuggest() {
  const plant = selectedPlant();
  if (!plant) return;
  if (plant.stage_thresholds && !confirm(`用 AI 重新產生「${plant.plant_name}」各階段的門檻？目前的設定會被取代。`)) return;
  const done = busy($("aiSuggest"), "AI 分析中…");
  try {
    plant.stage_thresholds = await suggestStageThresholds(plant);
    renderPlan();
    toast("AI 已產生各階段門檻");
    showEffective();
  } catch (err) {
    showAlert(msg, err.message);
  } finally {
    done();
  }
}

// ---------- 控制模式 ----------
function renderMode() {
  const plan = selectedMode() === "plan";
  $("plantField").classList.toggle("hidden", !plan);
  $("planCard").classList.toggle("hidden", !plan);
  $("manualCard").classList.toggle("hidden", plan);
  if (plan) renderPlan();
}

async function saveMode() {
  const mode = selectedMode();
  const plant = selectedPlant();
  if (mode === "plan" && !plant) return showAlert(msg, "請先建立種植專案");
  const done = busy($("saveMode"), "套用中…");
  try {
    row = unwrap(await supabase.from("thresholds")
      .upsert({ mode, plant_id: mode === "plan" ? plant.id : row?.plant_id ?? null, updated_at: new Date().toISOString() })
      .select("*").single());
    showAlert(msg, mode === "plan"
      ? `已改為依「${plant.plant_name}」的生長計畫自動調整，裝置將在 1 分鐘內套用。`
      : "已改為手動門檻，裝置將在 1 分鐘內套用。", "ok");
    showEffective();
    // 第一次切到生長計畫且還沒有階段門檻 → 直接請 AI 產生
    if (mode === "plan" && !plant.stage_thresholds) aiSuggest();
  } catch (err) {
    showAlert(msg, `套用失敗：${err.message}`);
  } finally {
    done();
  }
}

// ---------- 手動門檻 ----------
const fillManual = (values) => KEYS.forEach((id) => ($(id).value = values[id] ?? DEFAULTS[id]));
const showUpdated = (iso) => ($("updated").textContent = iso ? `上次更新：${new Date(iso).toLocaleString("zh-TW")}` : "");

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = Object.fromEntries(KEYS.map((id) => [id, Number($(id).value)]));
  if (KEYS.some((id) => $(id).value === "" || Number.isNaN(v[id]))) return showAlert(msg, "請填寫所有欄位");
  if (v.tempMin >= v.tempMax) return showAlert(msg, "溫度下限必須小於上限");
  if (v.tempMin < -10 || v.tempMax > 50) return showAlert(msg, "溫度需介於 -10~50°C");
  if (v.humidMin >= v.humidMax) return showAlert(msg, "濕度下限必須小於上限");
  if ([v.humidMin, v.humidMax, v.soilMin].some((x) => x < 0 || x > 100)) return showAlert(msg, "濕度需介於 0~100%");

  const done = busy($("submit"), "儲存中…");
  try {
    const now = new Date().toISOString();
    const values = Object.fromEntries(Object.entries(FIELDS).map(([id, col]) => [col, v[id]]));
    row = unwrap(await supabase.from("thresholds").upsert({ ...values, updated_at: now }).select("*").single());
    showAlert(msg, "手動門檻已儲存，裝置將在下次同步時套用（約 1 分鐘內）。", "ok");
    showUpdated(now);
    showEffective();
  } catch (err) {
    showAlert(msg, `儲存失敗：${err.message}`);
  } finally {
    done();
  }
});

$("defaults").addEventListener("click", () => fillManual(DEFAULTS));
$("saveMode").addEventListener("click", saveMode);
$("aiSuggest").addEventListener("click", aiSuggest);
document.querySelectorAll("input[name=mode]").forEach((r) => r.addEventListener("change", renderMode));
$("plantSelect").addEventListener("change", renderPlan);

// ---------- 初始化 ----------
try {
  [plants, row] = await Promise.all([listPlants(), supabase.from("thresholds").select("*").maybeSingle().then(unwrap)]);
} catch (err) {
  showAlert(msg, `讀取設定失敗：${err.message}`);
}
$("plantSelect").innerHTML = plants.length
  ? plants.map((p) => `<option value="${esc(p.id)}">${esc(p.plant_name)}（第 ${esc(p.current_day)} 天・${esc(p.current_stage)}）</option>`).join("")
  : `<option value="">（尚無種植專案）</option>`;
if (row?.plant_id && plants.some((p) => p.id === row.plant_id)) $("plantSelect").value = row.plant_id;
document.querySelector(`input[name=mode][value=${row?.mode === "plan" ? "plan" : "manual"}]`).checked = true;
fillManual(row ? Object.fromEntries(Object.entries(FIELDS).map(([id, col]) => [id, row[col]])) : DEFAULTS);
showUpdated(row?.updated_at);
renderMode();
showEffective();
