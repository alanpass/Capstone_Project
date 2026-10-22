// 感測數據折線圖（Chart.js，透過 <script> 從 cdnjs 載入為全域 Chart）
const SERIES = [
  ["soil", "土壤濕度", "%", "#6d8b72"],
  ["temperature", "空氣溫度", "°C", "#c47a3d"],
  ["humidity", "空氣濕度", "%", "#4f7fa8"],
];

const charts = new Map();

export const CHART_SERIES = SERIES;

/** readings 由新到舊；畫圖時反轉成時間順序。每個欄位畫在自己的 canvas。 */
export function renderCharts(readings) {
  const ordered = readings.slice().reverse();
  for (const [key, label, unit, color] of SERIES) {
    const canvas = document.getElementById(`chart-${key}`);
    if (!canvas || !window.Chart) continue;
    const points = ordered.filter((r) => r[key] !== null).map((r) => ({ x: new Date(r.at).getTime(), y: r[key] }));
    const empty = canvas.parentElement.querySelector(".chart-empty");
    if (empty) empty.classList.toggle("hidden", points.length > 0);

    charts.get(key)?.destroy();
    charts.set(key, new window.Chart(canvas, {
      type: "line",
      data: {
        datasets: [{
          label: `${label}（${unit}）`, data: points, borderColor: color, backgroundColor: `${color}22`,
          fill: true, tension: 0.3, pointRadius: 0, pointHitRadius: 8, borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => new Date(items[0].parsed.x).toLocaleString("zh-TW", { hour12: false }),
              label: (item) => ` ${item.parsed.y} ${unit}`,
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            ticks: {
              maxTicksLimit: 5,
              callback: (v) => new Date(v).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false }),
            },
            grid: { display: false },
          },
          y: { ticks: { callback: (v) => `${v}${unit}` }, grid: { color: "#eceee8" } },
        },
      },
    }));
  }
}
