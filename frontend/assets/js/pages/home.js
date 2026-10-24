import { CONNECTION_TEXT, loadDeviceOverview, RELAY_LABELS, timeAgo } from "../devices.js";
import { listPlants } from "../garden.js";
import { progressCard } from "../guide.js";
import { formatTime, loadSensors } from "../sensors.js";
import { getProfile, requireUser } from "../session.js";
import { emptyHtml, esc, fmt, loadingHtml, mountShell } from "../ui.js";
import { forecast } from "../weather.js";

await mountShell();
const user = await requireUser();

const $ = (id) => document.getElementById(id);
["weather", "sensor", "devices", "plants"].forEach((id) => ($(id).innerHTML = loadingHtml()));
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
        <div class="stat"><div class="label"><i class="fa-solid fa-temperature-half"></i> 溫度</div><div class="value">${fmt(s.temperature)}<small>°C</small></div></div>
        <div class="stat"><div class="label"><i class="fa-solid fa-water"></i> 濕度</div><div class="value">${fmt(s.humidity)}<small>%</small></div></div>
        <div class="stat"><div class="label"><i class="fa-solid fa-droplet"></i> 土壤</div><div class="value">${fmt(s.soil)}<small>%</small></div></div>
      </div><p style="color:var(--muted);font-size:.85rem;margin-top:10px">
        ${source === "demo" ? "示範資料・" : ""}更新時間：${esc(formatTime(s.at))}・<a href="sensors.html">查看圖表</a></p>`
    : emptyHtml("fa-plug-circle-xmark", "目前沒有感測器資料", "<p>請確認 ESP32 已開機並連上 Wi-Fi。</p>");
}).catch((err) => ($("sensor").innerHTML = `<div class="alert error">${esc(err.message)}</div>`));

// ---- 裝置摘要 ----
const devicesPromise = loadDeviceOverview({ eventLimit: 1 }).then(({ devices, events }) => {
  $("devices").innerHTML = devices.length
    ? `<ul class="device-mini">${devices.map((d) => {
        const running = d.connection === "online"
          ? Object.entries(d.status?.relays ?? {}).filter(([, on]) => on).map(([k]) => RELAY_LABELS[k]?.[1] ?? k) : [];
        return `<li><span class="conn ${d.connection}">${CONNECTION_TEXT[d.connection]}</span><strong>${esc(d.name)}</strong>
          <small>${running.length ? `${esc(running.join("、"))}運轉中` : d.applied?.plantName ? `管理${esc(d.applied.plantName)}` : "使用手動門檻"}</small></li>`;
      }).join("")}</ul>
      <p style="color:var(--muted);font-size:.85rem;margin-top:10px">${events[0] ? `最近動作：${esc(timeAgo(events[0].created_at))}・` : ""}<a href="status.html">查看裝置狀態</a></p>`
    : emptyHtml("fa-microchip", "還沒有裝置", `<a class="btn sm" href="device.html" style="margin-top:10px">新增 ESP32</a>`);
  return devices;
}).catch((err) => {
  $("devices").innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
  return null;
});

// ---- 開始使用：依完成狀況顯示下一步 ----
async function onboarding(plantsPromise) {
  const [plants, devices] = await Promise.all([plantsPromise, devicesPromise]);
  if (!plants || !devices) return;
  const steps = [
    [Boolean(profile.address), "設定居住地址", "讓天氣預報與 AI 建議更準確", "profile.html"],
    [plants.length > 0, "建立第一個種植專案", "輸入想種的植物，AI 規劃生長週期", "planner.html"],
    [devices.length > 0, "登記 ESP32 裝置", "取得權杖並填到 config.py", "device.html"],
    [devices.some((d) => d.plant_id), "指定裝置管理哪株植物", "門檻會隨生長階段自動切換", "device.html"],
    [devices.some((d) => d.connection === "online"), "讓裝置上線", "ESP32 接上電源與 Wi-Fi 即可", "status.html"],
  ];
  const done = steps.filter(([ok]) => ok).length;
  if (done === steps.length) return;
  const next = steps.findIndex(([ok]) => !ok);
  $("onboarding").innerHTML = `
    <div class="row" style="margin-bottom:12px"><h2 style="margin:0"><i class="fa-solid fa-flag-checkered"></i> 開始使用</h2>
      <span class="badge">${done} / ${steps.length} 完成</span></div>
    <div class="progress" style="margin-bottom:14px"><span style="width:${(done / steps.length) * 100}%"></span></div>
    <ol class="steps">${steps.map(([ok, title, desc, href], i) => `
      <li class="${ok ? "done" : i === next ? "next" : ""}"><a href="${href}">
        <i class="fa-solid ${ok ? "fa-circle-check" : "fa-circle"}"></i>
        <span><strong>${title}</strong><small>${desc}</small></span>
        ${i === next ? `<span class="btn sm">前往</span>` : ""}</a></li>`).join("")}</ol>`;
  $("onboarding").classList.remove("hidden");
}

const plantsPromise = listPlants().then((plants) => {
  $("plants").innerHTML = plants.length
    ? plants.slice(0, 6).map((p) => progressCard(p, `
        <div class="row" style="margin-top:14px"><a class="btn sm" href="planner.html?id=${encodeURIComponent(p.id)}"><i class="fa-solid fa-list-check"></i> 今日指南</a></div>`)).join("")
    : `<div style="grid-column:1/-1">${emptyHtml("fa-seedling", "花園還是空的", `<a class="btn" href="planner.html" style="margin-top:12px">建立第一個種植專案</a>`)}</div>`;
  return plants;
}).catch((err) => {
  $("plants").innerHTML = `<div class="alert error" style="grid-column:1/-1">${esc(err.message)}</div>`;
  return null;
});
onboarding(plantsPromise);
