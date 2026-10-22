// 把後端回傳的結構化 AI 指南轉成畫面（全部經過 esc，不直接插入 AI 產生的 HTML）
import { esc, fmt } from "./ui.js";

export function renderGuide(data) {
  const g = data.guide || {};
  const tasks = (g.tasks || []).map((t) => `
    <div class="task">
      <strong>${esc(t.title)}</strong>
      ${t.amount ? `<div><span class="badge amount"><i class="fa-solid fa-flask"></i> ${esc(t.amount)}</span></div>` : ""}
      <p>${esc(t.detail)}</p>
      <p class="why"><i class="fa-regular fa-lightbulb"></i> ${esc(t.reason)}</p>
    </div>`).join("");
  const list = (items) => `<ul>${(items || []).map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
  const risks = `<ul>${(g.risks || []).map((r) => `<li><strong>${esc(r.risk)}</strong>：${esc(r.prevention)}</li>`).join("")}</ul>`;

  const env = [];
  if (data.weather) {
    env.push(`<span class="badge"><i class="fa-solid fa-cloud-sun"></i> ${esc(data.weather.city)} ${esc(data.weather.description || "")} ${fmt(data.weather.min_temp)}~${fmt(data.weather.max_temp, "°C")}</span>`);
  }
  if (data.sensor) {
    env.push(`<span class="badge"><i class="fa-solid fa-droplet"></i> 土壤 ${fmt(data.sensor.soil, "%")}</span>`);
    env.push(`<span class="badge"><i class="fa-solid fa-temperature-half"></i> ${fmt(data.sensor.temperature, "°C")}</span>`);
  }

  return `
    <div class="row" style="margin-bottom:12px">
      <h2 style="margin:0"><i class="fa-solid fa-seedling"></i> ${esc(data.plant.plant_name)}・第 ${esc(data.day)} 天</h2>
      <span class="badge">${esc(data.stage)}</span>
      ${data.cached ? `<span class="badge" title="同一天的指南會快取，避免重複耗用 AI 額度"><i class="fa-solid fa-bolt"></i> 已快取</span>` : ""}
    </div>
    ${env.length ? `<div class="row" style="margin-bottom:14px">${env.join("")}</div>` : ""}
    <div class="guide">
      <p class="headline">${esc(g.headline)}</p>
      <section><h3><i class="fa-solid fa-eye"></i> 預期生長狀態</h3><p>${esc(g.expected_state)}</p></section>
      <section><h3><i class="fa-solid fa-list-check"></i> 關鍵任務</h3>${tasks || "<p>這天沒有特別任務。</p>"}</section>
      <div class="grid grid-2">
        <section><h3><i class="fa-solid fa-temperature-half"></i> 環境監控重點</h3>${list(g.environment_tips)}</section>
        <section><h3><i class="fa-solid fa-bug"></i> 風險與預防</h3>${risks}</section>
      </div>
      <section><h3><i class="fa-solid fa-user-graduate"></i> 專家小提醒</h3><p>${esc(g.expert_tip)}</p></section>
    </div>`;
}

export function progressCard(p, actions = "") {
  return `
    <article class="card garden-card" data-id="${esc(p.id)}">
      <div class="top">
        <div><h3>${esc(p.plant_name)}</h3><span class="badge">${esc(p.current_stage)}</span></div>
        <span class="badge">第 ${esc(p.current_day)} / ${esc(p.total_days)} 天</span>
      </div>
      <div class="meta"><span><i class="fa-regular fa-calendar"></i> ${esc(p.start_date)} 開始</span><span>${esc(p.progress)}%</span></div>
      <div class="progress" role="progressbar" aria-label="種植進度" aria-valuenow="${esc(p.progress)}" aria-valuemin="0" aria-valuemax="100">
        <span style="width:${Number(p.progress) || 0}%"></span>
      </div>
      ${actions}
    </article>`;
}
