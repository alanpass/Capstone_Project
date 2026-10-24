// 裝置狀態：每塊 ESP32 的連線、繼電器（風扇／加熱／水泵）、最新讀數、套用中的門檻與控制紀錄
import {
  CONNECTION_TEXT, formatUptime, loadDeviceOverview, NODE_NAMES, RELAY_LABELS, signalText, timeAgo,
} from "../devices.js";
import { stageName } from "../growth.js";
import { formatTime } from "../sensors.js";
import { requireUser } from "../session.js";
import { emptyHtml, esc, fmt, loadingHtml, mountShell } from "../ui.js";

const REFRESH_SECONDS = 30;

await mountShell();
await requireUser();
const $ = (id) => document.getElementById(id);

function relaysHtml(d) {
  const relays = d.status?.relays;
  if (!relays) {
    return `<p class="muted-note"><i class="fa-solid fa-circle-info"></i> 這塊裝置還沒有回報繼電器狀態，請把 ESP32 更新到最新版程式。</p>`;
  }
  const stale = d.connection !== "online";
  return `<div class="relays">${Object.entries(relays).map(([key, on]) => {
    const [icon, label] = RELAY_LABELS[key] ?? ["fa-toggle-on", key];
    return `<div class="relay ${on ? "on" : ""} ${stale ? "stale" : ""}">
      <i class="fa-solid ${icon} ${on && key === "fan" ? "fa-spin" : ""}"></i>
      <span>${esc(label)}</span><strong>${on ? "運轉中" : "關閉"}</strong></div>`;
  }).join("")}</div>
  ${stale ? `<p class="muted-note">裝置目前未連線，這是 ${esc(timeAgo(d.last_seen_at))} 的狀態。</p>` : ""}`;
}

function readingHtml(r) {
  if (!r) return `<p class="muted-note">還沒有上傳過數據。</p>`;
  const items = [
    ["fa-temperature-half", "溫度", r.temperature, "°C"],
    ["fa-water", "空氣濕度", r.humidity, "%"],
    ["fa-droplet", "土壤濕度", r.soil, "%"],
  ].filter(([, , v]) => v !== null && v !== undefined);
  return `<div class="stats">${items.map(([icon, label, v, unit]) =>
    `<div class="stat"><div class="label"><i class="fa-solid ${icon}"></i> ${label}</div><div class="value">${fmt(v)}<small>${unit}</small></div></div>`).join("")}</div>
    <p class="muted-note">讀數時間：${esc(formatTime(r.recorded_at))}</p>`;
}

function appliedHtml(a) {
  if (!a) return "";
  const source = a.source === "plan"
    ? `<i class="fa-solid fa-seedling"></i> 依「${esc(a.plantName)}」生長計畫（第 ${esc(a.day)} 天・${esc(stageName(a.stage))}）`
    : a.source === "user" ? `<i class="fa-solid fa-hand"></i> 手動門檻` : "預設門檻";
  return `<div class="applied-box"><div>${source}</div>
    <div>溫度 ${fmt(a.tempMin)}~${fmt(a.tempMax)}°C・空氣濕度 ${fmt(a.humidMin)}~${fmt(a.humidMax)}%・土壤低於 ${fmt(a.soilMin)}% 澆水</div></div>`;
}

function infoHtml(s) {
  if (!s) return "";
  return `<dl class="kv compact">
    <dt>Wi-Fi 訊號</dt><dd>${esc(signalText(s.rssi))}</dd>
    <dt>IP 位址</dt><dd>${esc(s.ip ?? "—")}</dd>
    <dt>已連續運作</dt><dd>${esc(formatUptime(s.uptime))}</dd>
    <dt>可用記憶體</dt><dd>${Number.isFinite(s.mem) ? `${Math.round(s.mem / 1024)} KB` : "—"}</dd>
  </dl>`;
}

const eventsHtml = (events, withDevice = null) => events.length
  ? `<ul class="timeline">${events.map((e) => `<li><time title="${esc(formatTime(e.created_at))}">${esc(timeAgo(e.created_at))}</time>
      <span>${withDevice ? `<strong>${esc(withDevice.get(e.device_id) ?? "已刪除的裝置")}</strong>・` : ""}${esc(e.message)}</span></li>`).join("")}</ul>`
  : `<p class="muted-note">還沒有控制紀錄。繼電器啟動或關閉時會記錄在這裡。</p>`;

function deviceCard(d) {
  const node = NODE_NAMES[d.status?.node];
  return `
    <section class="card device-status ${d.connection}">
      <div class="row" style="margin-bottom:12px">
        <h2 style="margin:0"><i class="fa-solid fa-microchip"></i> ${esc(d.name)}</h2>
        <span class="conn ${d.connection}">${CONNECTION_TEXT[d.connection]}</span>
        ${node ? `<span class="badge">${esc(node)}</span>` : ""}
        <span class="spacer"></span>
        <span class="muted-note" style="margin:0">上次同步：${esc(timeAgo(d.last_seen_at))}</span>
      </div>
      ${relaysHtml(d)}
      <div class="grid grid-2" style="gap:16px;margin-top:16px">
        <div><h3>最新數據</h3>${readingHtml(d.reading)}</div>
        <div><h3>套用中的門檻</h3>${appliedHtml(d.applied)}${infoHtml(d.status)}</div>
      </div>
      <h3 style="margin-top:16px">最近動作</h3>
      ${eventsHtml(d.events.slice(0, 5))}
    </section>`;
}

async function load() {
  try {
    const { devices, events } = await loadDeviceOverview();
    if (!devices.length) {
      $("summaryCard").classList.add("hidden");
      $("devices").innerHTML = `<section class="card">${emptyHtml("fa-microchip", "還沒有登記裝置",
        `<a class="btn" href="device.html" style="margin-top:12px"><i class="fa-solid fa-plus"></i> 到自動控制新增裝置</a>`)}</section>`;
      $("events").innerHTML = "";
      return;
    }
    $("summaryCard").classList.remove("hidden");
    const online = devices.filter((d) => d.connection === "online").length;
    const running = devices.flatMap((d) => (d.connection === "online" ? Object.entries(d.status?.relays ?? {}) : []))
      .filter(([, on]) => on).map(([key]) => RELAY_LABELS[key]?.[1] ?? key);
    $("summary").innerHTML = `
      <div class="stat"><div class="label"><i class="fa-solid fa-microchip"></i> 在線裝置</div><div class="value">${online}<small> / ${devices.length}</small></div></div>
      <div class="stat"><div class="label"><i class="fa-solid fa-power-off"></i> 運轉中</div><div class="value" style="font-size:1.2rem">${running.length ? esc(running.join("、")) : "沒有"}</div></div>
      <div class="stat"><div class="label"><i class="fa-solid fa-clock-rotate-left"></i> 最近一次動作</div><div class="value" style="font-size:1.1rem">${events[0] ? esc(timeAgo(events[0].created_at)) : "—"}</div></div>`;
    $("devices").innerHTML = devices.map(deviceCard).join("");
    $("events").innerHTML = eventsHtml(events, new Map(devices.map((d) => [d.id, d.name])));
    $("updated").textContent = `更新於 ${new Date().toLocaleTimeString("zh-TW", { hour12: false })}・每 ${REFRESH_SECONDS} 秒自動更新`;
  } catch (err) {
    $("devices").innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
  }
}

$("devices").innerHTML = loadingHtml();
$("refresh").addEventListener("click", load);
await load();
setInterval(() => document.visibilityState === "visible" && load(), REFRESH_SECONDS * 1000);
