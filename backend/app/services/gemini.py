"""Google Gemini REST API 的精簡封裝。金鑰只存在後端，前端永遠拿不到。"""
import json

import requests

from ..errors import ApiError

API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


class GeminiClient:
    def __init__(self, api_key: str, model: str, timeout: int = 45):
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    def generate_json(self, prompt: str, schema: dict) -> dict:
        """要求模型依照 responseSchema 回傳 JSON，並解析成 dict。"""
        text = self._generate(prompt, {"responseMimeType": "application/json", "responseSchema": schema})
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise ApiError("AI 回傳格式錯誤，請再試一次", 502) from exc

    def _generate(self, prompt: str, generation_config: dict) -> str:
        if not self.api_key:
            raise ApiError("伺服器未設定 GEMINI_API_KEY", 503)
        payload = {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": generation_config}
        try:
            res = requests.post(
                API_URL.format(model=self.model),
                headers={"x-goog-api-key": self.api_key},
                json=payload,
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise ApiError("無法連線至 AI 服務", 502) from exc
        if res.status_code == 429:
            raise ApiError("AI 服務使用量已達上限，請稍後再試", 429)
        if res.status_code != 200:
            raise ApiError(f"AI 服務錯誤（{res.status_code}）", 502)
        try:
            return res.json()["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError, ValueError) as exc:
            raise ApiError("AI 沒有產生回應，請換個說法再試", 502) from exc
