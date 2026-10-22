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
    await signUp(data);
    location.href = "home.html";
  } catch (err) {
    showAlert(msg, authErrorMessage(err));
    done();
  }
});
