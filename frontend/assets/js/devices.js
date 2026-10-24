// ESP32 裝置總覽：連線狀態、繼電器、最新讀數、目前套用的門檻與控制紀錄（裝置狀態頁與主控台共用）
import { supabase, unwrap } from "./supabase.js";

const ONLINE_MINUTES = 3;   // 每分鐘同步一次，3 分鐘內有同步視為在線
const OFFLINE_MINUTES = 10; // 超過 10 分鐘視為離線，中間為連線不穩

export const NODE_NAMES = { climate: "溫控節點", soil: "土壤節點" };
export const RELAY_LABELS = {
  fan: ["fa-fan", "風扇"],
  heater: ["fa-fire", "加熱"],
  pump: ["fa-faucet-drip", "水泵"],
};

/** 讀取使用者所有裝置的狀態總覽。events 依時間由新到舊。 */
export async function loadDeviceOverview({ eventLimit = 30 } = {}) {
  const [devices, applied, events] = await Promise.all([
    supabase.from("devices").select("id, name, plant_id, last_seen_at, status, created_at").order("created_at").then(unwrap),
    supabase.rpc("my_device_thresholds").then(unwrap),
    supabase.from("device_events").select("id, device_id, created_at, message")
      .order("created_at", { ascending: false }).limit(eventLimit).then(unwrap),
  ]);
  const appliedById = new Map(applied.map((a) => [a.deviceId, a]));
  // 每塊裝置各取最新一筆讀數（最多 10 塊，平行查詢）
  const latest = await Promise.all(devices.map((d) =>
    supabase.from("sensor_readings").select("recorded_at, soil, temperature, humidity")
      .eq("device_id", d.id).order("recorded_at", { ascending: false }).limit(1).maybeSingle().then(unwrap)));
  return {
    devices: devices.map((d, i) => ({
      ...d,
      applied: appliedById.get(d.id) ?? null,
      reading: latest[i],
      events: events.filter((e) => e.device_id === d.id),
      connection: connectionOf(d.last_seen_at),
    })),
    events,
  };
}

/** online／unstable／offline／never */
export function connectionOf(iso, now = Date.now()) {
  if (!iso) return "never";
  const minutes = (now - new Date(iso)) / 60000;
  if (minutes <= ONLINE_MINUTES) return "online";
  return minutes <= OFFLINE_MINUTES ? "unstable" : "offline";
}

export const CONNECTION_TEXT = { online: "在線", unstable: "連線不穩", offline: "離線", never: "尚未連線" };

/** 「3 分鐘前」這類相對時間。 */
export function timeAgo(iso, now = Date.now()) {
  if (!iso) return "—";
  const seconds = Math.max(0, Math.round((now - new Date(iso)) / 1000));
  if (seconds < 60) return "剛剛";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小時前`;
  return new Date(iso).toLocaleDateString("zh-TW");
}

/** 運作時間：秒 → 「2 天 3 小時」 */
export function formatUptime(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d} 天 ${h} 小時`;
  if (h) return `${h} 小時 ${m} 分`;
  return `${m} 分鐘`;
}

/** Wi-Fi 訊號強度（dBm）→ 文字 */
export function signalText(rssi) {
  if (!Number.isFinite(rssi)) return "—";
  const level = rssi >= -60 ? "強" : rssi >= -70 ? "良好" : rssi >= -80 ? "弱" : "很弱";
  return `${level}（${rssi} dBm）`;
}
