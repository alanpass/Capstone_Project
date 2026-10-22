// 重設密碼信中的連結會帶著一次性登入憑證回到這頁（Supabase 會自動處理網址中的權杖），
// 取得暫時的登入狀態後即可設定新密碼。
import { authErrorMessage, currentUser, updatePassword } from "../session.js";
import { supabase } from "../supabase.js";
import { busy, mountShell, showAlert } from "../ui.js";

await mountShell();
const msg = document.getElementById("msg");
const form = document.getElementById("form");
const who = document.getElementById("who");

function ready(user) {
  who.textContent = `為 ${user.email} 設定新密碼`;
  form.classList.remove("hidden");
}

const params = new URLSearchParams(location.hash.slice(1) + "&" + location.search.slice(1));
if (params.get("error_description")) {
  who.textContent = "";
  showAlert(msg, "連結無效或已過期，請重新申請重設密碼。");
} else {
  const user = await currentUser();
  if (user) ready(user);
  supabase.auth.onAuthStateChange((event, session) => {
    if (session?.user && (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN")) ready(session.user);
  });
  setTimeout(() => {
    if (form.classList.contains("hidden")) {
      who.textContent = "";
      showAlert(msg, "請從重設密碼信件中的連結開啟此頁；若連結已過期，請重新申請。");
    }
  }, 4000);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = document.getElementById("password").value;
  if (password.length < 6) return showAlert(msg, "密碼至少需要 6 個字元");
  if (password !== document.getElementById("confirm").value) return showAlert(msg, "兩次輸入的密碼不一致");
  const done = busy(document.getElementById("submit"), "更新中…");
  try {
    await updatePassword(password);
    form.classList.add("hidden");
    showAlert(msg, "密碼已更新，3 秒後前往主控台…", "ok");
    setTimeout(() => (location.href = "home.html"), 3000);
  } catch (err) {
    showAlert(msg, authErrorMessage(err));
    done();
  }
});
