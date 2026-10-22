import itertools
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import create_app  # noqa: E402
from app.config import Config  # noqa: E402


class FakeRepo:
    def __init__(self):
        self.profiles = {"alice": {"displayName": "Alice", "address": "台北市大安區"}}
        self.plants = {"alice": {}, "bob": {}}
        self.guides = {}
        self.thresholds = {}
        self._ids = itertools.count(1)

    def get_profile(self, uid):
        return self.profiles.get(uid, {})

    def list_plants(self, uid):
        return [{"id": pid, **data} for pid, data in self.plants.get(uid, {}).items()]

    def get_plant(self, uid, plant_id):
        data = self.plants.get(uid, {}).get(plant_id)
        return {"id": plant_id, **data} if data else None

    def add_plant(self, uid, data):
        pid = f"p{next(self._ids)}"
        self.plants.setdefault(uid, {})[pid] = dict(data)
        return pid

    def delete_plant(self, uid, plant_id):
        return self.plants.get(uid, {}).pop(plant_id, None) is not None

    def get_guide(self, uid, plant_id, key):
        return self.guides.get((uid, plant_id, key))

    def save_guide(self, uid, plant_id, key, guide):
        self.guides[(uid, plant_id, key)] = guide

    def get_thresholds(self, uid):
        return self.thresholds.get(uid)


class FakeGemini:
    def __init__(self):
        self.calls = []
        self.plant_check = {
            "is_plant": True, "normalized_name": "番茄", "duration_value": 3,
            "duration_unit": "months", "summary": "喜歡陽光的茄科作物。",
        }

    def generate_json(self, prompt, schema):
        self.calls.append(prompt)
        if "is_plant" in schema["properties"]:
            return self.plant_check
        return {"headline": "今天記得澆水", "expected_state": "長出新葉", "tasks": [], "environment_tips": [],
                "risks": [], "expert_tip": "摘心"}


class FakeWeather:
    def forecast(self, city):
        return {"city": city, "description": "晴", "min_temp": 22, "max_temp": 30, "rain_chance": 10}


class FakeSensors:
    def latest(self, results=20):
        return {"time": "2026-10-22 10:00:00", "soil": 42.0, "temperature": 26.5, "humidity": 70.0}

    def readings(self, results=20):
        return [self.latest()]


TOKENS = {"token-alice": "alice", "token-bob": "bob"}


def fake_verify(token):
    if token not in TOKENS:
        raise ValueError("bad token")
    return {"uid": TOKENS[token]}


@pytest.fixture
def deps():
    return {"repo": FakeRepo(), "gemini": FakeGemini(), "weather": FakeWeather(),
            "sensors": FakeSensors(), "verify_token": fake_verify}


@pytest.fixture
def client(deps):
    cfg = Config(device_api_key="device-secret", testing=True)
    app = create_app(cfg, **deps)
    return app.test_client()


def auth(user="alice"):
    return {"Authorization": f"Bearer token-{user}"}
