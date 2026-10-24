# ESP32 #2：電容式土壤濕度感測器 + 澆水繼電器（水泵）
# 接線：感測器 AOUT → GPIO34；繼電器 IN → GPIO26
# 每分鐘把土壤濕度（%）同步到 Supabase，並取回這塊裝置的澆水門檻（網站可指定由哪一株植物的生長計畫控制）
#
# 舊版直接上傳 ADC 原始值，並把網站的「濕度下限」當成 ADC 門檻，數值意義不一致。
# 新版在裝置端換算成百分比，網站上設定的 soilMin（%）可以直接比較。
import time

from machine import ADC, Pin

import common
import config

SOIL_PIN = 34
RELAY_PIN = 26
READ_INTERVAL = 60
PUMP_SECONDS = 1            # 每次澆水時間
SAMPLES = 10                # 取平均降低雜訊

sensor = ADC(Pin(SOIL_PIN))
sensor.atten(ADC.ATTN_11DB)  # 量測範圍 0~3.3V → 0~4095
pump = Pin(RELAY_PIN, Pin.OUT, value=0)


def read_soil_percent():
    raw = sum(sensor.read() for _ in range(SAMPLES)) / SAMPLES
    span = (config.SOIL_ADC_WET - config.SOIL_ADC_DRY) or 1
    percent = (raw - config.SOIL_ADC_DRY) / span * 100
    return raw, round(max(0, min(100, percent)), 1)


def water():
    pump.value(1)
    time.sleep(PUMP_SECONDS)
    pump.value(0)


def main():
    while not common.connect_wifi():
        time.sleep(10)

    thresholds = {"soilMin": 35.0}
    print("--- 土壤濕度節點啟動 ---")

    while True:
        try:
            raw, percent = read_soil_percent()
            thresholds = common.sync(thresholds, soil=percent)
            print("土壤濕度 {}%（ADC {}），門檻 {}%（{}）".format(
                percent, int(raw), thresholds["soilMin"], thresholds.get("plan") or "手動門檻"))
            watered = 0
            if percent < thresholds["soilMin"]:
                print("土壤偏乾，澆水 {} 秒".format(PUMP_SECONDS))
                water()
                watered = 1
            # ThingSpeak 頻道欄位：field1 土壤濕度、field2 馬達狀態
            common.backup_to_thingspeak({"field1": percent, "field2": watered})
        except Exception as e:
            pump.value(0)
            print("主程式錯誤：{}".format(e))
        if not common.connect_wifi(timeout=5):
            print("Wi-Fi 中斷，稍後重試")
        time.sleep(READ_INTERVAL)


main()
