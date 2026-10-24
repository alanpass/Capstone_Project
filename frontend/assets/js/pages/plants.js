import { CATEGORIES, categoryOf, loadCatalog, QUICK_FILTERS } from "../catalog.js";
import { emptyHtml, esc, loadingHtml, mountShell } from "../ui.js";

const PAGE_SIZE = 30;

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

// 篩選條件保留在網址上，方便分享與返回
const params = new URLSearchParams(location.search);
const state = {
  q: params.get("q") ?? "",
  cat: params.get("cat") ?? "",
  quick: new Set((params.get("f") ?? "").split(",").filter(Boolean)),
  sun: params.get("sun") ?? "",
  sort: params.get("sort") ?? "default",
  shown: PAGE_SIZE,
};
$("q").value = state.q;
$("sun").value = state.sun;
$("sort").value = state.sort;

const count = (cat) => all.filter((p) => p.cat === cat).length;
$("cats").innerHTML = [`<button class="cat-chip" data-cat=""><i class="fa-solid fa-border-all"></i> 全部 <small>${all.length}</small></button>`]
  .concat(CATEGORIES.map((c) => `<button class="cat-chip" data-cat="${c.key}" title="${esc(c.desc)}"><i class="fa-solid ${c.icon}"></i> ${esc(c.name)} <small>${count(c.key)}</small></button>`))
  .join("");
$("quick").innerHTML = QUICK_FILTERS.map((f) => `<button class="quick-chip" data-quick="${f.key}" aria-pressed="false"><i class="fa-solid ${f.icon}"></i> ${f.name}</button>`).join("");

const badge = (icon, text) => (text ? `<span class="badge"><i class="fa-solid ${icon}"></i> ${esc(text)}</span>` : "");

function card(p) {
  const href = `plant.html?id=${encodeURIComponent(p.id)}`;
  const cat = categoryOf(p.cat);
  return `
    <article class="card plant-card">
      <a class="thumb ${p.img ? "" : "no-img"}" href="${href}">
        ${p.img ? `<img src="${esc(p.img)}" alt="${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer">` : `<i class="fa-solid ${cat.icon}"></i>`}
        <span class="cat-tag"><i class="fa-solid ${cat.icon}"></i> ${esc(cat.name)}</span>
      </a>
      <div class="body">
        <h3><a href="${href}">${esc(p.name)}</a></h3>
        ${p.sci ? `<p class="sci">${esc(p.sci)}</p>` : ""}
        <div class="row" style="gap:6px">
          ${badge("fa-hand-holding-droplet", p.care && `照護${p.care}`)}
          ${badge("fa-sun", p.sun)}
          ${badge("fa-droplet", p.water)}
          ${p.pet === "safe" ? badge("fa-paw", "寵物友善") : ""}
        </div>
        <p class="desc">${esc(p.desc || "暫無描述")}</p>
        <div class="actions">
          <a class="btn sm secondary" href="${href}">照護重點</a>
          <a class="btn sm" href="planner.html?plant=${encodeURIComponent(p.name)}">種植 <i class="fa-solid fa-arrow-right"></i></a>
        </div>
      </div>
    </article>`;
}

function filtered() {
  const q = state.q.trim().toLowerCase();
  const quick = QUICK_FILTERS.filter((f) => state.quick.has(f.key));
  let rows = all.filter((p) =>
    (!state.cat || p.cat === state.cat) &&
    (!state.sun || p.sun === state.sun) &&
    quick.every((f) => f.test(p)) &&
    (!q || [p.name, p.sci, p.desc, categoryOf(p.cat).name].join(" ").toLowerCase().includes(q)));
  if (state.sort === "name") rows = rows.slice().sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
  if (state.sort === "easy") {
    const rank = { 低: 0, 中等: 1, 高: 2 };
    rows = rows.slice().sort((a, b) => (rank[a.care] ?? 1) - (rank[b.care] ?? 1));
  }
  return rows;
}

function render() {
  const rows = filtered();
  document.querySelectorAll(".cat-chip").forEach((b) => b.classList.toggle("active", b.dataset.cat === state.cat));
  document.querySelectorAll(".quick-chip").forEach((b) => {
    const on = state.quick.has(b.dataset.quick);
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
  const cat = state.cat && categoryOf(state.cat);
  $("catDesc").innerHTML = cat ? `<i class="fa-solid ${cat.icon}"></i> <strong>${esc(cat.name)}</strong>：${esc(cat.desc)}` : "";

  const next = new URLSearchParams();
  if (state.q) next.set("q", state.q);
  if (state.cat) next.set("cat", state.cat);
  if (state.quick.size) next.set("f", [...state.quick].join(","));
  if (state.sun) next.set("sun", state.sun);
  if (state.sort !== "default") next.set("sort", state.sort);
  history.replaceState(null, "", next.toString() ? `?${next}` : location.pathname);

  const filters = state.q || state.cat || state.quick.size || state.sun;
  $("shown").innerHTML = `找到 <strong>${rows.length}</strong> 種${filters ? `・<button class="link-btn" id="clear">清除篩選</button>` : ""}`;
  $("clear")?.addEventListener("click", () => {
    Object.assign(state, { q: "", cat: "", sun: "", shown: PAGE_SIZE });
    state.quick.clear();
    $("q").value = "";
    $("sun").value = "";
    render();
  });

  list.innerHTML = rows.length
    ? rows.slice(0, state.shown).map(card).join("")
    : `<div style="grid-column:1/-1">${emptyHtml("fa-leaf", "沒有找到符合的植物", "<p>換個關鍵字，或減少一些篩選條件試試。</p>")}</div>`;
  // 圖片載入失敗時改顯示分類圖示
  list.querySelectorAll(".thumb img").forEach((img) => img.addEventListener("error", () => {
    const thumb = img.parentElement;
    thumb.classList.add("no-img");
    img.replaceWith(Object.assign(document.createElement("i"), { className: `fa-solid ${categoryOf(all.find((p) => p.name === img.alt)?.cat).icon}` }));
  }, { once: true }));
  $("more").classList.toggle("hidden", rows.length <= state.shown);
  $("more").textContent = `顯示更多（還有 ${rows.length - state.shown} 種）`;
}

const reset = () => { state.shown = PAGE_SIZE; render(); };
let timer;
$("q").addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(() => { state.q = $("q").value; reset(); }, 150);
});
$("sun").addEventListener("change", () => { state.sun = $("sun").value; reset(); });
$("sort").addEventListener("change", () => { state.sort = $("sort").value; reset(); });
$("cats").addEventListener("click", (e) => {
  const chip = e.target.closest(".cat-chip");
  if (!chip) return;
  state.cat = chip.dataset.cat;
  reset();
});
$("quick").addEventListener("click", (e) => {
  const chip = e.target.closest(".quick-chip");
  if (!chip) return;
  const key = chip.dataset.quick;
  if (state.quick.has(key)) state.quick.delete(key);
  else state.quick.add(key);
  reset();
});
$("more").addEventListener("click", () => { state.shown += PAGE_SIZE; render(); });
if (all.length) render();
