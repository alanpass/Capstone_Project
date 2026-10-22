import { getProfile, requireUser, saveProfile } from "../session.js";
import { supabase, unwrap } from "../supabase.js";
import { busy, mountShell, showAlert, toast } from "../ui.js";

await mountShell();
const user = await requireUser();
const $ = (id) => document.getElementById(id);
const msg = $("msg");

try {
  const profile = await getProfile(user);
  $("email").value = profile.email || "";
  $("name").value = profile.displayName;
  $("address").value = profile.address;
} catch (err) {
  showAlert(msg, `讀取資料失敗：${err.message}`);
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const displayName = $("name").value.trim();
  const address = $("address").value.trim();
  if (!displayName) return showAlert(msg, "姓名不可空白");
  const done = busy($("submit"), "儲存中…");
  try {
    await saveProfile(user, { displayName, address });
    showAlert(msg, "資料已更新", "ok");
  } catch (err) {
    showAlert(msg, `儲存失敗：${err.message}`);
  } finally {
    done();
  }
});

// ---- 裝置權杖 ----
async function loadToken(regenerate = false) {
  try {
    $("token").textContent = unwrap(await supabase.rpc("device_token", { regenerate }));
  } catch (err) {
    $("token").textContent = `無法取得權杖：${err.message}`;
  }
}

$("copyToken").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("token").textContent);
    toast("已複製裝置權杖");
  } catch {
    toast("無法存取剪貼簿，請手動選取複製", "error");
  }
});

$("newToken").addEventListener("click", async () => {
  if (!confirm("重新產生後，舊權杖會立即失效，需要更新 ESP32 的設定。確定嗎？")) return;
  await loadToken(true);
  toast("已產生新的裝置權杖");
});

loadToken();
