import { createPlant, getGuide, listPlants } from "../garden.js";
import { renderGuide } from "../guide.js";
import { requireUser } from "../session.js";
import { busy, esc, loadingHtml, mountShell, showAlert, toast } from "../ui.js";

await mountShell();
const user = await requireUser();

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let plants = [];
let selectedId = params.get("id");

if (params.get("plant")) $("plantName").value = params.get("plant");
$("guideCard").classList.add("hidden");

const selected = () => plants.find((p) => p.id === selectedId);

function renderPicker() {
  const picker = $("picker");
  const hasPlants = plants.length > 0;
  ["todayBtn", "dayBtn"].forEach((id) => ($(id).disabled = !hasPlants));
  if (!hasPlants) {
    picker.innerHTML = `<p style="color:var(--muted)">還沒有種植專案，先在左邊建立一個吧。</p>`;
    return;
  }
  if (!selected()) selectedId = plants[0].id;
  picker.innerHTML = plants.map((p) => `
    <button type="button" data-id="${esc(p.id)}" class="${p.id === selectedId ? "active" : ""}">
      ${esc(p.plant_name)} <small>· 第 ${esc(p.current_day)} 天</small>
    </button>`).join("");
  $("day").max = selected().total_days + 30;
  $("day").placeholder = `1~${selected().total_days}`;
}

$("picker").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-id]");
  if (!btn) return;
  selectedId = btn.dataset.id;
  history.replaceState(null, "", `?id=${encodeURIComponent(selectedId)}`);
  renderPicker();
  loadGuide();
});

async function loadPlants() {
  $("picker").innerHTML = loadingHtml();
  try {
    plants = await listPlants();
  } catch (err) {
    $("picker").innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    return;
  }
  renderPicker();
}

async function loadGuide(day, refresh = false) {
  const plant = selected();
  if (!plant) return;
  const card = $("guideCard");
  card.classList.remove("hidden");
  $("guide").innerHTML = loadingHtml(day ? `AI 正在產生第 ${day} 天的指南…` : "AI 正在根據今天的天氣與感測器數據產生指南…");
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const data = await getGuide(user, plant, { day, refresh });
    $("guide").innerHTML = renderGuide(data) + `
      <div class="row" style="margin-top:18px"><span class="spacer"></span>
        <button class="btn ghost sm" id="regen"><i class="fa-solid fa-rotate"></i> 重新產生</button></div>`;
    $("regen").addEventListener("click", () => loadGuide(day, true));
  } catch (err) {
    $("guide").innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
  }
}

$("createForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("createMsg");
  if (!$("plantName").value.trim()) return showAlert(msg, "請輸入植物名稱");
  const done = busy($("createBtn"), "AI 分析中…");
  msg.classList.add("hidden");
  try {
    const plant = await createPlant($("plantName").value);
    showAlert(msg, `已建立「${plant.plant_name}」的種植專案，預計 ${plant.total_days} 天。${plant.summary}`, "ok");
    toast("種植專案已建立");
    $("plantName").value = "";
    selectedId = plant.id;
    history.replaceState(null, "", `?id=${encodeURIComponent(plant.id)}`);
    await loadPlants();
    await loadGuide();
  } catch (err) {
    showAlert(msg, err.message, err.kind === "warn" ? "warn" : "error");
  } finally {
    done();
  }
});

$("todayBtn").addEventListener("click", () => loadGuide());
$("dayBtn").addEventListener("click", () => {
  const day = Number($("day").value);
  if (!day || day < 1) return toast("請輸入要查詢的天數", "error");
  loadGuide(day);
});

await loadPlants();
if (params.get("id") && plants.length) loadGuide();
