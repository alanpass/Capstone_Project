"""把舊版的植物資料（MySQL 匯出 JSON + .bin 圖片）整理成前端可直接讀取的靜態植物百科。

舊版流程需要在瀏覽器登入 import.html / migrate.html 才能寫入 Firestore；
新版把百科做成靜態檔（frontend/data/plants.json），網站載入更快，也不必開放資料庫寫入權限。

用法：
  python backend/scripts/build_plant_catalog.py <舊版前端資料夾> <新版 frontend 資料夾>
"""
import json
import sys
from pathlib import Path

from PIL import Image

# 對應舊版 migrate.html 的正規化規則
CARE_MAP = {"中": "中等"}
RESILIENCE_MAP = {"中": "中型"}
MAX_IMAGE = 480


def main(src: Path, dst: Path) -> None:
    rows = json.loads((src / "plant_care_firestore.json").read_text(encoding="utf-8"))
    img_dir = dst / "assets" / "img" / "plants"
    img_dir.mkdir(parents=True, exist_ok=True)

    catalog = []
    for row in rows:
        pid = str(row.get("_docId") or row["id"])
        record = {k: v for k, v in row.items() if not k.startswith("_") and k != "image" and v not in (None, "")}
        # 原始資料夾雜 Markdown 粗體符號，網頁以純文字顯示，因此移除
        record = {k: v.replace("**", "") if isinstance(v, str) else v for k, v in record.items()}
        record["id"] = pid
        if "care_level" in record:
            record["care_level"] = CARE_MAP.get(record["care_level"], record["care_level"])
        if "resilience" in record:
            record["resilience"] = RESILIENCE_MAP.get(record["resilience"], record["resilience"])

        # 少數 .bin 是損毀的文字檔，另有同編號的 {id}.jpg 補檔，因此優先使用補檔
        for source in (src / "image" / f"{pid}.jpg", src / "image" / f"plant_{pid}.bin"):
            if not source.exists():
                continue
            try:
                with Image.open(source) as im:
                    im = im.convert("RGB")
                    im.thumbnail((MAX_IMAGE, MAX_IMAGE))
                    im.save(img_dir / f"{pid}.webp", "WEBP", quality=80)
            except OSError:
                continue
            record["image"] = f"assets/img/plants/{pid}.webp"
            break
        catalog.append(record)

    catalog.sort(key=lambda r: int(r["id"]) if r["id"].isdigit() else 0)
    out_file = dst / "data" / "plants.json"
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"已輸出 {len(catalog)} 筆植物 → {out_file}（含圖片 {sum('image' in r for r in catalog)} 張）")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]))
