import { authErrorMessage, sendReset } from "../session.js";
import { busy, mountShell, showAlert } from "../ui.js";

await mountShell();
const msg = document.getElementById("msg");

document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value.trim();
  if (!email) return showAlert(msg, "請輸入 Email");
  const done = busy(document.getElementById("submit"), "寄送中…");
  try {
    await sendReset(email);
    showAlert(msg, "如果這個 Email 有註冊，重設連結已寄出，請到信箱（含垃圾郵件匣）查看。", "ok");
  } catch (err) {
    showAlert(msg, authErrorMessage(err));
  } finally {
    done();
  }
});
