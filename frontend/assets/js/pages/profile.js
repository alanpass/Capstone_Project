import { getProfile, requireUser, saveProfile } from "../session.js";
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
$("uid").textContent = user.uid;

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

$("copyUid").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(user.uid);
    toast("已複製使用者 ID");
  } catch {
    toast("無法存取剪貼簿，請手動選取複製", "error");
  }
});
