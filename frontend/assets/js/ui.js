// 共用介面：導覽列、頁尾、提示訊息、HTML 跳脫
import { isConfigured } from "./config.js";
import { currentUser, getProfile, signOutUser } from "./session.js";

// 導覽分類：單一連結，或含 items 的群組（桌機為下拉選單、手機為分段清單）
const PRIVATE_NAV = [
  { href: "home.html", label: "主控台", icon: "fa-house" },
  { label: "我的植物", icon: "fa-seedling", items: [
    { href: "garden.html", label: "我的花園", desc: "所有種植專案、天數與生長階段", icon: "fa-leaf" },
    { href: "planner.html", label: "種植規劃・照護指南", desc: "新增植物，查看 AI 每日任務", icon: "fa-wand-magic-sparkles" },
  ] },
  { label: "智慧設備", icon: "fa-microchip", items: [
    { href: "status.html", label: "裝置狀態", desc: "是否在線、風扇／加熱／水泵運轉情形", icon: "fa-tower-broadcast" },
    { href: "sensors.html", label: "環境數據", desc: "溫度、濕度、土壤濕度圖表", icon: "fa-chart-line" },
    { href: "device.html", label: "自動控制設定", desc: "裝置管理哪株植物、門檻值", icon: "fa-sliders" },
  ] },
  { href: "plants.html", label: "植物百科", icon: "fa-book-open", also: ["plant.html"] },
  { label: "帳號", icon: "fa-circle-user", items: [
    { href: "profile.html", label: "個人資料", desc: "姓名與地址（用於天氣）", icon: "fa-id-card" },
    { href: "#logout", label: "登出", icon: "fa-arrow-right-from-bracket" },
  ] },
];
const PUBLIC_NAV = [
  { href: "index.html", label: "首頁", icon: "fa-house" },
  { href: "plants.html", label: "植物百科", icon: "fa-book-open", also: ["plant.html"] },
  { href: "sensors.html", label: "環境數據", icon: "fa-chart-line" },
  { href: "login.html", label: "登入", icon: "fa-right-to-bracket" },
  { href: "register.html", label: "免費註冊", icon: "fa-user-plus", cta: true },
];

const isCurrent = (item, page) => item.href === page || item.also?.includes(page);

function linkHtml(item, page, withDesc = false) {
  return `<a href="${item.href}" class="${isCurrent(item, page) ? "active" : ""} ${item.cta ? "cta" : ""}">
    <i class="fa-solid ${item.icon}"></i><span>${item.label}${withDesc && item.desc ? `<small>${item.desc}</small>` : ""}</span></a>`;
}

function navHtml(entries, page) {
  return entries.map((entry) => {
    if (!entry.items) return linkHtml(entry, page);
    const active = entry.items.some((i) => isCurrent(i, page));
    return `<div class="nav-group ${active ? "active" : ""}">
      <button type="button" class="nav-group-btn" aria-expanded="false"><i class="fa-solid ${entry.icon}"></i><span>${entry.label}</span><i class="fa-solid fa-chevron-down caret"></i></button>
      <div class="nav-menu">${entry.items.map((i) => linkHtml(i, page, true)).join("")}</div>
    </div>`;
  }).join("");
}

/** 同一分類內的頁面頂端顯示分頁標籤，方便在相關功能間切換。 */
function subnavHtml(entries, page) {
  const group = entries.find((e) => e.items?.some((i) => isCurrent(i, page)) && e.items.every((i) => !i.href.startsWith("#")));
  if (!group) return "";
  return `<nav class="subnav" aria-label="${group.label}">${group.items.map((i) =>
    `<a href="${i.href}" class="${isCurrent(i, page) ? "active" : ""}"><i class="fa-solid ${i.icon}"></i> ${i.label}</a>`).join("")}</nav>`;
}

/** 所有使用者輸入、資料庫或 AI 產生的文字，插入 HTML 前都要經過這個函式，避免 XSS。 */
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

/** 插入頁首與頁尾。回傳目前使用者（未登入為 null）。 */
export async function mountShell() {
  const page = location.pathname.split("/").pop() || "index.html";
  const header = document.createElement("header");
  header.className = "site-header";
  header.innerHTML = `
    <div class="inner">
      <a class="brand" href="index.html"><img src="assets/img/logo.png" alt=""><span>園藝智能助理</span></a>
      <button class="nav-toggle" aria-label="開啟選單" aria-expanded="false"><i class="fa-solid fa-bars"></i></button>
      <nav class="nav" aria-label="主要導覽"></nav>
    </div>`;
  document.body.prepend(header);
  if (!isConfigured) {
    header.insertAdjacentHTML("afterend", `<div class="setup-banner" role="status">
      <i class="fa-solid fa-circle-info"></i> 網站尚未連接 Supabase，會員與 AI 功能暫時無法使用；植物百科與感測器示範資料可正常瀏覽。</div>`);
  }

  const footer = document.createElement("footer");
  footer.className = "site-footer";
  footer.innerHTML = `&copy; ${new Date().getFullYear()} 園藝智能助理 · 資訊管理學系畢業專案`;
  document.body.append(footer);

  const toggle = header.querySelector(".nav-toggle");
  const nav = header.querySelector(".nav");
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });

  const user = await currentUser();
  const entries = user ? PRIVATE_NAV : PUBLIC_NAV;
  nav.innerHTML = navHtml(entries, page);
  if (user) header.querySelector(".brand").href = "home.html";
  document.querySelector("main")?.insertAdjacentHTML("afterbegin", subnavHtml(entries, page));

  const closeMenus = (except) => nav.querySelectorAll(".nav-group.open").forEach((g) => {
    if (g === except) return;
    g.classList.remove("open");
    g.querySelector(".nav-group-btn").setAttribute("aria-expanded", "false");
  });
  nav.addEventListener("click", async (e) => {
    const btn = e.target.closest(".nav-group-btn");
    if (btn) {
      const group = btn.parentElement;
      closeMenus(group);
      btn.setAttribute("aria-expanded", String(group.classList.toggle("open")));
      return;
    }
    if (e.target.closest('a[href="#logout"]')) {
      e.preventDefault();
      if (!confirm("確定要登出嗎？")) return;
      await signOutUser();
      location.href = "index.html";
    }
  });
  document.addEventListener("click", (e) => { if (!nav.contains(e.target)) closeMenus(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenus(); });
  return user;
}

/** 在畫面上顯示使用者名稱（主控台問候語等）。 */
export async function displayName(user) {
  try {
    const profile = await getProfile(user);
    return profile.displayName || user.email;
  } catch {
    return user.displayName || user.email;
  }
}

export function toast(message, type = "info") {
  let host = document.querySelector(".toast-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "toast-host";
    host.setAttribute("role", "status");
    document.body.append(host);
  }
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  host.append(el);
  setTimeout(() => el.remove(), 3800);
}

/** 按鈕進入忙碌狀態，回傳還原用的函式。 */
export function busy(button, text = "處理中…") {
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="spinner" style="width:16px;height:16px;border-width:2px"></span> ${esc(text)}`;
  return () => { button.disabled = false; button.innerHTML = original; };
}

export function showAlert(el, message, type = "error") {
  el.className = `alert ${type}`;
  el.textContent = message;
  el.classList.remove("hidden");
}

export const loadingHtml = (text = "載入中…") => `<div class="loading-line"><span class="spinner"></span>${esc(text)}</div>`;

export function emptyHtml(icon, title, extra = "") {
  return `<div class="empty"><i class="fa-solid ${icon}"></i><p><strong>${esc(title)}</strong></p>${extra}</div>`;
}

export const fmt = (value, unit = "") => (value === null || value === undefined ? "—" : `${value}${unit}`);
