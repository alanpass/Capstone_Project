"""園藝智能助理 API。

create_app() 可注入假的相依物件（repo / gemini / weather / sensors / verify_token），
讓測試不需要連線到 Firebase 或外部 API。
"""
import json
from pathlib import Path

from flask import Flask
from flask_cors import CORS

from .config import Config
from .errors import register_error_handlers
from .routes.api import bp as api_bp
from .services.gemini import GeminiClient
from .services.sensors import SensorClient
from .services.weather import WeatherClient

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _init_firebase(cfg: Config):
    import firebase_admin
    from firebase_admin import auth, credentials, firestore

    if not firebase_admin._apps:
        if cfg.firebase_credentials_json:
            cred = credentials.Certificate(json.loads(cfg.firebase_credentials_json))
        elif cfg.firebase_credentials_file:
            # 相對路徑以 backend/ 為基準，不受啟動時所在目錄影響
            path = Path(cfg.firebase_credentials_file)
            cred = credentials.Certificate(str(path if path.is_absolute() else BACKEND_DIR / path))
        else:
            raise RuntimeError("請設定 FIREBASE_CREDENTIALS_JSON 或 FIREBASE_CREDENTIALS_FILE 環境變數")
        firebase_admin.initialize_app(cred)
    return firestore.client(), auth.verify_id_token


def create_app(config: Config | None = None, **overrides) -> Flask:
    cfg = config or Config()
    app = Flask(__name__)
    app.config["PLANTAI"] = cfg
    app.json.ensure_ascii = False

    deps = dict(overrides)
    if "repo" not in deps or "verify_token" not in deps:
        from .repository import FirestoreRepository

        client, verify = _init_firebase(cfg)
        deps.setdefault("repo", FirestoreRepository(client))
        deps.setdefault("verify_token", verify)
    deps.setdefault("gemini", GeminiClient(cfg.gemini_api_key, cfg.gemini_model))
    deps.setdefault("weather", WeatherClient(cfg.cwa_api_key, cfg.cwa_verify_ssl))
    deps.setdefault("sensors", SensorClient(
        cfg.thingspeak_channel_id, cfg.thingspeak_read_key, cfg.soil_adc_dry, cfg.soil_adc_wet, cfg.timezone,
    ))
    app.extensions["plantai"] = deps

    CORS(app, resources={r"/api/*": {"origins": cfg.allowed_origins}})
    register_error_handlers(app)
    app.register_blueprint(api_bp)

    @app.get("/")
    def index():
        return {"name": "園藝智能助理 API", "version": "5.0", "docs": "/api/health"}

    return app
