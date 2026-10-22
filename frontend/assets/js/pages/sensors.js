import { renderCharts } from "../charts.js";
import { formatTime, loadSensors } from "../sensors.js";
import { emptyHtml, esc, fmt, loadingHtml, mountShell, showAlert } from "../ui.js";

const user = await mountShell();
const $ = (id) => document.getElementById(id);

async function load(showSpinner = true) {
  if (showSpinner) $("latest").innerHTML = loadingHtml();
  try {
    const { source, latest, readings } = await loadSensors(user, 120);
    if (source === "demo") {
      showAlert($("source"), user
        ? "你的裝置還沒有上傳資料，目前顯示示範資料（ThingSpeak 公開頻道）。到「個人資料」取得裝置權杖並設定 ESP32 後，這裡就會顯示你自己的數據。"
        : "目前顯示示範資料（ThingSpeak 公開頻道）。登入並連接自己的 ESP32 後，就會顯示你自己的數據。", "warn");
    } else {
      $("source").classList.add("hidden");
    }
    $("latest").innerHTML = latest
      ? `<div class="stats">
          <div class="stat"><div class="label"><i class="fa-solid fa-droplet"></i> 土壤濕度</div><div class="value">${fmt(latest.soil)}<small>%</small></div></div>
          <div class="stat"><div class="label"><i class="fa-solid fa-temperature-half"></i> 空氣溫度</div><div class="value">${fmt(latest.temperature)}<small>°C</small></div></div>
          <div class="stat"><div class="label"><i class="fa-solid fa-water"></i> 空氣濕度</div><div class="value">${fmt(latest.humidity)}<small>%</small></div></div>
          <div class="stat"><div class="label"><i class="fa-regular fa-clock"></i> 更新時間</div><div class="value" style="font-size:1rem">${esc(formatTime(latest.at))}</div></div>
        </div>`
      : emptyHtml("fa-plug-circle-xmark", "目前沒有感測器資料", "<p>請確認 ESP32 已開機並連上 Wi-Fi。</p>");
    renderCharts(readings);
    $("table").innerHTML = readings.length
      ? `<table class="data"><thead><tr><th>時間</th><th>土壤濕度</th><th>空氣溫度</th><th>空氣濕度</th></tr></thead><tbody>
          ${readings.slice(0, 30).map((r) => `<tr><td>${esc(formatTime(r.at))}</td><td>${fmt(r.soil, "%")}</td><td>${fmt(r.temperature, "°C")}</td><td>${fmt(r.humidity, "%")}</td></tr>`).join("")}
        </tbody></table>`
      : emptyHtml("fa-table", "沒有紀錄");
  } catch (err) {
    $("latest").innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
  }
}

$("refresh").addEventListener("click", () => load());
load();
setInterval(() => document.visibilityState === "visible" && load(false), 60_000);
