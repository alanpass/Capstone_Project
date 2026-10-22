"""讀取 ThingSpeak 上 ESP32 回傳的感測資料。

欄位對應：field1 = 土壤濕度、field2 = 空氣溫度、field3 = 空氣濕度。
兩塊 ESP32 分別上傳不同欄位，所以單筆資料常常只有部分欄位有值。
"""
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

FEEDS_URL = "https://api.thingspeak.com/channels/{channel}/feeds.json"


class SensorClient:
    def __init__(self, channel_id: str, read_key: str, adc_dry: int, adc_wet: int, tz: str, timeout: int = 10):
        self.channel_id = channel_id
        self.read_key = read_key
        self.adc_dry = adc_dry
        self.adc_wet = adc_wet
        self.tz = ZoneInfo(tz)
        self.timeout = timeout

    def readings(self, results: int = 20) -> list[dict]:
        params = {"results": max(1, min(results, 200))}
        if self.read_key:
            params["api_key"] = self.read_key
        try:
            res = requests.get(FEEDS_URL.format(channel=self.channel_id), params=params, timeout=self.timeout)
            res.raise_for_status()
            feeds = res.json().get("feeds", [])
        except (requests.RequestException, ValueError):
            return []
        rows = [self.normalize(feed) for feed in feeds]
        return [row for row in reversed(rows) if any(row[k] is not None for k in ("soil", "temperature", "humidity"))]

    def latest(self, results: int = 20) -> dict | None:
        """把最近幾筆合併成「每個欄位的最新值」，避免只看最後一筆而缺欄位。"""
        merged = {"time": None, "soil": None, "temperature": None, "humidity": None}
        for row in self.readings(results):  # 新 → 舊
            merged["time"] = merged["time"] or row["time"]
            for key in ("soil", "temperature", "humidity"):
                if merged[key] is None:
                    merged[key] = row[key]
        return merged if merged["time"] else None

    def normalize(self, feed: dict) -> dict:
        created = feed.get("created_at")
        time_text = None
        if created:
            try:
                parsed = datetime.fromisoformat(created.replace("Z", "+00:00"))
                time_text = parsed.astimezone(self.tz).strftime("%Y-%m-%d %H:%M:%S")
            except ValueError:
                time_text = created
        return {
            "time": time_text,
            "entry_id": feed.get("entry_id"),
            "soil": self.soil_percent(_num(feed.get("field1"))),
            "temperature": _ranged(_num(feed.get("field2")), -40, 80),
            "humidity": _ranged(_num(feed.get("field3")), 0, 100),
        }

    def soil_percent(self, value: float | None) -> float | None:
        if value is None:
            return None
        if value > 100:  # 舊韌體上傳的是 ADC 原始值
            span = (self.adc_wet - self.adc_dry) or 1
            value = (value - self.adc_dry) / span * 100
        return round(max(0.0, min(100.0, value)), 1)


def _num(value) -> float | None:
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _ranged(value: float | None, low: float, high: float) -> float | None:
    return round(value, 1) if value is not None and low <= value <= high else None
