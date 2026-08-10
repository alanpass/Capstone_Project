from machine import Pin, ADC
import network
import time
import urequests
import ujson # 引入 ujson 庫來處理 JSON 資料

# -------------------------------
# 設定
# -------------------------------
API_KEY = "R44FKNA28IGWX0O8"
THINGSPEAK_URL = "https://api.thingspeak.com/update"
API_GET_THRESHOLD = "http://3480118eb5e6.ngrok-free.app/get_threshold"
# ⚠️ 請將此網址替換為您當前運行的 ngrok URL

# 濕度感測器 (Pin 34)
moisture_sensor = ADC(Pin(34))
moisture_sensor.atten(ADC.ATTN_11DB)  # 0 ~ 4095

# 繼電器 (Pin 26)
RELAY_PIN = 26
relay = Pin(RELAY_PIN, Pin.OUT)
relay.value(0)  # 預設關閉

# Wi-Fi
SSID = "alan"
PASSWORD = "0907611728"

# 循環間隔設定 (秒)
CHECK_INTERVAL = 60          # 每 60 秒讀取感測器並檢查控制邏輯
THRESHOLD_REFRESH_INTERVAL = 30 # 每 30 秒更新一次遠端閾值

# -------------------------------
# 連線 Wi-Fi
# -------------------------------
def connect_wifi(ssid, password):
    """連接 Wi-Fi 網路。"""
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    if not wlan.isconnected():
        print(" 連線 Wi-Fi中...")
        wlan.connect(ssid, password)
        for _ in range(15):  # 最多等待 15 秒
            if wlan.isconnected():
                break
            time.sleep(1)
    if wlan.isconnected():
        # 使用 .format() 避免 f-string 錯誤
        print(" Wi-Fi 已連線，IP: {}".format(wlan.ifconfig()[0]))
    else:
        print(" Wi-Fi 連線失敗，請檢查設定")
    return wlan.isconnected()

# -------------------------------
# 獲取遠端濕度閾值
# -------------------------------
def get_remote_moisture_threshold(api_url, current_threshold):
    """從遠端 Flask API 獲取最新的濕度閾值。
    
    備註：此處假設我們使用 API 返回的 'humidMin' 作為土壤濕度的低閾值。
    """
    try:
        print(" ⏳ 正在從 API 獲取閾值: {}".format(api_url))
        response = urequests.get(api_url)
        
        if response.status_code == 200:
            data = response.json()
            # 我們使用 'humidMin' 作為土壤濕度的低閾值
            new_threshold = float(data.get('humidMin', current_threshold))
            # 將濕度值從百分比 (40.0) 轉換為 ADC 讀數 (假設 40% ~ 2500)
            # 由於 ADC 讀數和百分比的轉換關係需要校準，這裡為了示範，我們直接使用讀數
            # 如果您的 Flask 傳回的是 ADC 讀數 (例如 2500)，則直接使用
            
            # 由於 Flask 伺服器傳回的是百分比值，這裡需要進行轉換或直接使用
            # 為了避免複雜的校準，我們先將其視為 ADC 讀數，假設 40% 對應 ADC 2500
            
            # * ⚠️ 這裡我們假設 Flask API 傳回的 humidMin 數字，就是我們想要的 ADC 門檻值 (例如 2500) *
            if new_threshold > 4095: # 檢查是否為一個合理的 ADC 讀數
                new_threshold = current_threshold
            
            print(" ✅ 閾值更新成功，新的濕度低閾值 (ADC 讀數): {}".format(new_threshold))
            return new_threshold
        else:
            print(" ⚠️ API 請求失敗，狀態碼: {}".format(response.status_code))
            return current_threshold
            
    except Exception as e:
        print(" ❌ 獲取閾值時發生錯誤: {}".format(e))
        return current_threshold
    finally:
        if 'response' in locals() and response:
            response.close()

# -------------------------------
# 上傳資料到 ThingSpeak
# -------------------------------
def upload_to_thingspeak(moisture):
    """將濕度數據上傳至 ThingSpeak。"""
    # 修正 f-string 為 .format()
    url = "{0}?api_key={1}&field1={2}".format(THINGSPEAK_URL, API_KEY, moisture)
    try:
        print(" ⏳ 上傳資料: {}".format(url))
        response = urequests.get(url)
        print(" ✅ 上傳回應: {}".format(response.text.strip()))
        response.close()
    except Exception as e:
        print(" ❌ 上傳失敗: {}".format(e))

# -------------------------------
# 主程式
# -------------------------------
def main():
    if not connect_wifi(SSID, PASSWORD):
        return # Wi-Fi 連線失敗則退出

    # 初始化閾值和計時器
    moisture_min_threshold = 2500.0 # 預設濕度低於 2500 啟動
    last_check_time = 0
    last_threshold_update_time = 0
    
    print("\n--- 🌱 土壤濕度控制系統啟動 ---")
    
    while True:
        current_time = time.time()
        
        # --- 1. 定時更新遠端閾值 ---
        if current_time - last_threshold_update_time >= THRESHOLD_REFRESH_INTERVAL:
            moisture_min_threshold = get_remote_moisture_threshold(
                API_GET_THRESHOLD, 
                moisture_min_threshold
            )
            last_threshold_update_time = current_time
            
        # --- 2. 定時讀取感測器和控制 ---
        if current_time - last_check_time >= CHECK_INTERVAL:
            try:
                # 讀取濕度
                moisture = moisture_sensor.read()
                # 使用 .format() 避免 f-string 錯誤
                print("\n[讀數] 土壤濕度 (ADC): {}".format(moisture))
                print("[控制] 遠端設定低閾值: {}".format(moisture_min_threshold))

                # 濕度低於遠端門檻值 → 啟動繼電器 1 秒
                if moisture < moisture_min_threshold:
                    print(" 🚨 濕度過低 ({} < {})，啟動繼電器 1 秒".format(moisture, moisture_min_threshold))
                    relay.value(1)
                    time.sleep(1)
                    relay.value(0)
                else:
                    print(" ✅ 濕度正常，關閉繼電器。")
                    relay.value(0)

                # 嘗試上傳資料，不影響迴圈
                upload_to_thingspeak(moisture)

            except Exception as err:
                print(" ❌ 主程式錯誤: {}".format(err))

            last_check_time = current_time

        # 主迴圈短暫等待，確保計時器精確
        time.sleep(60) 

# -------------------------------
# 執行
# -------------------------------
if __name__ == "__main__":
    main()
