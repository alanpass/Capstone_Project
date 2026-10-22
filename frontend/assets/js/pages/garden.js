import { deletePlant, listPlants } from "../garden.js";
import { progressCard } from "../guide.js";
import { requireUser } from "../session.js";
import { emptyHtml, esc, loadingHtml, mountShell, toast } from "../ui.js";

await mountShell();
await requireUser();
const list = document.getElementById("list");

async function load() {
  list.innerHTML = loadingHtml();
  try {
    const plants = await listPlants();
    list.innerHTML = plants.length
      ? plants.map((p) => progressCard(p, `
          ${p.summary ? `<p style="color:var(--muted);font-size:.9rem;margin-top:12px">${esc(p.summary)}</p>` : ""}
          <div class="row" style="margin-top:14px">
            <a class="btn sm" href="planner.html?id=${encodeURIComponent(p.id)}"><i class="fa-solid fa-list-check"></i> 照護指南</a>
            <span class="spacer"></span>
            <button class="btn sm danger icon-btn" data-delete="${esc(p.id)}" data-name="${esc(p.plant_name)}" aria-label="刪除 ${esc(p.plant_name)}"><i class="fa-solid fa-trash"></i></button>
          </div>`)).join("")
      : `<div style="grid-column:1/-1">${emptyHtml("fa-seedling", "你的花園目前是空的", `<a class="btn" href="planner.html" style="margin-top:12px">建立第一個種植專案</a>`)}</div>`;
  } catch (err) {
    list.innerHTML = `<div class="alert error" style="grid-column:1/-1">${esc(err.message)}</div>`;
  }
}

list.addEventListener("click", async (e) => {
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

load();
