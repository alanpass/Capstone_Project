# 兩塊 ESP32 共用的函式：Wi-Fi、與 Supabase 同步（上傳數據＋取得門檻值）、選擇性備份到 ThingSpeak
# MicroPython 不支援 f-string 的舊版韌體（v1.17 以前），因此一律使用 .format()
import time

import network
import ujson
import urequests

import config

THINGSPEAK_URL = "https://api.thingspeak.com/update"


def connect_wifi(timeout=20):
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    if wlan.isconnected():
        return True
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


def _headers():
    headers = {"Content-Type": "application/json", "apikey": config.SUPABASE_KEY}
    # 舊版 anon key（eyJ 開頭的 JWT）需要同時放在 Authorization；新版 publishable key 不需要
    if config.SUPABASE_KEY.startswith("eyJ"):
        headers["Authorization"] = "Bearer " + config.SUPABASE_KEY
    return headers


def sync(current, soil=None, temperature=None, humidity=None):
    """上傳讀數（可只給部分欄位）到 Supabase，並取回使用者在網站設定的門檻值。
    失敗時沿用 current，讓裝置在斷網時仍能依上次的門檻運作。"""
    url = "{}/rest/v1/rpc/device_sync".format(config.SUPABASE_URL)
    body = {"p_token": config.DEVICE_TOKEN, "p_soil": soil, "p_temperature": temperature, "p_humidity": humidity}
    response = None
    try:
        response = urequests.post(url, data=ujson.dumps(body), headers=_headers())
        if response.status_code == 200:
            data = response.json()
            updated = {}
            for key in current:
                updated[key] = float(data.get(key, current[key]))
            print("同步成功，門檻值：{}".format(updated))
            return updated
        print("同步失敗（HTTP {}）：{}".format(response.status_code, response.text[:120]))
    except Exception as e:
        print("同步錯誤：{}，沿用舊門檻".format(e))
    finally:
        if response:
            response.close()
    return current


def backup_to_thingspeak(fields):
    """選擇性：同時把數據備份到 ThingSpeak（config.THINGSPEAK_WRITE_KEY 留空則略過）。
    fields 例如 {"field2": 26.5, "field3": 70}"""
    key = getattr(config, "THINGSPEAK_WRITE_KEY", "")
    if not key:
        return
    query = "&".join("{}={}".format(k, v) for k, v in fields.items())
    response = None
    try:
        response = urequests.get("{}?api_key={}&{}".format(THINGSPEAK_URL, key, query))
        entry = response.text.strip()
        # ThingSpeak 免費版 15 秒內只能寫入一次，超過會回傳 0
        print("ThingSpeak 備份{}（entry {}）".format("成功" if entry != "0" else "被限流", entry))
    except Exception as e:
        print("ThingSpeak 備份失敗：{}".format(e))
    finally:
        if response:
            response.close()
