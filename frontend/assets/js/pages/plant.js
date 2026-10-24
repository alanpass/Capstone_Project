import { categoryOf, loadCatalog, loadDetail } from "../catalog.js";
import { emptyHtml, esc, loadingHtml, mountShell } from "../ui.js";

await mountShell();
const content = document.getElementById("content");
content.innerHTML = loadingHtml();

// 原有 100 種植物的完整照護資料
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

// 新增植物：依摘要資料產生白話的照護重點
const SUN_TIPS = {
  全日照: "每天至少 6 小時直射陽光，適合南向陽台、頂樓或戶外。",
  半日照: "每天 3～6 小時陽光即可，夏季避開午後強烈西曬。",
  明亮散射光: "放在明亮的窗邊但避免陽光直射，光線太暗會徒長或不開花。",
  耐陰: "室內角落、北向窗邊或樹蔭下都能生長，但仍需要一些自然光。",
};
const WATER_TIPS = {
  保持濕潤: "土壤表面一乾就要澆水，不可讓盆土完全乾透，夏天可能每天都要澆。",
  一週兩次: "生長期需水量大，表土乾了就澆透；天熱時次數要增加。",
  每週: "表土 2～3 公分乾了再澆透，盆底不要積水。",
  "每 1～2 週": "盆土大半乾了再澆，冬季生長變慢時減少次數。",
  "每 2～3 週": "等盆土完全乾透再澆，寧乾勿濕，澆太多容易爛根。",
  每月: "非常耐旱，生長期約每月澆一次，休眠期幾乎不用澆水。",
  水生: "根部需泡在水中或保持水位，定期補水、換水以免孳生蚊蟲。",
};
const CARE_TIPS = {
  低: "生命力強，忘記照顧幾天也沒關係，很適合新手。",
  中等: "需要固定澆水與施肥，留意季節變化即可種得好。",
  高: "對環境要求較高（溫度、濕度或土壤），建議有經驗後再挑戰。",
};

function tempTip([min, max]) {
  const tips = [`理想溫度約 ${min}～${max}°C。`];
  if (min >= 18) tips.push("怕冷，寒流來時要移到室內或避風處。");
  else if (min <= 5) tips.push("相當耐寒，台灣平地冬季可安心戶外栽培。");
  if (max <= 24) tips.push("怕熱，台灣平地夏季需遮陰通風，較適合冷涼季節或中高海拔。");
  else if (max >= 32) tips.push("耐熱，台灣夏季也能生長良好。");
  return tips.join("");
}

const kv = (rows) => `<dl class="kv">${rows.filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;
const section = (icon, title, body) => `<section class="card"><h2><i class="fa-solid ${icon}"></i> ${esc(title)}</h2>${body}</section>`;

function summarySections(p) {
  const pet = { safe: "對貓狗無毒，家中有寵物也可以放心種植。", toxic: "對貓狗有毒，請放在寵物碰不到的地方。" }[p.pet] ?? "目前沒有寵物毒性資料，家中有寵物請謹慎擺放。";
  return [
    section("fa-hand-holding-heart", "照護難度", kv([["難度", esc(p.care)], ["說明", esc(CARE_TIPS[p.care])], ["生命週期", esc(p.life)]])),
    section("fa-sun", "日照", kv([["需求", esc(p.sun)], ["怎麼擺", esc(SUN_TIPS[p.sun])]])),
    section("fa-droplet", "澆水", kv([["頻率", esc(p.water)], ["怎麼澆", esc(WATER_TIPS[p.water])]])),
    p.temp ? section("fa-temperature-half", "溫度", kv([["適溫", `${p.temp[0]}～${p.temp[1]}°C`], ["說明", esc(tempTip(p.temp))]])) : "",
    p.prop?.length ? section("fa-seedling", "繁殖方式", `<div class="row" style="gap:6px">${p.prop.map((x) => `<span class="badge">${esc(x)}</span>`).join("")}</div>`) : "",
    section("fa-shield-heart", "安全與用途", kv([["寵物", esc(pet)], ["食用", p.edible ? "可食用（請確認食用部位與烹調方式）" : "以觀賞為主，請勿食用"]])),
  ].join("");
}

function controlHint(p) {
  if (!p.temp) return "";
  return `<section class="card" style="margin-top:20px"><h2><i class="fa-solid fa-microchip"></i> 搭配 ESP32 自動控制</h2>
    <p>建立種植專案後，AI 會依「${esc(p.name)}」的生長階段建議門檻；這株植物的參考適溫是 <strong>${p.temp[0]}～${p.temp[1]}°C</strong>。
    在「自動控制設定」為 ESP32 指定這株植物，超出範圍時就會自動開風扇或加熱。</p>
    <div class="row" style="margin-top:12px"><a class="btn sm" href="planner.html?plant=${encodeURIComponent(p.name)}"><i class="fa-solid fa-seedling"></i> 建立種植專案</a>
      <a class="btn ghost sm" href="device.html"><i class="fa-solid fa-sliders"></i> 自動控制設定</a></div></section>`;
}

function imageCredit(p) {
  if (!p.wiki) return "";
  return `<p class="img-credit">${p.approx ? "示意圖（同類植物）・" : ""}圖片來源：<a href="${esc(p.wiki)}" target="_blank" rel="noopener">維基百科</a></p>`;
}

const id = new URLSearchParams(location.search).get("id");
try {
  const catalog = await loadCatalog();
  const plant = catalog.find((p) => p.id === id);
  if (!plant) {
    content.innerHTML = emptyHtml("fa-circle-question", "找不到這個植物", `<a class="btn" href="plants.html" style="margin-top:12px">回到植物百科</a>`);
  } else {
    document.title = `${plant.name}｜園藝智能助理`;
    const cat = categoryOf(plant.cat);
    const detail = plant.detail ? await loadDetail(plant.id) : null;
    const sections = detail
      ? SECTIONS.map(([icon, title, fields]) => {
          const rows = fields.filter(([, key]) => detail[key]).map(([label, key]) => [label, esc(detail[key])]);
          return rows.length ? section(icon, title, kv(rows)) : "";
        }).join("")
      : summarySections(plant);
    const related = catalog.filter((p) => p.cat === plant.cat && p.id !== plant.id && p.img)
      .sort(() => Math.random() - 0.5).slice(0, 4);
    content.innerHTML = `
      <nav class="crumbs"><a href="plants.html">植物百科</a> › <a href="plants.html?cat=${cat.key}">${esc(cat.name)}</a> › ${esc(plant.name)}</nav>
      <section class="card detail-hero" style="margin-bottom:20px">
        <div>${plant.img ? `<img src="${esc(plant.img)}" alt="${esc(plant.name)}" referrerpolicy="no-referrer">` : `<div class="hero-placeholder"><i class="fa-solid ${cat.icon}"></i></div>`}
          ${imageCredit(plant)}</div>
        <div class="stack">
          <div><span class="badge"><i class="fa-solid ${cat.icon}"></i> ${esc(cat.name)}</span></div>
          <h1 style="font-family:var(--serif);color:var(--green-900);font-size:2rem">${esc(plant.name)}</h1>
          ${plant.sci ? `<p class="sci" style="font-style:italic;color:var(--muted);margin-top:-8px">${esc(plant.sci)}</p>` : ""}
          <div class="row" style="gap:6px">
            ${[plant.care && `照護${plant.care}`, plant.sun, plant.water, plant.life, plant.pet === "safe" && "寵物友善", plant.pet === "toxic" && "對寵物有毒", plant.edible && "可食用", plant.indoor && "室內可種"]
              .filter(Boolean).map((t) => `<span class="badge">${esc(t)}</span>`).join("")}
          </div>
          <p>${esc(detail?.description || plant.desc || "")}</p>
          <a class="btn" href="planner.html?plant=${encodeURIComponent(plant.name)}"><i class="fa-solid fa-seedling"></i> 種植此植物</a>
        </div>
      </section>
      <div class="grid grid-2">${sections}</div>
      ${controlHint(plant)}
      ${related.length ? `<section style="margin-top:28px"><h2 style="font-family:var(--serif);color:var(--green-900);margin-bottom:14px">其他${esc(cat.name)}</h2>
        <div class="grid grid-3 related">${related.map((p) => `<a class="card related-card" href="plant.html?id=${encodeURIComponent(p.id)}">
          <img src="${esc(p.img)}" alt="" loading="lazy" referrerpolicy="no-referrer"><span><strong>${esc(p.name)}</strong><small>${esc(p.care ? `照護${p.care}` : "")}・${esc(p.sun ?? "")}</small></span></a>`).join("")}</div></section>` : ""}`;
  }
} catch (err) {
  content.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
}
