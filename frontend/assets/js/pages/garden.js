import { deletePlant, listPlants, setPlantDay } from "../garden.js";
import { STAGES, stageKeyFor, stageRange } from "../growth.js";
import { progressCard } from "../guide.js";
import { requireUser } from "../session.js";
import { busy, emptyHtml, esc, loadingHtml, mountShell, toast } from "../ui.js";

await mountShell();
await requireUser();
const list = document.getElementById("list");
let plants = [];

const rangeText = ([from, to]) => (to ? `第 ${from}–${to} 天` : `第 ${from} 天起`);

/** 「調整進度」表單：選目前階段（跳到該階段第一天）或直接輸入天數。 */
function adjustForm(p) {
  const current = stageKeyFor(p.current_day, p.total_days);
  const options = STAGES.map((s) => {
    const range = stageRange(s.key, p.total_days);
    return `<option value="${range[0]}" ${s.key === current ? "selected" : ""}>${s.name}（${rangeText(range)}）</option>`;
  }).join("");
  return `
    <form class="adjust hidden" data-id="${esc(p.id)}" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">
      <div class="field" style="margin-bottom:10px"><label>目前生長階段</label>
        <select class="input" name="stage">${options}</select></div>
      <div class="field" style="margin-bottom:10px"><label>或指定今天是第幾天</label>
        <input class="input" name="day" type="number" min="1" max="400" value="${esc(p.current_day)}"></div>
      <p style="color:var(--muted);font-size:.85rem;margin-bottom:10px">管理這株植物的 ESP32 會在下一次同步時改用新階段的門檻。</p>
      <div class="row"><button class="btn sm" type="submit"><i class="fa-solid fa-check"></i> 儲存進度</button>
        <button class="btn ghost sm" type="button" data-cancel>取消</button></div>
    </form>`;
}

async function load() {
  list.innerHTML = loadingHtml();
  try {
    plants = await listPlants();
    list.innerHTML = plants.length
      ? plants.map((p) => progressCard(p, `
          ${p.summary ? `<p style="color:var(--muted);font-size:.9rem;margin-top:12px">${esc(p.summary)}</p>` : ""}
          <div class="row" style="margin-top:14px">
            <a class="btn sm" href="planner.html?id=${encodeURIComponent(p.id)}"><i class="fa-solid fa-list-check"></i> 照護指南</a>
            <button class="btn secondary sm" data-adjust="${esc(p.id)}"><i class="fa-solid fa-sliders"></i> 調整進度</button>
            <span class="spacer"></span>
            <button class="btn sm danger icon-btn" data-delete="${esc(p.id)}" data-name="${esc(p.plant_name)}" aria-label="刪除 ${esc(p.plant_name)}"><i class="fa-solid fa-trash"></i></button>
          </div>
          ${adjustForm(p)}`)).join("")
      : `<div style="grid-column:1/-1">${emptyHtml("fa-seedling", "你的花園目前是空的", `<a class="btn" href="planner.html" style="margin-top:12px">建立第一個種植專案</a>`)}</div>`;
  } catch (err) {
    list.innerHTML = `<div class="alert error" style="grid-column:1/-1">${esc(err.message)}</div>`;
  }
}

list.addEventListener("click", async (e) => {
  const adjust = e.target.closest("[data-adjust]");
  if (adjust) {
    adjust.closest(".garden-card").querySelector("form.adjust").classList.toggle("hidden");
    return;
  }
  const cancel = e.target.closest("[data-cancel]");
  if (cancel) {
    cancel.closest("form.adjust").classList.add("hidden");
    return;
  }
  const btn = e.target.closest("[data-delete]");
  if (!btn || !confirm(`確定要刪除「${btn.dataset.name}」嗎？此動作無法復原。`)) return;
  btn.disabled = true;
  try {
    await deletePlant(btn.dataset.delete);
    toast("已刪除");
    load();
  } catch (err) {
    toast(err.message, "error");
    btn.disabled = false;
  }
});

// 選階段時，天數欄位自動帶入該階段第一天
list.addEventListener("change", (e) => {
  if (e.target.name === "stage") e.target.form.day.value = e.target.value;
});

list.addEventListener("submit", async (e) => {
  const form = e.target.closest("form.adjust");
  if (!form) return;
  e.preventDefault();
  const done = busy(form.querySelector("button[type=submit]"), "儲存中…");
  try {
    const updated = await setPlantDay(form.dataset.id, form.day.value);
    toast(`已調整為第 ${updated.current_day} 天（${updated.current_stage}）`);
    load();
  } catch (err) {
    toast(err.message, "error");
    done();
  }
});

load();
