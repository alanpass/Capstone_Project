"""AI 提示詞與回應格式（responseSchema）。

所有提示詞都放在後端：前端只送「植物名稱 / 第幾天」，避免任何人把後端當成免費的 Gemini 代理。
回應一律要求結構化 JSON，前端再用安全的方式渲染，不直接塞 AI 產生的 HTML。
"""

PLANT_CHECK_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "is_plant": {"type": "BOOLEAN"},
        "normalized_name": {"type": "STRING"},
        "duration_value": {"type": "NUMBER"},
        "duration_unit": {"type": "STRING", "enum": ["days", "weeks", "months", "years"]},
        "summary": {"type": "STRING"},
    },
    "required": ["is_plant", "normalized_name", "duration_value", "duration_unit", "summary"],
}

GUIDE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "headline": {"type": "STRING"},
        "expected_state": {"type": "STRING"},
        "tasks": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "title": {"type": "STRING"},
                    "detail": {"type": "STRING"},
                    "amount": {"type": "STRING"},
                    "reason": {"type": "STRING"},
                },
                "required": ["title", "detail", "reason"],
            },
        },
        "environment_tips": {"type": "ARRAY", "items": {"type": "STRING"}},
        "risks": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {"risk": {"type": "STRING"}, "prevention": {"type": "STRING"}},
                "required": ["risk", "prevention"],
            },
        },
        "expert_tip": {"type": "STRING"},
    },
    "required": ["headline", "expected_state", "tasks", "environment_tips", "risks", "expert_tip"],
}


def plant_check_prompt(name: str) -> str:
    return f"""你是園藝專家。使用者想種植：「{name}」。
1. 判斷它是否為可以種植的植物（作物、花卉、蔬果、香草、樹木皆可）。
   非生物、料理、動物、虛構名詞或無法辨識的輸入，is_plant 回傳 false。
2. normalized_name：該植物最常見的繁體中文名稱（例如「蕃茄」→「番茄」）。
3. duration_value + duration_unit：從種植到第一次採收或開花所需時間；多年生植物只計算到第一次成熟/開花。
4. summary：用 2~3 句繁體中文介紹這個植物的生長特性與照顧重點。
若 is_plant 為 false，duration_value 填 0、summary 簡短說明原因。"""


def guide_prompt(plant_name: str, day: int, total_days: int, stage: str,
                 weather: dict | None, sensor: dict | None, is_today: bool) -> str:
    env_lines = []
    if weather:
        env_lines.append(
            f"- 當地天氣（{weather.get('city')}）：{weather.get('description') or '未知'}，"
            f"{weather.get('min_temp')}~{weather.get('max_temp')}°C，降雨機率 {weather.get('rain_chance')}%"
        )
    if sensor:
        env_lines.append(
            f"- 感測器：土壤濕度 {sensor.get('soil')}%、氣溫 {sensor.get('temperature')}°C、空氣濕度 {sensor.get('humidity')}%"
        )
    env_text = "\n".join(env_lines) if env_lines and is_today else "- （非今日查詢，請以該階段的典型環境推估）"

    return f"""你是頂尖的植物學家與農業顧問，請用繁體中文回答。
作物：{plant_name}
進度：第 {day} 天 / 共 {total_days} 天（目前階段：{stage}）
環境資料：
{env_text}

請產生這一天的照護指南：
- headline：一句話總結今天的重點。
- expected_state：這天植物應該呈現的樣子（高度、葉片數、花果狀態等）。
- tasks：3~4 項具體任務，每項含 title（動作）、detail（操作步驟）、amount（建議用量，例如「澆水約 300 ml」，沒有可留空）、reason（科學原因）。
  若有環境資料，請依據天氣與感測數值調整（例如土壤偏濕就減少澆水、高溫就提醒遮陰）。
- environment_tips：2~3 項溫度/濕度/光照檢查重點。
- risks：1~3 項這個階段常見的病蟲害或環境風險與預防方法。
- expert_tip：一個進階栽培技巧。
內容要專業、具體、有數據，不要使用 Markdown 或 HTML 標記。"""
