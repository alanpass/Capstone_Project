from flask import Flask, jsonify
from werkzeug.exceptions import HTTPException


class ApiError(Exception):
    """可預期的錯誤：訊息會直接回傳給前端顯示。"""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(ApiError)
    def handle_api_error(err: ApiError):
        return jsonify({"error": err.message}), err.status

    @app.errorhandler(HTTPException)
    def handle_http_error(err: HTTPException):
        return jsonify({"error": err.description}), err.code

    @app.errorhandler(Exception)
    def handle_unexpected(err: Exception):
        app.logger.exception("Unhandled error")
        return jsonify({"error": "伺服器發生錯誤，請稍後再試"}), 500
