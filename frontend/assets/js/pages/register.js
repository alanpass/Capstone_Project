import { authErrorMessage, signUp } from "../session.js";
import { busy, mountShell, showAlert } from "../ui.js";
import { bindPasswordToggles } from "./_form.js";

const user = await mountShell();
if (user) location.replace("home.html");
bindPasswordToggles();

const msg = document.getElementById("msg");
const val = (id) => document.getElementById(id).value.trim();

document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = {
    name: val("name"),
    email: val("email"),
    password: document.getElementById("password").value,
    address: val("address"),
  };
  if (!data.name || !data.email || !data.password || !data.address) return showAlert(msg, "請填寫所有欄位");
  if (data.password.length < 6) return showAlert(msg, "密碼至少需要 6 個字元");
  const done = busy(document.getElementById("submit"), "建立帳號中…");
  try {
    const { needsConfirmation } = await signUp(data);
    if (!needsConfirmation) {
      location.href = "home.html";
      return;
    }
    document.getElementById("form").classList.add("hidden");
    showAlert(msg, `驗證信已寄到 ${data.email}，請點擊信中的連結完成註冊（記得檢查垃圾郵件匣）。`, "ok");
  } catch (err) {
    showAlert(msg, authErrorMessage(err));
    done();
  }
});
