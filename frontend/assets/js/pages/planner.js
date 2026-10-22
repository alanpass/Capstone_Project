import { api } from "../api.js";
import { renderGuide } from "../guide.js";
import { requireUser } from "../session.js";
import { busy, esc, loadingHtml, mountShell, showAlert, toast } from "../ui.js";

await mountShell();
await requireUser();

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let plants = [];
let selectedId = params.get("id");

if (params.get("plant")) $("plantName").value = params.get("plant");
$("guideCard").classList.add("hidden");

function renderPicker() {
  const picker = $("picker");
  if (!plants.length) {
    picker.innerHTML = `<p style="color:var(--muted)">還沒有種植專案，先在左邊建立一個吧。</p>`;
    ["todayBtn", "dayBtn"].forEach((id) => ($(id).disabled = true));
    return;
  }
  ["todayBtn", "dayBtn"].forEach((id) => ($(id).disabled = false));
  if (!plants.some((p) => p.id === selectedId)) selectedId = plants[0].id;
  picker.innerHTML = plants.map((p) => `
    <button type="button" data-id="${esc(p.id)}" class="${p.id === selectedId ? "active" : ""}">
      ${esc(p.plant_name)} <small>· 第 ${esc(p.current_day)} 天</small>
    </button>`).join("");
  const current = plants.find((p) => p.id === selectedId);
  $("day").max = current.total_days + 30;
  $("day").placeholder = `1~${current.total_days}`;
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
    plants = (await api("/api/garden")).plants;
  } catch (err) {
    $("picker").innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    return;
  }
  renderPicker();
}

async function loadGuide(day, refresh = false) {
  if (!selectedId) return;
  const card = $("guideCard");
  card.classList.remove("hidden");
  $("guide").innerHTML = loadingHtml(day ? `AI 正在產生第 ${day} 天的指南…` : "AI 正在根據今天的天氣與感測器數據產生指南…");
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  const query = new URLSearchParams();
  if (day) query.set("day", day);
  if (refresh) query.set("refresh", "1");
  try {
    const data = await api(`/api/garden/${encodeURIComponent(selectedId)}/guide?${query}`);
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
  const name = $("plantName").value.trim();
  const msg = $("createMsg");
  if (!name) return showAlert(msg, "請輸入植物名稱");
  const done = busy($("createBtn"), "AI 分析中…");
  msg.classList.add("hidden");
  try {
    const { plant } = await api("/api/garden", { method: "POST", body: { plant_name: name } });
    showAlert(msg, `已建立「${plant.plant_name}」的種植專案，預計 ${plant.total_days} 天。${plant.summary || ""}`, "ok");
    toast("種植專案已建立");
    $("plantName").value = "";
    selectedId = plant.id;
    history.replaceState(null, "", `?id=${encodeURIComponent(plant.id)}`);
    await loadPlants();
    await loadGuide();
  } catch (err) {
    showAlert(msg, err.message, err.message.includes("不是可種植") ? "warn" : "error");
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
