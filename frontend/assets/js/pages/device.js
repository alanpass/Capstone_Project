// 門檻值直接寫入 Firestore 的 thresholds/{uid}（Firestore 規則限制只有本人能寫入），
// ESP32 再透過 Firestore REST API 讀取（規則允許以 uid 讀取單一文件）。
import { doc, getDoc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { db } from "../firebase.js";
import { requireUser } from "../session.js";
import { busy, mountShell, showAlert } from "../ui.js";

const DEFAULTS = { tempMin: 20, tempMax: 30, humidMin: 40, humidMax: 80, soilMin: 35 };
const FIELDS = Object.keys(DEFAULTS);

await mountShell();
const user = await requireUser();
const $ = (id) => document.getElementById(id);
const msg = $("msg");
const ref = doc(db, "thresholds", user.uid);

const fill = (values) => FIELDS.forEach((key) => ($(key).value = values[key] ?? DEFAULTS[key]));

try {
  const snap = await getDoc(ref);
  fill(snap.exists() ? snap.data() : DEFAULTS);
  const updated = snap.exists() && snap.data().updatedAt?.toDate?.();
  if (updated) $("updated").textContent = `上次更新：${updated.toLocaleString("zh-TW")}`;
} catch (err) {
  fill(DEFAULTS);
  showAlert(msg, `讀取設定失敗：${err.message}`);
}

$("defaults").addEventListener("click", () => fill(DEFAULTS));

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const values = Object.fromEntries(FIELDS.map((key) => [key, Number($(key).value)]));
  if (FIELDS.some((key) => $(key).value === "" || Number.isNaN(values[key]))) return showAlert(msg, "請填寫所有欄位");
  if (values.tempMin >= values.tempMax) return showAlert(msg, "溫度下限必須小於上限");
  if (values.humidMin >= values.humidMax) return showAlert(msg, "濕度下限必須小於上限");
  if ([values.humidMin, values.humidMax, values.soilMin].some((v) => v < 0 || v > 100)) return showAlert(msg, "濕度需介於 0~100%");

  const done = busy($("submit"), "儲存中…");
  try {
    await setDoc(ref, { ...values, updatedAt: serverTimestamp() }, { merge: true });
    showAlert(msg, "設定已儲存，裝置將在下次同步時套用。", "ok");
    $("updated").textContent = `上次更新：${new Date().toLocaleString("zh-TW")}`;
  } catch (err) {
    showAlert(msg, `儲存失敗：${err.message}`);
  } finally {
    done();
  }
});
