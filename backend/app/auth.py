"""身分驗證。

舊版 API 直接相信前端傳來的 user_id，任何人都能讀取或刪除別人的植物。
新版改為驗證 Firebase ID Token，uid 一律從 token 取得。
"""
import hmac
from functools import wraps

from flask import current_app, g, request

from .errors import ApiError


def require_user(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            raise ApiError("請先登入", 401)
        token = header.removeprefix("Bearer ").strip()
        verifier = current_app.extensions["plantai"]["verify_token"]
        try:
            g.uid = verifier(token)["uid"]
        except Exception as exc:  # firebase_admin 會丟出多種 token 錯誤
            raise ApiError("登入已過期，請重新登入", 401) from exc
        return view(*args, **kwargs)

    return wrapper


def require_device_key(view):
    """ESP32 用的簡易金鑰：X-Device-Key 標頭需等於 DEVICE_API_KEY。"""

    @wraps(view)
    def wrapper(*args, **kwargs):
        expected = current_app.config["PLANTAI"].device_api_key
        provided = request.headers.get("X-Device-Key", "")
        if not expected or not hmac.compare_digest(provided, expected):
            raise ApiError("裝置金鑰錯誤", 401)
        return view(*args, **kwargs)

    return wrapper
