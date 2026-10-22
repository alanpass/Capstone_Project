import { api } from "../api.js";
import { progressCard } from "../guide.js";
import { requireUser } from "../session.js";
import { displayName, emptyHtml, esc, fmt, loadingHtml, mountShell } from "../ui.js";

await mountShell();
const user = await requireUser();

const $ = (id) => document.getElementById(id);
const hour = new Date().getHours();
const hello = hour < 11 ? "早安" : hour < 18 ? "午安" : "晚安";
$("greeting").textContent = `${hello}，${await displayName(user)}`;
$("today").textContent = new Date().toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric", weekday: "long" });

["weather", "sensor", "plants"].forEach((id) => ($(id).innerHTML = loadingHtml()));

try {
  const data = await api("/api/dashboard");
  const w = data.weather;
  $("weather").innerHTML = w
    ? `<div class="stats">
        <div class="stat"><div class="label"><i class="fa-solid fa-location-dot"></i> 縣市</div><div class="value" style="font-size:1.2rem">${esc(w.city)}</div></div>
        <div class="stat"><div class="label"><i class="fa-solid fa-cloud"></i> 天氣</div><div class="value" style="font-size:1.1rem">${esc(w.description || "—")}</div></div>
        <div class="stat"><div class="label"><i class="fa-solid fa-temperature-half"></i> 溫度</div><div class="value">${fmt(w.min_temp)}~${fmt(w.max_temp)}<small>°C</small></div></div>
        <div class="stat"><div class="label"><i class="fa-solid fa-umbrella"></i> 降雨</div><div class="value">${fmt(w.rain_chance)}<small>%</small></div></div>
      </div>`
    : emptyHtml("fa-cloud", "暫時取不到天氣資料", `<p>請確認 <a href="profile.html">個人資料</a> 中的地址包含縣市名稱。</p>`);

  const s = data.sensor;
  $("sensor").innerHTML = s
    ? `<div class="stats">
        <div class="stat"><div class="label"><i class="fa-solid fa-droplet"></i> 土壤濕度</div><div class="value">${fmt(s.soil)}<small>%</small></div></div>
        <div class="stat"><div class="label"><i class="fa-solid fa-temperature-half"></i> 空氣溫度</div><div class="value">${fmt(s.temperature)}<small>°C</small></div></div>
        <div class="stat"><div class="label"><i class="fa-solid fa-water"></i> 空氣濕度</div><div class="value">${fmt(s.humidity)}<small>%</small></div></div>
      </div><p style="color:var(--muted);font-size:.85rem;margin-top:10px">更新時間：${esc(s.time)}・<a href="sensors.html">查看圖表</a></p>`
    : emptyHtml("fa-plug-circle-xmark", "目前沒有感測器資料", "<p>請確認 ESP32 已開機並連上 Wi-Fi。</p>");

  $("plants").innerHTML = data.plants.length
    ? data.plants.slice(0, 6).map((p) => progressCard(p, `
        <div class="row" style="margin-top:14px"><a class="btn sm" href="planner.html?id=${encodeURIComponent(p.id)}"><i class="fa-solid fa-list-check"></i> 今日指南</a></div>`)).join("")
    : `<div style="grid-column:1/-1">${emptyHtml("fa-seedling", "花園還是空的", `<a class="btn" href="planner.html" style="margin-top:12px">建立第一個種植專案</a>`)}</div>`;
} catch (err) {
  const msg = `<div class="alert error">${esc(err.message)}</div>`;
  ["weather", "sensor"].forEach((id) => ($(id).innerHTML = msg));
  $("plants").innerHTML = `<div style="grid-column:1/-1">${msg}</div>`;
}
