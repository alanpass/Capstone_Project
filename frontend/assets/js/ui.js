// 共用介面：導覽列、頁尾、提示訊息、HTML 跳脫
import { isConfigured } from "./config.js";
import { currentUser, getProfile, signOutUser } from "./session.js";

const PRIVATE_LINKS = [
  ["home.html", "主控台"],
  ["planner.html", "種植規劃"],
  ["garden.html", "我的花園"],
  ["plants.html", "植物百科"],
  ["sensors.html", "感測器"],
  ["device.html", "自動控制"],
  ["profile.html", "個人資料"],
];
const PUBLIC_LINKS = [
  ["index.html", "首頁"],
  ["plants.html", "植物百科"],
  ["sensors.html", "感測器"],
];

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
  const links = user ? PRIVATE_LINKS : PUBLIC_LINKS;
  nav.innerHTML = links
    .map(([href, label]) => `<a href="${href}" class="${href === page ? "active" : ""}">${label}</a>`)
    .join("");

  if (user) {
    const logout = document.createElement("a");
    logout.href = "#";
    logout.innerHTML = `<i class="fa-solid fa-arrow-right-from-bracket"></i> 登出`;
    logout.addEventListener("click", async (e) => {
      e.preventDefault();
      if (!confirm("確定要登出嗎？")) return;
      await signOutUser();
      location.href = "index.html";
    });
    nav.append(logout);
  } else {
    nav.insertAdjacentHTML("beforeend", `<a href="login.html" class="${page === "login.html" ? "active" : ""}">登入</a>`);
  }
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
