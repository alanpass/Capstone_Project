import { loadCatalog, PLACEHOLDER_IMG } from "../catalog.js";
import { emptyHtml, esc, loadingHtml, mountShell } from "../ui.js";

await mountShell();
const content = document.getElementById("content");
content.innerHTML = loadingHtml();

const SECTIONS = [
  ["fa-hand-holding-heart", "照護需求", [["照護等級", "care_level"], ["照護難度", "care_difficulty"], ["抗逆性", "resilience"], ["生命週期", "lifespan"], ["耐寒區", "hardiness_zone"]]],
  ["fa-droplet", "澆水", [["澆水頻率", "watering_schedule"], ["說明", "watering_details"]]],
  ["fa-sun", "日照", [["日照需求", "sunlight_needs"], ["說明", "sunlight_details"]]],
  ["fa-temperature-half", "溫度", [["理想溫度", "ideal_temperature"], ["可耐受溫度", "tolerant_temperature"], ["說明", "temperature_details"]]],
  ["fa-mound", "土壤", [["土壤種類", "soil_type"], ["土壤成分", "soil_composition"], ["酸鹼值", "soil_ph"], ["說明", "soil_details"]]],
  ["fa-scissors", "施肥與修剪", [["施肥", "fertilizing_details"], ["修剪時機", "pruning_timing"], ["修剪好處", "pruning_benefits"], ["修剪方式", "pruning_details"]]],
  ["fa-seedling", "繁殖與種植", [["繁殖時機", "propagation_timing"], ["繁殖方式", "propagation_type"], ["繁殖說明", "propagation_details"], ["種植時機", "planting_timing"], ["種植說明", "planting_details"]]],
  ["fa-box-open", "移植、換盆與越冬", [["移植時機", "transplant_timing"], ["移植說明", "transplant_details"], ["換盆頻率", "repotting_schedule"], ["換盆說明", "repotting_details"], ["越冬", "overwintering_details"]]],
  ["fa-basket-shopping", "收成", [["收成說明", "harvesting_details"]]],
  ["fa-triangle-exclamation", "毒性", [["對人類", "toxicity_human"], ["對貓", "toxicity_cat"], ["對狗", "toxicity_dog"]]],
];

const id = new URLSearchParams(location.search).get("id");
try {
  const plant = (await loadCatalog()).find((p) => p.id === id);
  if (!plant) {
    content.innerHTML = emptyHtml("fa-circle-question", "找不到這個植物", `<a class="btn" href="plants.html" style="margin-top:12px">回到植物百科</a>`);
  } else {
    document.title = `${plant.plant_name}｜園藝智能助理`;
    const sections = SECTIONS.map(([icon, title, fields]) => {
      const rows = fields.filter(([, key]) => plant[key]).map(([label, key]) => `<dt>${esc(label)}</dt><dd>${esc(plant[key])}</dd>`).join("");
      return rows ? `<section class="card"><h2><i class="fa-solid ${icon}"></i> ${esc(title)}</h2><dl class="kv">${rows}</dl></section>` : "";
    }).join("");
    content.innerHTML = `
      <section class="card detail-hero" style="margin-bottom:20px">
        <img src="${esc(plant.image || PLACEHOLDER_IMG)}" alt="${esc(plant.plant_name)}">
        <div class="stack">
          <h1 style="font-family:var(--serif);color:var(--green-900);font-size:2rem">${esc(plant.plant_name)}</h1>
          <div class="row" style="gap:6px">
            ${[plant.care_level && `照護${plant.care_level}`, plant.sunlight_needs, plant.watering_schedule, plant.lifespan].filter(Boolean).map((t) => `<span class="badge">${esc(t)}</span>`).join("")}
          </div>
          <p>${esc(plant.description || "")}</p>
          <a class="btn" href="planner.html?plant=${encodeURIComponent(plant.plant_name)}"><i class="fa-solid fa-seedling"></i> 種植此植物</a>
        </div>
      </section>
      <div class="grid grid-2">${sections}</div>`;
  }
} catch (err) {
  content.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
}
