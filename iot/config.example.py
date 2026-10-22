# 複製成 config.py 後填入實際值，再用 Thonny 一起上傳到 ESP32。
# config.py 已被 .gitignore 排除，請勿提交到 GitHub。

WIFI_SSID = "your-wifi"
WIFI_PASSWORD = "your-wifi-password"

# 後端 API（Render）與裝置金鑰（需與後端環境變數 DEVICE_API_KEY 相同）
API_BASE_URL = "https://two025-zhuan-ti.onrender.com"
DEVICE_API_KEY = "change-me"

# 網站「個人資料」頁顯示的使用者 ID，裝置會讀取這個使用者設定的門檻值
USER_UID = "your-firebase-uid"

# ThingSpeak 寫入金鑰（Channel → API Keys → Write API Key）
THINGSPEAK_WRITE_KEY = "your-write-key"

# 土壤濕度感測器校正：分別記錄「完全乾燥」與「泡在水中」時的 ADC 讀數
SOIL_ADC_DRY = 0
SOIL_ADC_WET = 1993
