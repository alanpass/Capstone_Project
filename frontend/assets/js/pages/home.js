import { listPlants } from "../garden.js";
import { progressCard } from "../guide.js";
import { formatTime, loadSensors } from "../sensors.js";
import { getProfile, requireUser } from "../session.js";
import { emptyHtml, esc, fmt, loadingHtml, mountShell } from "../ui.js";
import { forecast } from "../weather.js";

await mountShell();
const user = await requireUser();

const $ = (id) => document.getElementById(id);
["weather", "sensor", "plants"].forEach((id) => ($(id).innerHTML = loadingHtml()));
$("today").textContent = new Date().toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric", weekday: "long" });

const profile = await getProfile(user).catch(() => ({ displayName: "", address: "" }));
const hour = new Date().getHours();
$("greeting").textContent = `${hour < 11 ? "早安" : hour < 18 ? "午安" : "晚安"}，${profile.displayName || user.email}`;

// 三個區塊各自載入，任何一個失敗都不影響其他區塊
forecast(profile.address).then((w) => {
  $("weather").innerHTML = w
    ? `<div class="stats">
        <div class="stat"><div class="label"><i class="fa-solid fa-location-dot"></i> 縣市</div><div class="value" style="font-size:1.2rem">${esc(w.city)}</div></div>
        <div class="stat"><div class="label"><i class="fa-solid fa-cloud"></i> 天氣</div><div class="value" style="font-size:1.1rem">${esc(w.description)}</div></div>
        <div class="stat"><div class="label"><i class="fa-solid fa-temperature-half"></i> 溫度</div><div class="value">${fmt(w.min_temp)}~${fmt(w.max_temp)}<small>°C</small></div></div>
        <div class="stat"><div class="label"><i class="fa-solid fa-umbrella"></i> 降雨</div><div class="value">${fmt(w.rain_chance)}<small>%</small></div></div>
      </div>
      ${profile.address ? "" : `<p style="color:var(--muted);font-size:.85rem;margin-top:10px">尚未設定地址，暫以高雄市顯示・<a href="profile.html">設定地址</a></p>`}`
    : emptyHtml("fa-cloud", "暫時取不到天氣資料");
});

loadSensors(user, 20).then(({ source, latest: s }) => {
  $("sensor").innerHTML = s
    ? `<div class="stats">
        <div class="stat"><div class="label"><i class="fa-solid fa-droplet"></i> 土壤濕度</div><div class="value">${fmt(s.soil)}<small>%</small></div></div>
        <div class="stat"><div class="label"><i class="fa-solid fa-temperature-half"></i> 空氣溫度</div><div class="value">${fmt(s.temperature)}<small>°C</small></div></div>
        <div class="stat"><div class="label"><i class="fa-solid fa-water"></i> 空氣濕度</div><div class="value">${fmt(s.humidity)}<small>%</small></div></div>
      </div><p style="color:var(--muted);font-size:.85rem;margin-top:10px">
        ${source === "demo" ? "示範資料・" : ""}更新時間：${esc(formatTime(s.at))}・<a href="sensors.html">查看圖表</a></p>`
    : emptyHtml("fa-plug-circle-xmark", "目前沒有感測器資料", "<p>請確認 ESP32 已開機並連上 Wi-Fi。</p>");
}).catch((err) => ($("sensor").innerHTML = `<div class="alert error">${esc(err.message)}</div>`));

listPlants().then((plants) => {
  $("plants").innerHTML = plants.length
    ? plants.slice(0, 6).map((p) => progressCard(p, `
        <div class="row" style="margin-top:14px"><a class="btn sm" href="planner.html?id=${encodeURIComponent(p.id)}"><i class="fa-solid fa-list-check"></i> 今日指南</a></div>`)).join("")
    : `<div style="grid-column:1/-1">${emptyHtml("fa-seedling", "花園還是空的", `<a class="btn" href="planner.html" style="margin-top:12px">建立第一個種植專案</a>`)}</div>`;
}).catch((err) => ($("plants").innerHTML = `<div class="alert error" style="grid-column:1/-1">${esc(err.message)}</div>`));
