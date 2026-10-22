# ESP32 #1：DHT22 溫濕度 + 控溫繼電器
# 接線：DHT22 DATA → GPIO23；繼電器 IN → GPIO5
# 每分鐘把氣溫、空氣濕度同步到 Supabase，並取回網站設定的門檻值（可選擇同時備份到 ThingSpeak）
import time

import dht
import machine

import common

DHT_PIN = 23
RELAY_PIN = 5
READ_INTERVAL = 60          # 秒：讀取感測器、同步、控制

sensor = dht.DHT22(machine.Pin(DHT_PIN))
relay = machine.Pin(RELAY_PIN, machine.Pin.OUT, value=0)


def control(temp, thresholds):
    """溫度超出範圍時啟動繼電器（接風扇或加熱燈），回到範圍內就關閉。"""
    if temp > thresholds["tempMax"]:
        relay.value(1)
        print("溫度過高 {}°C > {}°C，啟動繼電器".format(temp, thresholds["tempMax"]))
    elif temp < thresholds["tempMin"]:
        relay.value(1)
        print("溫度過低 {}°C < {}°C，啟動繼電器".format(temp, thresholds["tempMin"]))
    else:
        relay.value(0)
        print("溫度正常（{}~{}°C），關閉繼電器".format(thresholds["tempMin"], thresholds["tempMax"]))


def main():
    while not common.connect_wifi():
        time.sleep(10)

    thresholds = {"tempMin": 20.0, "tempMax": 30.0, "humidMin": 40.0, "humidMax": 80.0}
    print("--- 溫控節點啟動 ---")

    while True:
        try:
            sensor.measure()
            temp, humi = sensor.temperature(), sensor.humidity()
            print("溫度 {}°C、濕度 {}%".format(temp, humi))
            thresholds = common.sync(thresholds, temperature=temp, humidity=humi)
            control(temp, thresholds)
            common.backup_to_thingspeak({"field2": temp, "field3": humi})
        except OSError as e:
            print("讀取 DHT22 失敗：{}".format(e))
            thresholds = common.sync(thresholds)  # 仍然更新門檻值
        if not common.connect_wifi(timeout=5):
            print("Wi-Fi 中斷，稍後重試")
        time.sleep(READ_INTERVAL)


main()
