from datetime import date, datetime
from zoneinfo import ZoneInfo

from flask import Blueprint, current_app, g, jsonify, request

from ..auth import require_device_key, require_user
from ..errors import ApiError
from ..services import prompts
from ..services.growth import duration_to_days, progress_for
from ..services.weather import city_from_address

bp = Blueprint("api", __name__, url_prefix="/api")

DEFAULT_THRESHOLDS = {"tempMin": 20.0, "tempMax": 30.0, "humidMin": 40.0, "humidMax": 80.0, "soilMin": 35.0}


def _deps():
    return current_app.extensions["plantai"]


def _today() -> date:
    return datetime.now(ZoneInfo(current_app.config["PLANTAI"].timezone)).date()


def _with_progress(record: dict, today: date) -> dict:
    try:
        start = date.fromisoformat(record["start_date"])
    except (KeyError, TypeError, ValueError):
        start = today
    p = progress_for(start, record.get("total_days", 90), today)
    return {
        "id": record["id"],
        "plant_name": record.get("plant_name", "未命名"),
        "summary": record.get("summary", ""),
        "start_date": start.isoformat(),
        "total_days": p.total_days,
        "current_day": p.day,
        "progress": p.percent,
        "current_stage": p.stage,
    }


def _weather_for(uid: str) -> dict | None:
    cfg = current_app.config["PLANTAI"]
    profile = _deps()["repo"].get_profile(uid)
    address = profile.get("address") or profile.get("Address") or ""
    return _deps()["weather"].forecast(city_from_address(address, cfg.default_city))


@bp.get("/health")
def health():
    return jsonify({"status": "ok"})


@bp.get("/sensors")
def sensors():
    results = request.args.get("results", default=20, type=int)
    client = _deps()["sensors"]
    return jsonify({"latest": client.latest(results), "readings": client.readings(results)})


@bp.get("/dashboard")
@require_user
def dashboard():
    today = _today()
    plants = [_with_progress(p, today) for p in _deps()["repo"].list_plants(g.uid)]
    plants.sort(key=lambda p: p["start_date"], reverse=True)
    return jsonify({
        "date": today.isoformat(),
        "weather": _weather_for(g.uid),
        "sensor": _deps()["sensors"].latest(),
        "plants": plants,
    })


@bp.get("/garden")
@require_user
def list_garden():
    today = _today()
    plants = [_with_progress(p, today) for p in _deps()["repo"].list_plants(g.uid)]
    plants.sort(key=lambda p: p["start_date"], reverse=True)
    return jsonify({"plants": plants})


@bp.post("/garden")
@require_user
def create_plant():
    body = request.get_json(silent=True) or {}
    name = str(body.get("plant_name", "")).strip()
    if not name:
        raise ApiError("請輸入植物名稱")
    if len(name) > 40:
        raise ApiError("植物名稱太長了")

    check = _deps()["gemini"].generate_json(prompts.plant_check_prompt(name), prompts.PLANT_CHECK_SCHEMA)
    if not check.get("is_plant"):
        raise ApiError(f"系統判斷「{name}」不是可種植的植物，請輸入正確的作物或花卉名稱", 422)

    try:
        total_days = duration_to_days(check.get("duration_value") or 90, check.get("duration_unit", "days"))
    except (TypeError, ValueError):
        total_days = 90
    record = {
        "plant_name": (check.get("normalized_name") or name).strip()[:40],
        "summary": str(check.get("summary", ""))[:500],
        "start_date": _today().isoformat(),
        "total_days": total_days,
    }
    plant_id = _deps()["repo"].add_plant(g.uid, record)
    return jsonify({"plant": _with_progress({"id": plant_id, **record}, _today())}), 201


@bp.delete("/garden/<plant_id>")
@require_user
def delete_plant(plant_id: str):
    if not _deps()["repo"].delete_plant(g.uid, plant_id):
        raise ApiError("找不到這株植物", 404)
    return jsonify({"deleted": plant_id})


@bp.get("/garden/<plant_id>/guide")
@require_user
def plant_guide(plant_id: str):
    """取得第 N 天（預設今天）的 AI 照護指南。結果會快取，同一天重複查詢不再耗用 AI 額度。"""
    repo = _deps()["repo"]
    record = repo.get_plant(g.uid, plant_id)
    if not record:
        raise ApiError("找不到這株植物", 404)

    today = _today()
    plant = _with_progress(record, today)
    requested = request.args.get("day", type=int)
    is_today = requested is None or requested == plant["current_day"]
    day = plant["current_day"] if is_today else requested
    if day < 1 or day > plant["total_days"] + 30:
        raise ApiError(f"天數需介於 1 到 {plant['total_days'] + 30} 之間")

    progress = progress_for(date.fromisoformat(plant["start_date"]), plant["total_days"], today, day)
    # 今天的指南會參考即時天氣與感測器，所以用日期當快取鍵；其他天數只跟天數有關
    cache_key = f"today-{today.isoformat()}" if is_today else f"day-{day}"
    refresh = request.args.get("refresh") == "1"
    cached = None if refresh else repo.get_guide(g.uid, plant_id, cache_key)
    if cached:
        return jsonify({"plant": plant, "day": day, "stage": progress.stage, "cached": True, **cached})

    weather = _weather_for(g.uid) if is_today else None
    sensor = _deps()["sensors"].latest() if is_today else None
    guide = _deps()["gemini"].generate_json(
        prompts.guide_prompt(plant["plant_name"], day, plant["total_days"], progress.stage, weather, sensor, is_today),
        prompts.GUIDE_SCHEMA,
    )
    payload = {"guide": guide, "weather": weather, "sensor": sensor, "generated_at": datetime.now().isoformat()}
    repo.save_guide(g.uid, plant_id, cache_key, payload)
    return jsonify({"plant": plant, "day": day, "stage": progress.stage, "cached": False, **payload})


@bp.get("/device/thresholds")
@require_device_key
def device_thresholds():
    """ESP32 每隔一段時間呼叫，取得使用者在網站設定的自動控制門檻值。"""
    uid = request.args.get("uid", "").strip()
    if not uid:
        raise ApiError("缺少 uid")
    stored = _deps()["repo"].get_thresholds(uid) or {}
    result = {key: float(stored.get(key, default)) for key, default in DEFAULT_THRESHOLDS.items()}
    return jsonify({"status": "success", "source": "firestore" if stored else "default", **result})
