from datetime import date

from app.services.growth import duration_to_days, progress_for, stage_for
from app.services.sensors import SensorClient
from app.services.weather import city_from_address


def test_stage_boundaries():
    assert stage_for(0, 90) == "尚未開始"
    assert stage_for(7, 90) == "種植期"
    assert stage_for(20, 90) == "成長期"
    assert stage_for(50, 90) == "開花期"
    assert stage_for(90, 90) == "結果期"
    assert stage_for(91, 90) == "收成期"


def test_progress_is_clamped():
    p = progress_for(date(2026, 1, 1), 30, date(2026, 3, 1))
    assert p.percent == 100.0 and p.stage == "收成期"


def test_duration_conversion():
    assert duration_to_days(3, "months") == 90
    assert duration_to_days(2, "weeks") == 30  # 下限 30 天
    assert duration_to_days(5, "years") == 365  # 上限 365 天


def test_city_from_address():
    assert city_from_address("台中市西屯區", "高雄市") == "臺中市"
    assert city_from_address("", "高雄市") == "高雄市"


def test_sensor_normalization_converts_raw_adc():
    client = SensorClient("1", "", adc_dry=0, adc_wet=2000, tz="Asia/Taipei")
    row = client.normalize({"created_at": "2026-10-22T02:00:00Z", "field1": "1000", "field2": "26.4", "field3": ""})
    assert row["time"] == "2026-10-22 10:00:00"
    assert row["soil"] == 50.0
    assert row["temperature"] == 26.4
    assert row["humidity"] is None
    assert client.soil_percent(35) == 35.0  # 新韌體直接上傳百分比
