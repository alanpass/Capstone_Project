"""中央氣象署 36 小時天氣預報（F-C0032-001）。"""
import requests

FORECAST_URL = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001"

CITIES = (
    "臺北市", "新北市", "桃園市", "臺中市", "臺南市", "高雄市", "基隆市", "新竹市", "嘉義市",
    "新竹縣", "苗栗縣", "彰化縣", "南投縣", "雲林縣", "嘉義縣", "屏東縣", "宜蘭縣", "花蓮縣",
    "臺東縣", "澎湖縣", "金門縣", "連江縣",
)


def city_from_address(address: str, default: str) -> str:
    """從地址找出縣市名稱；「台」統一轉成氣象署使用的「臺」。"""
    normalized = (address or "").replace("台", "臺")
    return next((city for city in CITIES if city in normalized), default)


class WeatherClient:
    def __init__(self, api_key: str, verify_ssl: bool = True, timeout: int = 10):
        self.api_key = api_key
        self.verify_ssl = verify_ssl
        self.timeout = timeout

    def forecast(self, city: str) -> dict | None:
        """回傳最近一個時段的預報；取不到時回傳 None（天氣只是輔助資訊，不讓整個請求失敗）。"""
        if not self.api_key:
            return None
        try:
            res = requests.get(
                FORECAST_URL,
                params={"format": "JSON", "locationName": city},
                headers={"Authorization": self.api_key},
                timeout=self.timeout,
                verify=self.verify_ssl,
            )
            res.raise_for_status()
            elements = res.json()["records"]["location"][0]["weatherElement"]
        except (requests.RequestException, KeyError, IndexError, ValueError):
            return None

        def first(name: str) -> str | None:
            element = next((e for e in elements if e.get("elementName") == name), None)
            try:
                return element["time"][0]["parameter"]["parameterName"]
            except (TypeError, KeyError, IndexError):
                return None

        return {
            "city": city,
            "description": first("Wx"),
            "min_temp": _to_float(first("MinT")),
            "max_temp": _to_float(first("MaxT")),
            "rain_chance": _to_float(first("PoP")),
            "comfort": first("CI"),
        }


def _to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
