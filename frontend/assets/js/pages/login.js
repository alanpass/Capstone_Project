import { authErrorMessage, nextPage, signIn } from "../session.js";
import { busy, mountShell, showAlert } from "../ui.js";
import { bindPasswordToggles } from "./_form.js";

const user = await mountShell();
if (user) location.replace(nextPage());
bindPasswordToggles();

const msg = document.getElementById("msg");
document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  if (!email || !password) return showAlert(msg, "請輸入 Email 與密碼");
  const done = busy(document.getElementById("submit"), "登入中…");
  try {
    await signIn(email, password);
    location.href = nextPage();
  } catch (err) {
    showAlert(msg, authErrorMessage(err));
    done();
  }
});
