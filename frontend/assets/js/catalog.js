// 植物百科資料（靜態 JSON，由 tools/build_catalog.py 產生）
//   plants-index.json：1000 種植物的摘要（列表、篩選、新增植物的詳細頁）
//   plants.json      ：原本 100 種植物的完整照護資料（detail: true 的植物才有）
let indexCache;
let detailCache;

const fetchJson = (url) => fetch(url).then((res) => {
  if (!res.ok) throw new Error("植物資料載入失敗");
  return res.json();
});

export function loadCatalog() {
  indexCache ??= fetchJson("data/plants-index.json");
  return indexCache;
}

/** 原有 100 種植物的完整照護資料。 */
export async function loadDetail(id) {
  detailCache ??= fetchJson("data/plants.json");
  return (await detailCache).find((p) => p.id === id) ?? null;
}

// 以「使用者會怎麼找植物」來分類
export const CATEGORIES = [
  { key: "veg", name: "蔬菜", icon: "fa-carrot", desc: "葉菜、瓜果、豆類、根莖與芽菜" },
  { key: "herb", name: "香草與香料", icon: "fa-mortar-pestle", desc: "料理香草、花草茶、香料與藥草" },
  { key: "fruit", name: "水果與果樹", icon: "fa-apple-whole", desc: "莓果、柑橘、熱帶水果與堅果" },
  { key: "flower", name: "花卉", icon: "fa-fan", desc: "草花、球根、開花灌木與蔓藤" },
  { key: "orchid", name: "蘭花與鳳梨", icon: "fa-spa", desc: "蝴蝶蘭、國蘭、空氣鳳梨與觀賞鳳梨" },
  { key: "succulent", name: "多肉與仙人掌", icon: "fa-sun-plant-wilt", desc: "耐旱好養，適合陽台窗台" },
  { key: "foliage", name: "室內觀葉", icon: "fa-leaf", desc: "耐陰、淨化空氣的室內植物" },
  { key: "fern", name: "蕨類", icon: "fa-feather", desc: "喜陰濕的蕨類與石松類" },
  { key: "tree", name: "樹木、竹與觀賞草", icon: "fa-tree", desc: "庭園樹、綠籬、竹類與草坪" },
  { key: "aquatic", name: "水生植物", icon: "fa-water", desc: "睡蓮、荷花、浮水與水草" },
  { key: "carnivorous", name: "食蟲植物", icon: "fa-bug", desc: "捕蠅草、豬籠草、毛氈苔" },
];
export const categoryOf = (key) => CATEGORIES.find((c) => c.key === key) ?? { key, name: "其他", icon: "fa-seedling" };

// 快速篩選：用生活化的需求來找植物
export const QUICK_FILTERS = [
  { key: "easy", name: "新手友善", icon: "fa-face-smile", test: (p) => p.care === "低" },
  { key: "pet", name: "寵物友善", icon: "fa-paw", test: (p) => p.pet === "safe" },
  { key: "edible", name: "可以吃", icon: "fa-utensils", test: (p) => p.edible },
  { key: "indoor", name: "室內也能種", icon: "fa-house", test: (p) => p.indoor },
  { key: "shade", name: "不需要太多陽光", icon: "fa-cloud", test: (p) => p.sun === "耐陰" || p.sun === "明亮散射光" },
  { key: "dry", name: "不常澆水也可以", icon: "fa-droplet-slash", test: (p) => /2～3 週|每月|3週/.test(p.water ?? "") },
];

export const PLACEHOLDER_IMG = "assets/img/logo.png";
