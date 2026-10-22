from datetime import date, timedelta

from conftest import auth


def test_health(client):
    assert client.get("/api/health").get_json() == {"status": "ok"}


def test_garden_requires_login(client):
    assert client.get("/api/garden").status_code == 401
    assert client.get("/api/garden", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_create_plant_uses_ai_name_and_duration(client, deps):
    res = client.post("/api/garden", json={"plant_name": "蕃茄"}, headers=auth())
    assert res.status_code == 201
    plant = res.get_json()["plant"]
    assert plant["plant_name"] == "番茄"
    assert plant["total_days"] == 90
    assert plant["current_day"] == 1
    assert plant["current_stage"] == "種植期"


def test_create_rejects_non_plant(client, deps):
    deps["gemini"].plant_check = {**deps["gemini"].plant_check, "is_plant": False}
    res = client.post("/api/garden", json={"plant_name": "iPhone"}, headers=auth())
    assert res.status_code == 422
    assert deps["repo"].plants["alice"] == {}


def test_create_requires_name(client):
    assert client.post("/api/garden", json={"plant_name": "  "}, headers=auth()).status_code == 400


def test_users_cannot_touch_each_others_plants(client, deps):
    pid = deps["repo"].add_plant("alice", {"plant_name": "羅勒", "start_date": date.today().isoformat(), "total_days": 60})
    assert client.get("/api/garden", headers=auth("bob")).get_json()["plants"] == []
    assert client.delete(f"/api/garden/{pid}", headers=auth("bob")).status_code == 404
    assert client.get(f"/api/garden/{pid}/guide", headers=auth("bob")).status_code == 404
    assert client.delete(f"/api/garden/{pid}", headers=auth("alice")).status_code == 200


def test_guide_is_cached_per_day(client, deps):
    start = (date.today() - timedelta(days=9)).isoformat()
    pid = deps["repo"].add_plant("alice", {"plant_name": "羅勒", "start_date": start, "total_days": 60})
    first = client.get(f"/api/garden/{pid}/guide", headers=auth()).get_json()
    second = client.get(f"/api/garden/{pid}/guide", headers=auth()).get_json()
    assert first["cached"] is False and second["cached"] is True
    assert first["day"] == 10
    assert len(deps["gemini"].calls) == 1
    assert "臺北市" in deps["gemini"].calls[0]  # 依使用者地址查詢天氣


def test_guide_specific_day_skips_live_environment(client, deps):
    pid = deps["repo"].add_plant("alice", {"plant_name": "羅勒", "start_date": date.today().isoformat(), "total_days": 60})
    data = client.get(f"/api/garden/{pid}/guide?day=45", headers=auth()).get_json()
    assert data["day"] == 45 and data["stage"] == "結果期"
    assert data["weather"] is None
    assert client.get(f"/api/garden/{pid}/guide?day=0", headers=auth()).status_code == 400


def test_dashboard(client, deps):
    deps["repo"].add_plant("alice", {"plant_name": "羅勒", "start_date": date.today().isoformat(), "total_days": 60})
    data = client.get("/api/dashboard", headers=auth()).get_json()
    assert data["weather"]["city"] == "臺北市"
    assert data["sensor"]["soil"] == 42.0
    assert len(data["plants"]) == 1


def test_device_thresholds(client, deps):
    url = "/api/device/thresholds?uid=alice"
    assert client.get(url).status_code == 401
    assert client.get(url, headers={"X-Device-Key": "wrong"}).status_code == 401
    defaults = client.get(url, headers={"X-Device-Key": "device-secret"}).get_json()
    assert defaults["source"] == "default" and defaults["tempMax"] == 30.0
    deps["repo"].thresholds["alice"] = {"tempMax": 28, "soilMin": 50}
    data = client.get(url, headers={"X-Device-Key": "device-secret"}).get_json()
    assert data["tempMax"] == 28.0 and data["soilMin"] == 50.0 and data["tempMin"] == 20.0


def test_public_sensors(client):
    data = client.get("/api/sensors").get_json()
    assert data["latest"]["temperature"] == 26.5
