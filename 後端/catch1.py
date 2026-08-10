# catch1.py
import requests
# 移除 import pandas as pd - 已確認
from dateutil import parser
import pytz

# ThingSpeak 設定
CHANNEL_ID = "3013983"
READ_API_KEY = "SMABWDHQVFGZ68HJ"

def get_thingspeak_data():
    url = f"https://api.thingspeak.com/channels/{CHANNEL_ID}/feeds.json?api_key={READ_API_KEY}&results=5"
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()

        feeds = data.get("feeds", [])
        if not feeds:
            return {"error": "沒有資料"}

        result = []
        # 設定目標時區
        taipei_tz = pytz.timezone('Asia/Taipei')

        for feed in feeds:
            time_str = feed.get("created_at")
            formatted_time = ""
            
            if time_str:
                # 使用 dateutil 進行時間解析和時區轉換 (從 UTC 轉為 台北時間)
                utc_time = parser.parse(time_str)
                taipei_time = utc_time.astimezone(taipei_tz)
                formatted_time = taipei_time.strftime("%Y-%m-%d %H:%M:%S")

            # 收集需要的欄位
            result.append({
                "時間": formatted_time,
                "編號": feed.get("entry_id"),
                "土壤濕度": feed.get("field1"),
                "空氣溫度": feed.get("field2"),
                "空氣濕度": feed.get("field3")
            })

        return result

    except Exception as e:
        return {"error": str(e)}

# 🚨 移除 if __name__ == "__main__": 區塊 - 已確認