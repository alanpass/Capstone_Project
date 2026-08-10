import network
import time
import urequests
import ujson
import machine
import dht

# ==========================================================
#                      ⚠️ 您的設定 ⚠️
# ==========================================================

# ----------- Wi-Fi 設定 (與您提供的相同) ------------
SSID = "alan"
PASSWORD = "0907611728"

# ----------- API 設定 (Flask ngrok 網址) ------------
# ⚠️ 請替換成您當前 ngrok 伺服器的公開網址
API_GET_THRESHOLD = "http://3480118eb5e6.ngrok-free.app/get_threshold"

# ----------- ThingSpeak 設定 ------------
API_KEY = "R44FKNA28IGWX0O8"
BASE_URL = "https://api.thingspeak.com/update"

# ----------- 腳位設定 ------------
# 繼電器 (Pin 5) 將用於溫度控制
RELAY_PIN = 5
relay = machine.Pin(RELAY_PIN, machine.Pin.OUT)
# DHT22 感測器 (Pin 23)
DHT_PIN = 23
dht_sensor = dht.DHT22(machine.Pin(DHT_PIN))

# ----------- 循環間隔設定 (秒) ------------
CHECK_INTERVAL = 60  # 每 60 秒讀取感測器並上傳 ThingSpeak
THRESHOLD_REFRESH_INTERVAL = 5 # 每 5 秒更新一次遠端閾值

# ==========================================================
#                     🛠️ 輔助函數
# ==========================================================

def connect_wifi(ssid, password):
    """連接 Wi-Fi 網路。"""
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    if not wlan.isconnected():
        # 修正 f-string
        print("嘗試連接到 Wi-Fi 網路: {}...".format(ssid))
        wlan.connect(ssid, password)
        # 等待連線
        timeout = 10
        while not wlan.isconnected():
            time.sleep(1)
            timeout -= 1
            if timeout <= 0:
                print("❌ Wi-Fi 連接失敗，請檢查 SSID/密碼。")
                return None
        # 修正 f-string
        print("✅ Wi-Fi 連接成功，IP: {}".format(wlan.ifconfig()[0]))
    return wlan

def get_remote_thresholds(api_url, current_thresholds):
    """從遠端伺服器獲取最新的閾值設定。"""
    try:
        # 修正 f-string
        print("⏳ 正在從 API 獲取閾值: {}".format(api_url))
        response = urequests.get(api_url)
        
        if response.status_code == 200:
            # 成功獲取，解析 JSON
            data = response.json()
            
            # 從 JSON 字典中提取並轉換為 float
            temp_max = float(data.get('tempMax', 30.0))
            temp_min = float(data.get('tempMin', 20.0))
            humid_max = float(data.get('humidMax', 70.0))
            humid_min = float(data.get('humidMin', 40.0))
            
            new_thresholds = {
                'tempMax': temp_max,
                'tempMin': temp_min,
                'humidMax': humid_max,
                'humidMin': humid_min
            }
            # 修正 f-string
            print("✅ 閾值更新成功: {}".format(new_thresholds))
            return new_thresholds
        else:
            # 修正 f-string
            print("⚠️ API 請求失敗，狀態碼: {}".format(response.status_code))
            print("   保留上次閾值: {}".format(current_thresholds))
            return current_thresholds
            
    except Exception as e:
        # 修正 f-string
        print("❌ 獲取閾值時發生錯誤: {}".format(e))
        print("   保留上次閾值: {}".format(current_thresholds))
        return current_thresholds
    finally:
        if 'response' in locals() and response:
            response.close()


def send_to_thingspeak(temp, humi):
    """將溫濕度數據上傳至 ThingSpeak。"""
    try:
        # 修正 f-string，改為單一的 .format() 呼叫
        url = "{0}?api_key={1}&field2={2}&field3={3}&status=ESP32_Running".format(
            BASE_URL, API_KEY, temp, humi
        )
        print("⏳ 正在上傳數據至 ThingSpeak...")
        response = urequests.get(url)
        
        if response.status_code == 200:
            # 修正 f-string
            print("✅ ThingSpeak 上傳成功，Entry ID: {}".format(response.text.strip()))
        else:
            # 修正 f-string
            print("❌ ThingSpeak 上傳失敗，狀態碼: {}".format(response.status_code))
            
    except Exception as e:
        # 修正 f-string
        print("❌ 上傳 ThingSpeak 時發生錯誤: {}".format(e))
    finally:
        if 'response' in locals() and response:
            response.close()

# ==========================================================
#                         主程序
# ==========================================================

def main():
    # 1. 初始化
    wlan = connect_wifi(SSID, PASSWORD)
    if not wlan:
        return # 退出程式

    # 設定預設閾值
    current_thresholds = {
        'tempMax': 30.0,
        'tempMin': 20.0,
        'humidMax': 70.0,
        'humidMin': 40.0
    }
    
    # 初始化計時器
    last_check_time = 0
    last_threshold_update_time = 0

    print("\n--- 🪴 溫控系統啟動 ---")
    
    while True:
        current_time = time.time()
        
        # --- 1. 定時更新遠端閾值 ---
        if current_time - last_threshold_update_time >= THRESHOLD_REFRESH_INTERVAL:
            current_thresholds = get_remote_thresholds(API_GET_THRESHOLD, current_thresholds)
            last_threshold_update_time = current_time

        # --- 2. 定時讀取感測器和控制 ---
        if current_time - last_check_time >= CHECK_INTERVAL:
            try:
                # 讀取 DHT22
                dht_sensor.measure()
                temp = dht_sensor.temperature()
                humi = dht_sensor.humidity()

                # 修正 f-string
                print("\n[讀數] 溫度: {0}°C, 濕度: {1}%".format(temp, humi))

                # --- 3. 執行繼電器控制 (基於溫度) ---
                tMax = current_thresholds['tempMax']
                tMin = current_thresholds['tempMin']
                
                if temp > tMax:
                    # 溫度過高，啟動降溫 (例如風扇)
                    relay.value(1) # 假設 1 是啟動 (常開繼電器)
                    # 修正 f-string
                    print("🚨 溫度過高 ({0}°C > {1}°C)，**啟動繼電器**。".format(temp, tMax))
                elif temp < tMin:
                    # 溫度過低，啟動加熱 (例如加熱燈)
                    relay.value(1) # 您可能需要不同的繼電器，這裡為示範
                    # 修正 f-string
                    print("🚨 溫度過低 ({0}°C < {1}°C)，**啟動繼電器**。".format(temp, tMin))
                else:
                    # 溫度在範圍內，關閉繼電器
                    relay.value(0)
                    # 修正 f-string
                    print("✅ 溫度正常 ({0}°C ~ {1}°C)，關閉繼電器。".format(tMin, tMax))
                    
                # --- 4. 上傳數據到 ThingSpeak ---
                send_to_thingspeak(temp, humi)

            except OSError as e:
                # 修正 f-string
                print("❌ 讀取 DHT22 感測器失敗: {}".format(e))
            except Exception as e:
                # 修正 f-string
                print("❌ 程式發生錯誤: {}".format(e))
                
            last_check_time = current_time

        time.sleep(1) # 主迴圈等待 1 秒
        
if __name__ == "__main__":
    main()



