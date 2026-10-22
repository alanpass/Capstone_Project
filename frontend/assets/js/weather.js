// 天氣預報：Open-Meteo（免金鑰、支援瀏覽器直接呼叫），依地址中的縣市取座標
const CITIES = {
  臺北市: [25.04, 121.56], 新北市: [25.01, 121.46], 桃園市: [24.99, 121.30], 臺中市: [24.15, 120.67],
  臺南市: [22.99, 120.21], 高雄市: [22.63, 120.30], 基隆市: [25.13, 121.74], 新竹市: [24.80, 120.97],
  嘉義市: [23.48, 120.45], 新竹縣: [24.84, 121.01], 苗栗縣: [24.56, 120.82], 彰化縣: [24.08, 120.54],
  南投縣: [23.91, 120.69], 雲林縣: [23.71, 120.43], 嘉義縣: [23.46, 120.26], 屏東縣: [22.67, 120.49],
  宜蘭縣: [24.70, 121.74], 花蓮縣: [23.99, 121.60], 臺東縣: [22.76, 121.14], 澎湖縣: [23.57, 119.58],
  金門縣: [24.43, 118.32], 連江縣: [26.16, 119.95],
};
const DEFAULT_CITY = "高雄市";

// WMO 天氣代碼 → 中文描述
const WMO = [
  [[0], "晴朗"], [[1], "大致晴朗"], [[2], "多雲"], [[3], "陰天"], [[45, 48], "有霧"],
  [[51, 53, 55, 56, 57], "毛毛雨"], [[61, 63, 66, 80, 81], "陣雨"], [[65, 67, 82], "大雨"],
  [[71, 73, 75, 77, 85, 86], "下雪"], [[95, 96, 99], "雷雨"],
];

export function cityFromAddress(address) {
  const normalized = String(address || "").replaceAll("台", "臺");
  return Object.keys(CITIES).find((city) => normalized.includes(city)) || DEFAULT_CITY;
}

/** 取今日預報；失敗時回傳 null（天氣只是輔助資訊，不讓整個頁面失敗）。 */
export async function forecast(address) {
  const city = cityFromAddress(address);
  const [lat, lon] = CITIES[city];
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: lat, longitude: lon, timezone: "Asia/Taipei", forecast_days: 1,
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
  });
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = (await res.json()).daily;
    const code = d.weather_code[0];
    return {
      city,
      description: WMO.find(([codes]) => codes.includes(code))?.[1] ?? "—",
      min_temp: d.temperature_2m_min[0],
      max_temp: d.temperature_2m_max[0],
      rain_chance: d.precipitation_probability_max[0],
    };
  } catch {
    return null;
  }
}
