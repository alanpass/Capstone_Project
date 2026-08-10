# catch1.py
import requests
import pandas as pd

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

        # 建立 DataFrame
        df = pd.DataFrame(feeds)
        df["created_at"] = pd.to_datetime(df["created_at"], utc=True).dt.tz_convert("Asia/Taipei")

        df = df[["created_at", "entry_id", "field1", "field2", "field3"]]
        df.columns = ["時間", "編號", "土壤濕度", "空氣溫度", "空氣濕度"]

        # 🔹 關鍵修改：轉換時間格式為字串
        df["時間"] = df["時間"].dt.strftime("%Y-%m-%d %H:%M:%S")

        # 轉成 dict 列表
        result = df.to_dict(orient="records")
        return result

    except Exception as e:
        return {"error": str(e)}


if __name__ == "__main__":
    import json
    data = get_thingspeak_data()
    print(json.dumps(data, ensure_ascii=False, indent=2))