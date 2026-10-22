// 表單頁共用：密碼顯示切換
export function bindPasswordToggles() {
  document.querySelectorAll("[data-toggle=password]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = btn.parentElement.querySelector("input");
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.innerHTML = `<i class="fa-regular ${show ? "fa-eye-slash" : "fa-eye"}"></i>`;
    });
  });
}
