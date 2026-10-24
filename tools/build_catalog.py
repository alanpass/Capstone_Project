"""產生植物百科索引 frontend/data/plants-index.json（1000 種）。

資料來源：
  - frontend/data/plants.json：原本 100 種植物的完整照護資料（詳細頁直接讀取）
  - tools/plant_data/*.txt：新增的植物，每行一種，以 | 分隔：
      中文名|學名|照護難度|日照|澆水|適溫|標記|生命週期|繁殖|簡介
    照護難度 1 低 / 2 中等 / 3 高
    日照     F 全日照 / P 半日照 / S 明亮散射光 / H 耐陰
    澆水     1 保持濕潤 / 2 一週兩次 / 3 每週 / 4 每 1～2 週 / 5 每 2～3 週 / 6 每月 / W 水生
    適溫     例如 18-30（°C）
    標記     E 可食用、I 適合室內、K 對貓狗無毒、T 對貓狗有毒（可組合，也可留空）
    生命週期 A 一年生 / B 二年生 / P 多年生
    繁殖     s 播種 c 扦插 d 分株 l 壓條 g 嫁接 b 球根塊莖 o 走莖 f 孢子 r 側芽 e 葉插 t 組織培養
  - 圖片：依學名查詢維基百科條目的代表圖（結果快取在 tools/plant_data/images.json，重跑不會重抓）

用法：python tools/build_catalog.py [--no-images]
"""
import hashlib
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "tools" / "plant_data"
OLD_CATALOG = ROOT / "frontend" / "data" / "plants.json"
OUTPUT = ROOT / "frontend" / "data" / "plants-index.json"
IMAGE_CACHE = DATA_DIR / "images.json"

# 檔名 → 分類代碼（前端 catalog.js 的 CATEGORIES 對應名稱與圖示）
FILE_CATEGORY = {
    "vegetables": "veg", "herbs": "herb", "fruits": "fruit", "flowers": "flower", "flowers2": "flower",
    "orchids": "orchid", "succulents": "succulent", "foliage": "foliage", "ferns": "fern",
    "trees": "tree", "aquatic": "aquatic", "carnivorous": "carnivorous",
}
CARE = {"1": "低", "2": "中等", "3": "高"}
SUN = {"F": "全日照", "P": "半日照", "S": "明亮散射光", "H": "耐陰"}
WATER = {"1": "保持濕潤", "2": "一週兩次", "3": "每週", "4": "每 1～2 週", "5": "每 2～3 週", "6": "每月", "W": "水生"}
LIFE = {"A": "一年生", "B": "二年生", "P": "多年生"}
PROP = {"s": "播種", "c": "扦插", "d": "分株", "l": "壓條", "g": "嫁接", "b": "球根／塊莖", "o": "走莖",
        "f": "孢子", "r": "側芽", "e": "葉插", "t": "組織培養"}

# 原本 100 種植物的分類、學名與標記（E 可食用、I 適合室內）；寵物毒性由原資料的文字判斷
OLD = {
    "1": "foliage|Epipremnum aureum|I", "2": "flower|Pelargonium × hortorum|", "3": "flower|Begonia|I",
    "4": "foliage|Monstera deliciosa|I", "5": "flower|Strelitzia reginae|", "6": "flower|Impatiens walleriana|",
    "7": "fruit|Citrus japonica|E", "8": "flower|Rhododendron simsii|", "9": "foliage|Hedera helix|I",
    "10": "orchid|Guzmania|I", "12": "flower|Camellia japonica|", "13": "flower|Hydrangea macrophylla|",
    "14": "orchid|Phalaenopsis|I", "15": "flower|Rosa × hybrida|", "16": "flower|Petunia × atkinsiana|",
    "17": "flower|Datura stramonium|", "18": "tree|Pieris taiwanensis|", "19": "fruit|Passiflora edulis|E",
    "20": "flower|Potentilla fruticosa|", "21": "flower|Tulipa gesneriana|", "22": "flower|Callistephus chinensis|",
    "23": "flower|Verbena bonariensis|", "24": "tree|Pittosporum tobira|", "25": "flower|Salvia farinacea|",
    "26": "flower|Papaver rhoeas|", "27": "tree|Lonicera tatarica|", "28": "herb|Tanacetum vulgare|",
    "29": "veg|Helianthus tuberosus|E", "30": "orchid|Dendrobium|I", "31": "flower|Leucanthemum × superbum|",
    "32": "flower|Lobelia erinus|", "33": "flower|Ranunculus repens|", "34": "flower|Zantedeschia aethiopica|",
    "35": "herb|Nepeta cataria|", "36": "flower|Solanum pseudocapsicum|", "37": "foliage|Goeppertia rufibarba|I",
    "38": "foliage|Pilea cadierei|I", "39": "foliage|Phoenix roebelenii|I", "40": "foliage|Polyscias fruticosa|I",
    "41": "foliage|Ficus pumila|", "42": "foliage|Aucuba japonica 'Variegata'|", "43": "herb|Coleus amboinicus|E",
    "44": "fern|Asplenium nidus|I", "45": "foliage|Tradescantia spathacea|", "46": "tree|Cycas revoluta|",
    "47": "flower|Lantana camara|", "48": "fruit|Morus alba|E", "49": "flower|Hibiscus syriacus|",
    "50": "flower|Hemerocallis fulva|", "51": "tree||", "52": "tree|Euonymus japonicus|",
    "53": "flower|Paeonia lactiflora|", "54": "flower|Dianthus caryophyllus|", "55": "veg|Phaseolus vulgaris|E",
    "56": "flower|Hosta plantaginea|", "57": "flower|Lilium longiflorum|", "58": "tree|Albizia julibrissin|",
    "59": "tree|Nandina domestica|", "60": "veg|Brassica oleracea var. capitata|E", "61": "flower|Wisteria sinensis|",
    "62": "flower|Trachelospermum jasminoides|", "63": "fruit|Selenicereus undatus|E",
    "64": "foliage|Liriope muscari|", "65": "aquatic|Nelumbo nucifera|E", "66": "herb|Perilla frutescens|E",
    "67": "herb|Foeniculum vulgare|E", "68": "fruit|Musa basjoo var. formosana|", "69": "foliage|Asparagus setaceus|I",
    "70": "foliage|Philodendron giganteum|I", "71": "foliage|Peperomia caperata|I", "72": "tree|Lagerstroemia indica|",
    "73": "herb|Chrysanthemum morifolium 'Hangju'|E", "74": "flower|Catharanthus roseus|", "75": "tree|Nerium oleander|",
    "76": "flower|Celosia argentea var. cristata|", "77": "tree|Buddleja davidii|", "78": "foliage|Hoya carnosa|I",
    "79": "flower|Canna indica|", "80": "flower|Centaurea cyanus|E", "81": "flower|Digitalis purpurea|",
    "82": "tree|Weigela florida|", "83": "foliage|Fittonia albivenis|I", "84": "foliage|Araucaria heterophylla|I",
    "85": "veg|Daucus carota subsp. sativus|E", "86": "fruit|Cucumis melo|E", "87": "fruit|Vitis vinifera|E",
    "88": "tree|Spiraea japonica|", "89": "tree|Thuja occidentalis|", "90": "tree|Pyrus calleryana|",
    "91": "flower|Rudbeckia hirta|", "92": "tree|Robinia pseudoacacia|", "93": "flower|Alcea rosea|",
    "94": "tree|Buxus sempervirens|", "95": "veg|Cichorium intybus|E", "96": "fruit|Citrullus lanatus|E",
    "97": "flower|Fuchsia magellanica|", "98": "tree|Ulmus|", "99": "tree|Berberis thunbergii|",
    "100": "fruit|Juglans regia|E", "101": "tree|Rhus typhina|",
}


# 原資料的用詞對應到新的標籤，篩選時才會一致
OLD_SUN = {"全遮光": "耐陰"}
OLD_WATER = {"每1-2週": "每 1～2 週", "每3週": "每 2～3 週", "水生植物 (需持續水深)": "水生"}


def pet_safety(text):
    """由原資料的寵物毒性說明判斷：無毒 → safe，提到毒 → toxic，否則未知。"""
    if not text:
        return None
    head = text[:60]
    if "無毒" in head or "沒有毒" in head or "安全" in head:
        return "safe"
    return "toxic" if "毒" in text else None


def first(mapping, text):
    """在舊資料文字中找第一個符合的標籤，例如「全日照, 半日照」→ 全日照。"""
    for label in mapping:
        if label in (text or ""):
            return label
    return None


def parse_temp(text):
    """「18-30」「-15 - 38 °C」→ [18, 30]、[-15, 38]"""
    m = re.search(r"(-?\d+)\s*[-~–]\s*(-?\d+)", text or "")
    return [int(m.group(1)), int(m.group(2))] if m else None


def old_records():
    rows = json.loads(OLD_CATALOG.read_text(encoding="utf-8"))
    records = []
    for p in rows:
        cat, sci, flags = OLD[p["id"]].split("|")
        pet = pet_safety(p.get("toxicity_cat")) if pet_safety(p.get("toxicity_cat")) == pet_safety(p.get("toxicity_dog")) else "toxic"
        desc = p.get("description", "")
        records.append({
            "id": p["id"], "name": p["plant_name"], "sci": sci, "cat": cat,
            "care": p.get("care_level"),
            "sun": OLD_SUN.get(p.get("sunlight_needs"), p.get("sunlight_needs")),
            "water": OLD_WATER.get(p.get("watering_schedule"), p.get("watering_schedule")),
            "temp": parse_temp(p.get("ideal_temperature")),
            "life": first(["多年生", "一年生", "二年生"], p.get("lifespan")),
            "prop": [s.strip() for s in re.split(r"[,，、]", p.get("propagation_type") or "") if s.strip()][:4],
            "edible": "E" in flags, "indoor": "I" in flags, "pet": pet,
            "desc": desc if len(desc) <= 80 else desc[:78].rstrip("，。、 ") + "…",
            "img": p.get("image"), "detail": True,
        })
    return records


def new_records():
    records, errors = [], []
    for path in sorted(DATA_DIR.glob("*.txt")):
        cat = FILE_CATEGORY[path.stem]
        for no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip() or line.startswith("#"):
                continue
            parts = line.split("|")
            where = f"{path.name}:{no}"
            if len(parts) != 10:
                errors.append(f"{where} 欄位數 {len(parts)}")
                continue
            name, sci, care, sun, water, temp, flags, life, prop, desc = (s.strip() for s in parts)
            t = parse_temp(temp)
            checks = [
                (care in CARE, "照護難度"), (sun in SUN, "日照"), (water in WATER, "澆水"),
                (t is not None and t[0] < t[1], "適溫"), (set(flags) <= set("EIKT") and not {"K", "T"} <= set(flags), "標記"),
                (life in LIFE, "生命週期"), (prop and set(prop) <= set(PROP), "繁殖"), (name and sci and desc, "必填"),
            ]
            for ok, label in checks:
                if not ok:
                    errors.append(f"{where} {name} {label}格式錯誤")
            records.append({
                "id": "p" + hashlib.md5(name.encode()).hexdigest()[:8], "name": name, "sci": sci, "cat": cat,
                "care": CARE.get(care), "sun": SUN.get(sun), "water": WATER.get(water), "temp": t,
                "life": LIFE.get(life), "prop": [PROP[c] for c in prop if c in PROP],
                "edible": "E" in flags, "indoor": "I" in flags,
                "pet": "safe" if "K" in flags else "toxic" if "T" in flags else None,
                "desc": desc,
            })
    return records, errors


def wiki_title(sci):
    """學名 → 維基百科條目名稱候選：完整學名（去掉品種名）、屬 + 種。"""
    clean = re.sub(r"'[^']*'|\([^)]*\)|\bhybrids\b|\bspp\.|\bGroup\b", "", sci).strip()
    clean = re.sub(r"\s+", " ", clean)
    words = clean.split(" ")
    candidates = [clean]
    if len(words) > 2:
        candidates.append(" ".join(words[:3] if words[1] == "×" else words[:2]))
    return [c for c in dict.fromkeys(candidates) if c]


def fetch_thumbnails(lang, titles):
    """一次查詢 50 個條目的代表圖。回傳 {原始標題: {img, wiki}}。"""
    found = {}
    for i in range(0, len(titles), 50):
        batch = titles[i:i + 50]
        query = urllib.parse.urlencode({
            "action": "query", "format": "json", "formatversion": 2, "redirects": 1,
            "prop": "pageimages", "piprop": "thumbnail", "pithumbsize": 480, "titles": "|".join(batch),
        })
        req = urllib.request.Request(f"https://{lang}.wikipedia.org/w/api.php?{query}",
                                     headers={"User-Agent": "PlantAI-capstone/1.0 (https://github.com/alanpass/Capstone_Project)"})
        with urllib.request.urlopen(req, timeout=30) as res:
            data = json.load(res)["query"]
        alias = {}
        for step in data.get("normalized", []) + data.get("redirects", []):
            alias[step["to"]] = alias.get(step["from"], step["from"])
        for page in data.get("pages", []):
            thumb = page.get("thumbnail", {}).get("source")
            if thumb:
                original = alias.get(page["title"], page["title"])
                found[original] = {"img": thumb, "wiki": f"https://{lang}.wikipedia.org/wiki/{urllib.parse.quote(page['title'].replace(' ', '_'))}"}
        time.sleep(0.5)
    return found


def attach_images(records):
    cache = json.loads(IMAGE_CACHE.read_text(encoding="utf-8")) if IMAGE_CACHE.exists() else {}
    missing = [r for r in records if r["name"] not in cache]
    if missing:
        print(f"查詢 {len(missing)} 種植物的圖片…")
        for r in missing:
            cache[r["name"]] = None
        # 依序嘗試：英文維基（完整學名）→ 英文維基（屬 + 種）→ 中文維基（中文名）
        for level in range(2):
            todo = {r["name"]: wiki_title(r["sci"]) for r in missing if cache[r["name"]] is None}
            titles = {name: c[level] for name, c in todo.items() if len(c) > level}
            hits = fetch_thumbnails("en", list(dict.fromkeys(titles.values())))
            for name, title in titles.items():
                cache[name] = hits.get(title)
        todo = [r["name"] for r in missing if cache[r["name"]] is None]
        hits = fetch_thumbnails("zh", todo)
        for name in todo:
            cache[name] = hits.get(name)
        IMAGE_CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=0, sort_keys=True), encoding="utf-8")
    for r in records:
        hit = cache.get(r["name"])
        if not hit:
            continue
        r.update(hit)
        # 條目只到屬（例如 Echeveria），或植物是栽培品種／品系 → 圖片僅為同類示意
        title = urllib.parse.unquote(hit["wiki"].rsplit("/", 1)[-1])
        if title.lower() == r["sci"].split(" ")[0].lower() or re.search(r"'|Group|Microgreens|Sprouts|hybrids", r["sci"]):
            r["approx"] = True


def main():
    old = old_records()
    new, errors = new_records()
    if errors:
        sys.exit("資料格式錯誤：\n" + "\n".join(errors))

    seen_names = {r["name"] for r in old}
    seen_sci = {r["sci"].lower() for r in old if r["sci"]}
    kept, dupes = [], []
    for r in new:
        key = r["sci"].lower()
        if r["name"] in seen_names or key in seen_sci:
            dupes.append(f"{r['name']}（{r['sci']}）")
            continue
        seen_names.add(r["name"])
        seen_sci.add(key)
        kept.append(r)
    if dupes:
        print(f"略過 {len(dupes)} 筆重複：{'、'.join(dupes)}")
    ids = [r["id"] for r in kept]
    if len(ids) != len(set(ids)):
        sys.exit("id 重複，請調整名稱")

    if "--no-images" not in sys.argv:
        attach_images(kept)
    catalog = old + kept
    OUTPUT.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    with_img = sum(1 for r in catalog if r.get("img"))
    by_cat = {}
    for r in catalog:
        by_cat[r["cat"]] = by_cat.get(r["cat"], 0) + 1
    print(f"共 {len(catalog)} 種（原有 {len(old)}、新增 {len(kept)}），{with_img} 種有圖片")
    print("各分類：", by_cat)
    print(f"輸出 {OUTPUT.relative_to(ROOT)}（{OUTPUT.stat().st_size // 1024} KB）")


if __name__ == "__main__":
    main()
