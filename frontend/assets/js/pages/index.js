import { mountShell } from "../ui.js";

const user = await mountShell();
if (user) {
  document.getElementById("cta").innerHTML = `
    <a class="btn" href="home.html"><i class="fa-solid fa-gauge"></i> 進入主控台</a>
    <a class="btn secondary" href="planner.html"><i class="fa-solid fa-seedling"></i> 開始種植</a>`;
}
