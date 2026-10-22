"""集中管理設定：所有金鑰與環境相關參數一律從環境變數讀取，不寫死在程式碼裡。"""
import os
from dataclasses import dataclass, field


def _bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _list(name: str, default: str) -> list[str]:
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


@dataclass
class Config:
    # Firebase：Render 上建議把整份服務帳戶 JSON 放進 FIREBASE_CREDENTIALS_JSON；
    # 本機開發可改用 FIREBASE_CREDENTIALS_FILE 指向 JSON 檔路徑。
    firebase_credentials_json: str = field(default_factory=lambda: os.environ.get("FIREBASE_CREDENTIALS_JSON", ""))
    firebase_credentials_file: str = field(default_factory=lambda: os.environ.get("FIREBASE_CREDENTIALS_FILE", ""))

    gemini_api_key: str = field(default_factory=lambda: os.environ.get("GEMINI_API_KEY", ""))
    gemini_model: str = field(default_factory=lambda: os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"))

    cwa_api_key: str = field(default_factory=lambda: os.environ.get("CWA_API_KEY", ""))
    # 氣象署 opendata 的憑證鏈在部分環境驗證失敗；只有確定需要時才關閉驗證。
    cwa_verify_ssl: bool = field(default_factory=lambda: _bool("CWA_VERIFY_SSL", True))
    default_city: str = field(default_factory=lambda: os.environ.get("DEFAULT_CITY", "高雄市"))

    thingspeak_channel_id: str = field(default_factory=lambda: os.environ.get("THINGSPEAK_CHANNEL_ID", "3013983"))
    thingspeak_read_key: str = field(default_factory=lambda: os.environ.get("THINGSPEAK_READ_KEY", ""))
    # 舊版韌體上傳的是 ADC 原始值（0~4095），用這兩個校正值換算成百分比
    soil_adc_dry: int = field(default_factory=lambda: int(os.environ.get("SOIL_ADC_DRY", "0")))
    soil_adc_wet: int = field(default_factory=lambda: int(os.environ.get("SOIL_ADC_WET", "1993")))

    device_api_key: str = field(default_factory=lambda: os.environ.get("DEVICE_API_KEY", ""))

    allowed_origins: list[str] = field(default_factory=lambda: _list(
        "ALLOWED_ORIGINS",
        "https://alanpass.github.io,https://plantai-cac82.web.app,https://plantai-cac82.firebaseapp.com,"
        "http://localhost:5000,http://127.0.0.1:5000,http://localhost:5500,http://127.0.0.1:5500",
    ))

    timezone: str = field(default_factory=lambda: os.environ.get("APP_TIMEZONE", "Asia/Taipei"))
    testing: bool = False
