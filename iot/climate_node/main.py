# ESP32 #1：DHT22 溫濕度 + 風扇、加熱兩組繼電器
# 接線：DHT22 DATA → GPIO23；風扇繼電器 IN → GPIO4；加熱（PTC）繼電器 IN → GPIO5
# 每分鐘把氣溫、空氣濕度同步到 Supabase，並取回這塊裝置的門檻值（網站「自動控制」可指定由哪一株植物的生長計畫控制）
import time

import dht
import machine

import common

DHT_PIN = 23
FAN_PIN = 4
HEATER_PIN = 5
RELAY_ON = 1                # 高電位觸發的繼電器模組；若是低電位觸發（IN 接 GND 才動作）改成 0
READ_INTERVAL = 60          # 秒：讀取感測器、同步、控制

sensor = dht.DHT22(machine.Pin(DHT_PIN))
fan = machine.Pin(FAN_PIN, machine.Pin.OUT, value=1 - RELAY_ON)
heater = machine.Pin(HEATER_PIN, machine.Pin.OUT, value=1 - RELAY_ON)


def set_relays(fan_on, heater_on):
    fan.value(RELAY_ON if fan_on else 1 - RELAY_ON)
    heater.value(RELAY_ON if heater_on else 1 - RELAY_ON)


def control(temp, thresholds):
    """溫度過高開風扇、過低開加熱片，回到範圍內兩者都關閉（兩者不會同時啟動）。
    回傳 (風扇狀態, 加熱狀態)，1 = 啟動、0 = 關閉，供 ThingSpeak 記錄。"""
    source = thresholds.get("plan") or "手動門檻"
    if temp > thresholds["tempMax"]:
        set_relays(True, False)
        print("溫度過高 {}°C > {}°C（{}），開風扇".format(temp, thresholds["tempMax"], source))
        return 1, 0
    if temp < thresholds["tempMin"]:
        set_relays(False, True)
        print("溫度過低 {}°C < {}°C（{}），開加熱".format(temp, thresholds["tempMin"], source))
        return 0, 1
    set_relays(False, False)
    print("溫度正常（{}~{}°C，{}），風扇與加熱關閉".format(thresholds["tempMin"], thresholds["tempMax"], source))
    return 0, 0


def main():
    while not common.connect_wifi():
        time.sleep(10)

    thresholds = {"tempMin": 20.0, "tempMax": 30.0, "humidMin": 40.0, "humidMax": 80.0}
    print("--- 溫控節點啟動 ---")

    while True:
        try:
            sensor.measure()
            temp, humi = round(sensor.temperature(), 1), round(sensor.humidity(), 1)
            print("溫度 {}°C、濕度 {}%".format(temp, humi))
            thresholds = common.sync(thresholds, temperature=temp, humidity=humi)
            fan, heater = control(temp, thresholds)
            # ThingSpeak 頻道欄位：field3 濕度、field4 溫度、field5 風扇狀態、field6 PTC 狀態
            common.backup_to_thingspeak({"field3": humi, "field4": temp, "field5": fan, "field6": heater})
        except OSError as e:
            print("讀取 DHT22 失敗：{}，關閉風扇與加熱".format(e))
            set_relays(False, False)  # 讀不到溫度時不要讓加熱片一直開著
            thresholds = common.sync(thresholds)  # 仍然更新門檻值
        if not common.connect_wifi(timeout=5):
            print("Wi-Fi 中斷，稍後重試")
        time.sleep(READ_INTERVAL)


main()
