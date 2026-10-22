# 兩塊 ESP32 共用的函式：Wi-Fi、讀取門檻值、上傳 ThingSpeak
# MicroPython 不支援 f-string 的舊版韌體（v1.17 以前），因此一律使用 .format()
import time

import network
import urequests

import config

THINGSPEAK_URL = "https://api.thingspeak.com/update"
# Firestore REST API：直接讀取 thresholds/{uid}，不需要任何自架伺服器
FIRESTORE_URL = "https://firestore.googleapis.com/v1/projects/{}/databases/(default)/documents/thresholds/{}?key={}"


def connect_wifi(timeout=20):
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    if not wlan.isconnected():
        print("連線 Wi-Fi：{}".format(config.WIFI_SSID))
        wlan.connect(config.WIFI_SSID, config.WIFI_PASSWORD)
        for _ in range(timeout):
            if wlan.isconnected():
                break
            time.sleep(1)
    if wlan.isconnected():
        print("Wi-Fi 已連線，IP：{}".format(wlan.ifconfig()[0]))
        return True
    print("Wi-Fi 連線失敗，請檢查 config.py")
    return False


def _firestore_number(field):
    # Firestore REST 回傳格式：{"doubleValue": 28.5} 或 {"integerValue": "28"}
    if "doubleValue" in field:
        return float(field["doubleValue"])
    if "integerValue" in field:
        return float(field["integerValue"])
    return None


def fetch_thresholds(current):
    """讀取使用者在網站「自動控制」頁設定的門檻值；失敗時沿用目前的值。"""
    url = FIRESTORE_URL.format(config.FIREBASE_PROJECT_ID, config.USER_UID, config.FIREBASE_WEB_API_KEY)
    response = None
    try:
        response = urequests.get(url)
        if response.status_code == 200:
            fields = response.json().get("fields", {})
            updated = {}
            for key in current:
                value = _firestore_number(fields.get(key, {}))
                updated[key] = value if value is not None else current[key]
            print("門檻值已更新：{}".format(updated))
            return updated
        if response.status_code == 404:
            print("網站尚未設定門檻值，使用預設：{}".format(current))
        else:
            print("取得門檻值失敗（HTTP {}），沿用：{}".format(response.status_code, current))
    except Exception as e:
        print("取得門檻值錯誤：{}，沿用舊值".format(e))
    finally:
        if response:
            response.close()
    return current


def upload(fields):
    """fields 例如 {"field2": 26.5, "field3": 70}"""
    query = "&".join("{}={}".format(k, v) for k, v in fields.items())
    url = "{}?api_key={}&{}".format(THINGSPEAK_URL, config.THINGSPEAK_WRITE_KEY, query)
    response = None
    try:
        response = urequests.get(url)
        entry = response.text.strip()
        # ThingSpeak 免費版 15 秒內只能寫入一次，超過會回傳 0
        print("ThingSpeak 上傳{}（entry {}）".format("成功" if entry != "0" else "被限流", entry))
    except Exception as e:
        print("上傳失敗：{}".format(e))
    finally:
        if response:
            response.close()
