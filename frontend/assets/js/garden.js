// 使用者花園資料（Firestore）。安全規則限制每個人只能存取 users/{自己的 uid} 底下的資料。
//   users/{uid}/plants/{plantId}                 種植專案
//   users/{uid}/plants/{plantId}/guides/{key}    AI 指南快取（同一天不重複呼叫 AI）
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { checkPlant, generateGuide } from "./ai.js";
import { db } from "./firebase.js";
import { durationToDays, progressFor, todayISO, withProgress } from "./growth.js";
import { loadSensors } from "./sensors.js";
import { getProfile } from "./session.js";
import { forecast } from "./weather.js";

const plantsCol = (uid) => collection(db, "users", uid, "plants");
const byStartDesc = (a, b) => b.start_date.localeCompare(a.start_date);

export async function listPlants(uid) {
  const snap = await getDocs(plantsCol(uid));
  return snap.docs.map((d) => withProgress({ id: d.id, ...d.data() })).sort(byStartDesc);
}

export async function getPlant(uid, plantId) {
  const snap = await getDoc(doc(plantsCol(uid), plantId));
  return snap.exists() ? withProgress({ id: snap.id, ...snap.data() }) : null;
}

/** 先用 AI 確認是植物並估算週期，再建立種植專案。 */
export async function createPlant(uid, rawName) {
  const name = rawName.trim();
  if (!name) throw new Error("請輸入植物名稱");
  if (name.length > 40) throw new Error("植物名稱太長了");
  const check = await checkPlant(name);
  if (!check.is_plant) {
    const err = new Error(`系統判斷「${name}」不是可種植的植物，請輸入正確的作物或花卉名稱`);
    err.kind = "warn";
    throw err;
  }
  const record = {
    plant_name: String(check.normalized_name || name).trim().slice(0, 40),
    summary: String(check.summary || "").slice(0, 500),
    start_date: todayISO(),
    total_days: durationToDays(check.duration_value || 90, check.duration_unit),
    created_at: serverTimestamp(),
  };
  const ref = await addDoc(plantsCol(uid), record);
  return withProgress({ id: ref.id, ...record });
}

export async function deletePlant(uid, plantId) {
  const guides = await getDocs(collection(db, "users", uid, "plants", plantId, "guides"));
  await Promise.all(guides.docs.map((g) => deleteDoc(g.ref)));
  await deleteDoc(doc(plantsCol(uid), plantId));
}

/** 取得第 day 天（省略為今天）的指南；今天的指南會參考即時天氣與感測器。 */
export async function getGuide(user, plant, { day, refresh = false } = {}) {
  const isToday = !day || day === plant.current_day;
  const targetDay = isToday ? plant.current_day : day;
  if (targetDay < 1 || targetDay > plant.total_days + 30) {
    throw new Error(`天數需介於 1 到 ${plant.total_days + 30} 之間`);
  }
  const progress = progressFor(plant.start_date, plant.total_days, targetDay);
  const key = isToday ? `today-${todayISO()}` : `day-${targetDay}`;
  const ref = doc(db, "users", user.uid, "plants", plant.id, "guides", key);

  if (!refresh) {
    const cached = await getDoc(ref);
    if (cached.exists()) return { ...cached.data(), plant, day: targetDay, stage: progress.stage, cached: true };
  }

  let weather = null;
  let sensor = null;
  if (isToday) {
    const [profile, sensors] = await Promise.all([getProfile(user), loadSensors().catch(() => null)]);
    weather = await forecast(profile.address);
    sensor = sensors?.latest ?? null;
  }
  const guide = await generateGuide({
    plantName: plant.plant_name, day: targetDay, totalDays: plant.total_days, stage: progress.stage, weather, sensor,
  });
  const payload = { guide, weather, sensor, generated_at: new Date().toISOString() };
  await setDoc(ref, payload);
  return { ...payload, plant, day: targetDay, stage: progress.stage, cached: false };
}
