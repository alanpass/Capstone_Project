// Firebase「自訂動作網址」指向此頁時使用：reset.html?mode=resetPassword&oobCode=...
import { applyReset, authErrorMessage, checkResetCode } from "../session.js";
import { busy, mountShell, showAlert } from "../ui.js";

await mountShell();
const msg = document.getElementById("msg");
const form = document.getElementById("form");
const who = document.getElementById("who");
const code = new URLSearchParams(location.search).get("oobCode");

if (!code) {
  who.textContent = "";
  showAlert(msg, "連結缺少驗證碼，請從信件中的連結開啟，或重新申請重設密碼。");
} else {
  try {
    const email = await checkResetCode(code);
    who.textContent = `為 ${email} 設定新密碼`;
    form.classList.remove("hidden");
  } catch (err) {
    who.textContent = "";
    showAlert(msg, authErrorMessage(err));
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = document.getElementById("password").value;
  if (password.length < 6) return showAlert(msg, "密碼至少需要 6 個字元");
  if (password !== document.getElementById("confirm").value) return showAlert(msg, "兩次輸入的密碼不一致");
  const done = busy(document.getElementById("submit"), "更新中…");
  try {
    await applyReset(code, password);
    form.classList.add("hidden");
    showAlert(msg, "密碼已更新，3 秒後前往登入頁…", "ok");
    setTimeout(() => (location.href = "login.html"), 3000);
  } catch (err) {
    showAlert(msg, authErrorMessage(err));
    done();
  }
});
