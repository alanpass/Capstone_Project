# 複製成 config.py 後填入實際值，再用 Thonny 一起上傳到 ESP32。
# config.py 已被 .gitignore 排除，請勿提交到 GitHub。

WIFI_SSID = "your-wifi"
WIFI_PASSWORD = "your-wifi-password"

# Supabase 專案（與 frontend/assets/js/config.js 相同，屬於公開設定）
SUPABASE_URL = "https://pgxfytfwpgyyyklpzwcn.supabase.co"
SUPABASE_KEY = "sb_publishable_xn72aTtTth-NPPEKGFJ0NA_bOHBl_BM"

# 網站「自動控制」頁 →「我的裝置」中這塊 ESP32 的權杖（每塊裝置各一組）：
# 裝置用它上傳數據，並讀取你為它指定的門檻（手動門檻或某株植物的生長計畫）
DEVICE_TOKEN = "00000000-0000-0000-0000-000000000000"

# 選填：同時備份到 ThingSpeak（Channel 3018608 → API Keys → Write API Key），留空則不備份
# 欄位：field1 土壤濕度、field2 馬達狀態、field3 濕度、field4 溫度、field5 風扇狀態、field6 PTC 狀態
THINGSPEAK_WRITE_KEY = ""

# 土壤濕度感測器校正：分別記錄「完全乾燥」與「泡在水中」時的 ADC 讀數
SOIL_ADC_DRY = 0
SOIL_ADC_WET = 1993
