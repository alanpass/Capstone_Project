// 自動控制：
//   - 我的裝置：每塊 ESP32 一組權杖，可各自指定要管理哪一株植物（devices.plant_id）
//   - 生長計畫門檻：每株植物 5 個生長階段的門檻（plants.stage_thresholds）
//   - 手動門檻：沒指定植物的裝置使用（thresholds 資料表）
// 每塊裝置實際套用哪一組由資料庫的 effective_thresholds() 決定，ESP32 與本頁看到的一定相同。
import { CONNECTION_TEXT, connectionOf, timeAgo } from "../devices.js";
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
const DEVICE_COLUMNS = "id, name, token, plant_id, last_seen_at, created_at";

await mountShell();
await requireUser();
const $ = (id) => document.getElementById(id);
const msg = $("msg");

let plants = [];
let devices = [];
let applied = new Map(); // 裝置 id → 目前套用的門檻

const selectedPlant = () => plants.find((p) => p.id === $("plantSelect").value);

function plantOptions(selectedId) {
  return [`<option value="">不指定（使用手動門檻）</option>`]
    .concat(plants.map((p) => `<option value="${esc(p.id)}" ${p.id === selectedId ? "selected" : ""}>${esc(p.plant_name)}（第 ${esc(p.current_day)} 天・${esc(p.current_stage)}）</option>`))
    .join("");
}

function seenText(iso) {
  const state = connectionOf(iso);
  return `<span class="conn ${state}">${CONNECTION_TEXT[state]}</span>${iso ? `<span class="seen">上次同步：${timeAgo(iso)}</span>` : ""}`;
}

function appliedText(e) {
  if (!e) return "";
  const source = e.source === "plan"
    ? `<span class="badge"><i class="fa-solid fa-seedling"></i> ${esc(e.plantName)}・第 ${esc(e.day)} 天・${esc(stageName(e.stage))}</span>`
    : e.source === "user" ? `<span class="badge"><i class="fa-solid fa-hand"></i> 手動門檻</span>` : `<span class="badge">預設值</span>`;
  return `${source} 溫度 ${fmt(e.tempMin)}~${fmt(e.tempMax)}°C・濕度 ${fmt(e.humidMin)}~${fmt(e.humidMax)}%・土壤低於 ${fmt(e.soilMin)}% 澆水`;
}

// ---------- 我的裝置 ----------
async function loadApplied() {
  const list = unwrap(await supabase.rpc("my_device_thresholds"));
  applied = new Map(list.map((e) => [e.deviceId, e]));
}

function renderDevices() {
  const box = $("devices");
  if (!devices.length) {
    box.innerHTML = emptyHtml("fa-microchip", "還沒有登記裝置", `<p style="color:var(--muted);margin-top:8px">按右上角「新增裝置」，把產生的權杖填到 ESP32 的 config.py。</p>`);
    return;
  }
  box.innerHTML = `<div class="device-list">${devices.map((d) => `
    <div class="device-item" data-id="${esc(d.id)}">
      <div class="head"><h3><i class="fa-solid fa-microchip"></i> ${esc(d.name)}</h3>${seenText(d.last_seen_at)}<span class="spacer"></span>
        <button class="btn ghost sm" data-action="rename">改名</button>
        <button class="btn ghost sm" data-action="token"><i class="fa-solid fa-key"></i> 權杖</button>
        <button class="btn sm danger icon-btn" data-action="delete" aria-label="刪除 ${esc(d.name)}"><i class="fa-solid fa-trash"></i></button></div>
      <div class="controls">
        <div class="field" style="margin:0"><label>管理哪一株植物</label><select class="input" data-action="plant">${plantOptions(d.plant_id)}</select></div>
      </div>
      <div class="applied">${appliedText(applied.get(d.id))}</div>
      <div class="token hidden"><code>${esc(d.token)}</code>
        <button class="btn secondary sm" data-action="copy"><i class="fa-regular fa-copy"></i> 複製</button>
        <button class="btn ghost sm" data-action="regenerate"><i class="fa-solid fa-rotate"></i> 重新產生</button>
        <small style="color:var(--muted);width:100%">填到這塊 ESP32 的 <code>config.py</code>（<code>DEVICE_TOKEN</code>）。外洩時請重新產生，舊權杖會立即失效。</small></div>
    </div>`).join("")}</div>`;
}

async function refreshDevices() {
  devices = unwrap(await supabase.from("devices").select(DEVICE_COLUMNS).order("created_at"));
  await loadApplied();
  renderDevices();
}

/** 指定植物時，若那株植物還沒有階段門檻，直接請 AI 產生並在下方顯示。 */
async function ensurePlan(plantId) {
  const plant = plants.find((p) => p.id === plantId);
  if (!plant) return;
  $("plantSelect").value = plant.id;
  renderPlan();
  if (!plant.stage_thresholds) await aiSuggest();
}

$("devices").addEventListener("change", async (e) => {
  if (e.target.dataset.action !== "plant") return;
  const select = e.target;
  const device = devices.find((d) => d.id === select.closest(".device-item").dataset.id);
  const plantId = select.value || null;
  select.disabled = true;
  try {
    unwrap(await supabase.from("devices").update({ plant_id: plantId }).eq("id", device.id));
    device.plant_id = plantId;
    const plant = plants.find((p) => p.id === plantId);
    toast(plant ? `「${device.name}」改由「${plant.plant_name}」的生長計畫控制` : `「${device.name}」改用手動門檻`);
    await refreshDevices();
    if (plantId) await ensurePlan(plantId);
  } catch (err) {
    showAlert(msg, `更新失敗：${err.message}`);
    select.disabled = false;
  }
});

$("devices").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const item = btn.closest(".device-item");
  const device = devices.find((d) => d.id === item.dataset.id);
  try {
    switch (btn.dataset.action) {
      case "token":
        item.querySelector(".token").classList.toggle("hidden");
        break;
      case "copy":
        await navigator.clipboard.writeText(device.token).then(() => toast("已複製裝置權杖"), () => toast("無法存取剪貼簿，請手動選取複製", "error"));
        break;
      case "regenerate":
        if (!confirm(`重新產生「${device.name}」的權杖？舊權杖會立即失效，需要更新這塊 ESP32 的 config.py。`)) return;
        device.token = unwrap(await supabase.rpc("regenerate_device_token", { p_device: device.id }));
        item.querySelector(".token code").textContent = device.token;
        toast("已產生新的裝置權杖");
        break;
      case "rename": {
        const name = prompt("裝置名稱", device.name)?.trim();
        if (!name || name === device.name) return;
        if (name.length > 30) return showAlert(msg, "名稱最多 30 個字");
        unwrap(await supabase.from("devices").update({ name }).eq("id", device.id));
        device.name = name;
        renderDevices();
        break;
      }
      case "delete":
        if (!confirm(`刪除「${device.name}」？它的權杖會失效，已上傳的感測數據會保留。`)) return;
        unwrap(await supabase.from("devices").delete().eq("id", device.id));
        toast("已刪除裝置");
        await refreshDevices();
        break;
    }
  } catch (err) {
    showAlert(msg, err.message);
  }
});

// 新增裝置
$("addToggle").addEventListener("click", () => {
  $("newPlant").innerHTML = plantOptions($("plantSelect").value || null);
  $("addForm").classList.toggle("hidden");
  $("newName").focus();
});
$("addCancel").addEventListener("click", () => $("addForm").classList.add("hidden"));
$("addForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("newName").value.trim();
  if (!name) return showAlert(msg, "請輸入裝置名稱");
  const plantId = $("newPlant").value || null;
  const done = busy($("addSubmit"), "新增中…");
  try {
    const row = unwrap(await supabase.from("devices").insert({ name, plant_id: plantId }).select("id").single());
    $("addForm").reset();
    $("addForm").classList.add("hidden");
    await refreshDevices();
    document.querySelector(`.device-item[data-id="${row.id}"] .token`)?.classList.remove("hidden");
    showAlert(msg, `已新增「${name}」，請把下方的權杖填到這塊 ESP32 的 config.py。`, "ok");
    if (plantId) await ensurePlan(plantId);
  } catch (err) {
    showAlert(msg, `新增失敗：${err.message}`);
  } finally {
    done();
  }
});

// ---------- 生長計畫門檻表 ----------
function renderPlan() {
  const plant = selectedPlant();
  const body = $("planBody");
  $("aiSuggest").disabled = !plant;
  $("plantSelect").disabled = !plant;
  if (!plant) {
    body.innerHTML = emptyHtml("fa-seedling", "還沒有種植專案", `<a class="btn" href="planner.html" style="margin-top:12px">建立種植專案</a>`);
    return;
  }
  if (!plant.stage_thresholds) {
    body.innerHTML = `<div class="alert warn">「${esc(plant.plant_name)}」還沒有各階段門檻，按右上角「AI 重新建議」讓 AI 依作物特性產生（之後可以手動修改）。</div>`;
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
  const managers = devices.filter((d) => d.plant_id === plant.id).map((d) => d.name);
  body.innerHTML = `
    <p style="font-size:.9rem;margin-bottom:10px">${managers.length
      ? `<i class="fa-solid fa-microchip"></i> 由 ${managers.map((n) => `<strong>${esc(n)}</strong>`).join("、")} 依此計畫控制`
      : `<span style="color:var(--muted)">目前沒有裝置管理這株植物，可在上方「我的裝置」指定。</span>`}</p>
    <div class="table-wrap"><table class="stages">
      <thead><tr><th>階段</th>${KEYS.map((k) => `<th>${LABELS[k]}<br><small>${UNITS[k]}</small></th>`).join("")}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="row" style="margin-top:14px"><button class="btn" id="savePlan"><i class="fa-solid fa-floppy-disk"></i> 儲存階段門檻</button></div>`;
  $("savePlan").addEventListener("click", savePlan);
}

async function afterThresholdChange() {
  await loadApplied();
  renderDevices();
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
    afterThresholdChange();
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
    afterThresholdChange();
  } catch (err) {
    showAlert(msg, err.message);
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
    unwrap(await supabase.from("thresholds").upsert({ ...values, updated_at: now }));
    showAlert(msg, "手動門檻已儲存，使用手動門檻的裝置將在下次同步時套用（約 1 分鐘內）。", "ok");
    showUpdated(now);
    afterThresholdChange();
  } catch (err) {
    showAlert(msg, `儲存失敗：${err.message}`);
  } finally {
    done();
  }
});

$("defaults").addEventListener("click", () => fillManual(DEFAULTS));
$("aiSuggest").addEventListener("click", aiSuggest);
$("plantSelect").addEventListener("change", renderPlan);

// ---------- 初始化 ----------
$("devices").innerHTML = loadingHtml();
let manual = null;
try {
  [plants, manual] = await Promise.all([listPlants(), supabase.from("thresholds").select("*").maybeSingle().then(unwrap)]);
  await refreshDevices();
} catch (err) {
  $("devices").innerHTML = "";
  showAlert(msg, `讀取設定失敗：${err.message}`);
}
$("plantSelect").innerHTML = plants.length
  ? plants.map((p) => `<option value="${esc(p.id)}">${esc(p.plant_name)}</option>`).join("")
  : `<option value="">（尚無種植專案）</option>`;
// 預設顯示第一塊有指定植物的裝置所管理的植物
const managed = devices.find((d) => d.plant_id && plants.some((p) => p.id === d.plant_id));
if (managed) $("plantSelect").value = managed.plant_id;
fillManual(manual ? Object.fromEntries(Object.entries(FIELDS).map(([id, col]) => [id, manual[col]])) : DEFAULTS);
showUpdated(manual?.updated_at);
renderPlan();
