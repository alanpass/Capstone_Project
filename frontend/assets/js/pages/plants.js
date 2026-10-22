import { loadCatalog, PLACEHOLDER_IMG } from "../catalog.js";
import { emptyHtml, esc, loadingHtml, mountShell } from "../ui.js";

await mountShell();
const $ = (id) => document.getElementById(id);
const list = $("list");
list.innerHTML = loadingHtml("載入植物資料…");

let all = [];
try {
  all = await loadCatalog();
} catch (err) {
  list.innerHTML = `<div class="alert error" style="grid-column:1/-1">${esc(err.message)}</div>`;
}
$("total").textContent = `${all.length} 種`;

// 依資料內容產生篩選選項
const fill = (select, key) => {
  const values = [...new Set(all.map((p) => p[key]).filter(Boolean))].sort();
  select.insertAdjacentHTML("beforeend", values.map((v) => `<option>${esc(v)}</option>`).join(""));
};
fill($("level"), "care_level");
fill($("sun"), "sunlight_needs");

// 保留篩選條件在網址上，方便分享與返回
const params = new URLSearchParams(location.search);
for (const id of ["q", "level", "sun", "sort"]) if (params.has(id)) $(id).value = params.get(id);

function render() {
  const q = $("q").value.trim().toLowerCase();
  const level = $("level").value;
  const sun = $("sun").value;
  const sort = $("sort").value;

  let rows = all.filter((p) =>
    (!level || p.care_level === level) &&
    (!sun || p.sunlight_needs === sun) &&
    (!q || [p.plant_name, p.description, p.watering_schedule, p.sunlight_needs, p.lifespan].join(" ").toLowerCase().includes(q)));
  if (sort !== "id") {
    rows = rows.slice().sort((a, b) => a.plant_name.localeCompare(b.plant_name, "zh-Hant"));
    if (sort === "name-desc") rows.reverse();
  }

  const next = new URLSearchParams();
  for (const id of ["q", "level", "sun", "sort"]) if ($(id).value && $(id).value !== "id") next.set(id, $(id).value);
  history.replaceState(null, "", next.toString() ? `?${next}` : location.pathname);

  $("shown").textContent = `顯示 ${rows.length} / ${all.length} 筆`;
  list.innerHTML = rows.length
    ? rows.map((p) => {
        const href = `plant.html?id=${encodeURIComponent(p.id)}`;
        return `
          <article class="card plant-card">
            <a class="thumb" href="${href}"><img src="${esc(p.image || PLACEHOLDER_IMG)}" alt="${esc(p.plant_name)}" loading="lazy"></a>
            <div class="body">
              <h3><a href="${href}">${esc(p.plant_name)}</a></h3>
              <div class="row" style="gap:6px">
                ${p.care_level ? `<span class="badge"><i class="fa-solid fa-hand-holding-droplet"></i> 照護${esc(p.care_level)}</span>` : ""}
                ${p.sunlight_needs ? `<span class="badge"><i class="fa-solid fa-sun"></i> ${esc(p.sunlight_needs)}</span>` : ""}
                ${p.watering_schedule ? `<span class="badge"><i class="fa-solid fa-droplet"></i> ${esc(p.watering_schedule)}</span>` : ""}
              </div>
              <p class="desc">${esc(p.description || "暫無描述")}</p>
              <div class="actions">
                <a class="btn sm secondary" href="${href}">詳細資訊</a>
                <a class="btn sm" href="planner.html?plant=${encodeURIComponent(p.plant_name)}">種植此植物 <i class="fa-solid fa-arrow-right"></i></a>
              </div>
            </div>
          </article>`;
      }).join("")
    : `<div style="grid-column:1/-1">${emptyHtml("fa-leaf", "沒有找到符合的植物", "<p>換個關鍵字或清除篩選條件試試。</p>")}</div>`;
}

let timer;
$("q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(render, 150); });
["level", "sun", "sort"].forEach((id) => $(id).addEventListener("change", render));
if (all.length) render();
