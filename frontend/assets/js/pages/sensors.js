import { api } from "../api.js";
import { THINGSPEAK_CHANNEL_ID } from "../config.js";
import { emptyHtml, esc, fmt, loadingHtml, mountShell } from "../ui.js";

await mountShell();
const $ = (id) => document.getElementById(id);

const CHARTS = [
  [1, "土壤濕度", "fa-droplet"],
  [2, "空氣溫度", "fa-temperature-half"],
  [3, "空氣濕度", "fa-water"],
];
$("charts").innerHTML = CHARTS.map(([field, title, icon]) => `
  <section class="card"><h2><i class="fa-solid ${icon}"></i> ${title}</h2>
    <iframe class="chart-frame" title="${title}圖表" loading="lazy"
      src="https://thingspeak.com/channels/${THINGSPEAK_CHANNEL_ID}/charts/${field}?bgcolor=%23ffffff&color=%234A6352&dynamic=true&results=60&type=line&update=15"></iframe>
  </section>`).join("");

async function load() {
  $("latest").innerHTML = loadingHtml();
  $("table").innerHTML = "";
  try {
    const { latest, readings } = await api("/api/sensors?results=30", { auth: false });
    $("latest").innerHTML = latest
      ? `<div class="stats">
          <div class="stat"><div class="label"><i class="fa-solid fa-droplet"></i> 土壤濕度</div><div class="value">${fmt(latest.soil)}<small>%</small></div></div>
          <div class="stat"><div class="label"><i class="fa-solid fa-temperature-half"></i> 空氣溫度</div><div class="value">${fmt(latest.temperature)}<small>°C</small></div></div>
          <div class="stat"><div class="label"><i class="fa-solid fa-water"></i> 空氣濕度</div><div class="value">${fmt(latest.humidity)}<small>%</small></div></div>
          <div class="stat"><div class="label"><i class="fa-regular fa-clock"></i> 更新時間</div><div class="value" style="font-size:1rem">${esc(latest.time)}</div></div>
        </div>`
      : emptyHtml("fa-plug-circle-xmark", "目前沒有感測器資料", "<p>請確認 ESP32 已開機並連上 Wi-Fi。</p>");
    $("table").innerHTML = readings.length
      ? `<table class="data"><thead><tr><th>時間</th><th>土壤濕度</th><th>空氣溫度</th><th>空氣濕度</th></tr></thead><tbody>
          ${readings.map((r) => `<tr><td>${esc(r.time)}</td><td>${fmt(r.soil, "%")}</td><td>${fmt(r.temperature, "°C")}</td><td>${fmt(r.humidity, "%")}</td></tr>`).join("")}
        </tbody></table>`
      : emptyHtml("fa-table", "沒有紀錄");
  } catch (err) {
    $("latest").innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
  }
}

$("refresh").addEventListener("click", load);
load();
