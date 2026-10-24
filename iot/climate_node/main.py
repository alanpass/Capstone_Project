# ESP32 #1：DHT22 溫濕度 + 風扇、加熱兩組繼電器
# 接線：DHT22 DATA → GPIO23；風扇繼電器 IN → GPIO5；加熱（PTC）繼電器 IN → GPIO4
# 每分鐘把氣溫、空氣濕度同步到 Supabase，並取回這塊裝置的門檻值（網站「自動控制」可指定由哪一株植物的生長計畫控制）
import time

import dht
import machine

import common

DHT_PIN = 23
FAN_PIN = 5
HEATER_PIN = 4
RELAY_ON = 1                # 高電位觸發的繼電器模組；若是低電位觸發（IN 接 GND 才動作）改成 0
READ_INTERVAL = 60          # 秒：讀取感測器、同步、控制

sensor = dht.DHT22(machine.Pin(DHT_PIN))
fan = machine.Pin(FAN_PIN, machine.Pin.OUT, value=1 - RELAY_ON)
heater = machine.Pin(HEATER_PIN, machine.Pin.OUT, value=1 - RELAY_ON)


def set_relays(relays):
    fan.value(RELAY_ON if relays["fan"] else 1 - RELAY_ON)
    heater.value(RELAY_ON if relays["heater"] else 1 - RELAY_ON)


def control(temp, thresholds):
    """溫度過高開風扇、過低開加熱片，回到範圍內兩者都關閉（兩者不會同時啟動）。
    回傳 (繼電器狀態, 說明)，狀態 1 = 啟動、0 = 關閉。"""
    source = thresholds.get("plan") or "手動門檻"
    if temp > thresholds["tempMax"]:
        relays, reason = {"fan": 1, "heater": 0}, "開風扇：{}°C 高於 {}°C（{}）".format(temp, thresholds["tempMax"], source)
    elif temp < thresholds["tempMin"]:
        relays, reason = {"fan": 0, "heater": 1}, "開加熱：{}°C 低於 {}°C（{}）".format(temp, thresholds["tempMin"], source)
    else:
        relays, reason = {"fan": 0, "heater": 0}, "關閉風扇與加熱：{}°C 在 {}~{}°C 之間（{}）".format(
            temp, thresholds["tempMin"], thresholds["tempMax"], source)
    set_relays(relays)
    print(reason)
    return relays, reason


def main():
    while not common.connect_wifi():
        time.sleep(10)

    thresholds = {"tempMin": 20.0, "tempMax": 30.0, "humidMin": 40.0, "humidMax": 80.0}
    relays = {"fan": 0, "heater": 0}
    print("--- 溫控節點啟動 ---")

    while True:
        try:
            sensor.measure()
            temp, humi = round(sensor.temperature(), 1), round(sensor.humidity(), 1)
            print("溫度 {}°C、濕度 {}%".format(temp, humi))
            thresholds = common.sync(thresholds, temperature=temp, humidity=humi,
                                     state=common.status("climate", relays))
            changed, reason = control(temp, thresholds)
            if changed != relays:
                # 繼電器狀態改變時立刻回報，網站的「裝置狀態」與控制紀錄就會更新
                relays = changed
                common.sync(thresholds, state=common.status("climate", relays), event=reason)
            # ThingSpeak 頻道欄位：field3 濕度、field4 溫度、field5 風扇狀態、field6 PTC 狀態
            common.backup_to_thingspeak({"field3": humi, "field4": temp, "field5": relays["fan"], "field6": relays["heater"]})
        except OSError as e:
            print("讀取 DHT22 失敗：{}，關閉風扇與加熱".format(e))
            event = None
            if relays["fan"] or relays["heater"]:
                relays = {"fan": 0, "heater": 0}
                set_relays(relays)  # 讀不到溫度時不要讓加熱片一直開著
                event = "感測器讀取失敗，關閉風扇與加熱"
            thresholds = common.sync(thresholds, state=common.status("climate", relays), event=event)
        if not common.connect_wifi(timeout=5):
            print("Wi-Fi 中斷，稍後重試")
        time.sleep(READ_INTERVAL)


main()
