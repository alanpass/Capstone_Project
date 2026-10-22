// 植物百科資料（靜態 JSON，由 backend/scripts/build_plant_catalog.py 產生）
let cache;

export function loadCatalog() {
  cache ??= fetch("data/plants.json").then((res) => {
    if (!res.ok) throw new Error("植物資料載入失敗");
    return res.json();
  });
  return cache;
}

export const PLACEHOLDER_IMG = "assets/img/logo.png";
