from flask import Flask, jsonify, request
from flask_cors import CORS
import catch1
import firebase_admin
from firebase_admin import credentials, firestore
import requests
import os
import urllib3
import pymysql
import subprocess
import atexit
import time
from datetime import datetime, date

# 關閉 SSL 警告
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# 設定 Google Cloud 憑證
os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = r"C:\Users\hsu41\Downloads\main\.vscode\專題\second-metrics-472612-d2-fc4bcefa9ea6.json"

# ============================================
# Cloud SQL Proxy 管理
# ============================================
proxy_process = None

def start_proxy():
    """啟動 Cloud SQL Proxy"""
    global proxy_process
    proxy_path = r"C:\Users\hsu41\Downloads\main\.vscode\專題\cloud_sql_proxy.exe"
    connection_name = "second-metrics-472612-d2:asia-east1:plant"
    
    print("=" * 60)
    print("🚀 正在啟動 Cloud SQL Proxy...")
    print("=" * 60)
    
    proxy_process = subprocess.Popen(
        [proxy_path, "--port", "3306", connection_name],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=subprocess.CREATE_NO_WINDOW
    )
    
    time.sleep(3)
    print("✅ Cloud SQL Proxy 已啟動 (Port 3306)")
    print()

def stop_proxy():
    """停止 Cloud SQL Proxy"""
    global proxy_process
    if proxy_process:
        print("\n🔌 正在關閉 Cloud SQL Proxy...")
        proxy_process.terminate()
        proxy_process.wait()
        print("✅ Proxy 已關閉")

atexit.register(stop_proxy)

# ============================================
# Flask 應用程式設定
# ============================================
app = Flask(__name__)
CORS(app)

# Firebase 初始化
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FIREBASE_CERT = os.path.join(BASE_DIR, "plantai-cac82-firebase-adminsdk-fbsvc-9cc813ae60.json")

if not os.path.exists(FIREBASE_CERT):
    raise FileNotFoundError(f"找不到 Firebase 憑證檔案:{FIREBASE_CERT}")

cred = credentials.Certificate(FIREBASE_CERT)
firebase_admin.initialize_app(cred)
db = firestore.client()

# 氣象局 API KEY
CWB_API_KEY = "CWA-6B550E8E-C837-4BA3-92D7-AFAF1964B82F"

# Google Cloud SQL 設定
DB_CONFIG = {
    "host": "127.0.0.1",
    "user": "root",
    "password": "c+A$R5]JF:H4;{Mo",
    "database": "plants_info",
    "port": 3306
}

# ============================================
# API 路由
# ============================================

@app.route("/", methods=["GET"])
def home():
    return """
    <h1>🌱 智慧種植規劃系統 API</h1>
    <p>後端正在運行中!</p>
    <ul>
        <li><a href="/get-sensor">感測器資料</a></li>
        <li><a href="/get-address">地址與天氣資料</a></li>
        <li><a href="/get-users">所有使用者列表</a></li>
        <li><a href="/get-plant-info?plant_name=草莓">植物資訊查詢</a></li>
        <li><a href="/get-daily-plan?user_id=ZrvCRtgp9AdeBykK1kXGhnBQmlT2">今日計畫</a></li>
    </ul>
    <p>請開啟 <code>new.html</code> 使用完整功能</p>
    """

@app.route("/get-plant-info", methods=["GET"])
def get_plant_info():
    """從 Google Cloud SQL 查詢植物資訊"""
    try:
        plant_name = request.args.get("plant_name", "")
        
        if not plant_name:
            return jsonify({"error": "請提供植物名稱"})
        
        conn = pymysql.connect(**DB_CONFIG)
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        
        query = """
            SELECT plant_name, description, resilience, care_level
            FROM plant_care
            WHERE plant_name LIKE %s
            LIMIT 1
        """
        
        cursor.execute(query, (f"%{plant_name}%",))
        result = cursor.fetchone()
        
        cursor.close()
        conn.close()
        
        if result:
            return jsonify({
                "found": True,
                "data": result
            })
        else:
            return jsonify({
                "found": False,
                "message": f"資料庫中找不到「{plant_name}」的資訊"
            })
            
    except Exception as e:
        return jsonify({"error": str(e)})

@app.route("/get-sensor", methods=["GET"])
def get_sensor():
    """取得並清理感測器數據"""
    try:
        raw_data = catch1.get_thingspeak_data()
        
        if isinstance(raw_data, dict) and "error" in raw_data:
            return jsonify({"error": raw_data["error"]})
        
        cleaned_data = []
        for item in raw_data:
            soil_moisture_raw = item.get('土壤濕度')
            air_temp_raw = item.get('空氣溫度')
            air_humidity_raw = item.get('空氣濕度')
            
            has_valid_data = False
            
            try:
                result = {
                    '時間': item.get('時間', '未知'),
                    '編號': item.get('編號', '')
                }
                
                # 處理土壤濕度
                if soil_moisture_raw is not None and soil_moisture_raw != '':
                    soil_moisture = float(soil_moisture_raw)
                    
                    if soil_moisture > 100:
                        DRY_VALUE = 0
                        WET_VALUE = 1993
                        soil_moisture = max(DRY_VALUE, min(WET_VALUE, soil_moisture))
                        soil_moisture = ((soil_moisture - DRY_VALUE) / (WET_VALUE - DRY_VALUE)) * 100
                        soil_moisture = max(0, min(100, soil_moisture))
                    
                    if 0 <= soil_moisture <= 100:
                        result['土壤濕度'] = round(soil_moisture, 1)
                        has_valid_data = True
                    else:
                        result['土壤濕度'] = None
                else:
                    result['土壤濕度'] = None
                
                # 處理空氣溫度
                if air_temp_raw is not None and air_temp_raw != '':
                    air_temp = float(air_temp_raw)
                    if -50 <= air_temp <= 60:
                        result['空氣溫度'] = round(air_temp, 1)
                        has_valid_data = True
                    else:
                        result['空氣溫度'] = None
                else:
                    result['空氣溫度'] = None
                
                # 處理空氣濕度
                if air_humidity_raw is not None and air_humidity_raw != '':
                    air_humidity = float(air_humidity_raw)
                    
                    if air_humidity > 100:
                        if air_humidity > 1000:
                            air_humidity = (air_humidity / 4095) * 100
                        else:
                            air_humidity = air_humidity / 100
                        if air_humidity > 100:
                            air_humidity = min(air_humidity / 10, 100)
                    
                    if 0 <= air_humidity <= 100:
                        result['空氣濕度'] = round(air_humidity, 1)
                        has_valid_data = True
                    else:
                        result['空氣濕度'] = None
                else:
                    result['空氣濕度'] = None
                
                if has_valid_data:
                    cleaned_data.append(result)
                    
            except (ValueError, TypeError) as e:
                print(f"數據轉換失敗: {e}, 原始數據: {item}")
                continue
        
        if not cleaned_data:
            return jsonify([])
        
        return jsonify(cleaned_data)
        
    except Exception as e:
        return jsonify({"error": str(e)})

@app.route("/get-users", methods=["GET"])
def get_users():
    """列出所有使用者"""
    try:
        users_ref = db.collection("users")
        docs = users_ref.stream()
        
        users_list = []
        for doc in docs:
            user_data = doc.to_dict()
            users_list.append({
                "id": doc.id,
                "address": user_data.get("Address", "未設定地址"),
                "name": user_data.get("Name", "未命名")
            })
        
        return jsonify(users_list)
    except Exception as e:
        return jsonify({"error": str(e)})

@app.route("/get-address", methods=["GET"])
def get_address_weather():
    """取得使用者地址與天氣資訊"""
    try:
        user_id = request.args.get("user_id", "ZrvCRtgp9AdeBykK1kXGhnBQmlT2")
        
        doc = db.collection("users").document(user_id).get()
        if not doc.exists:
            return jsonify({"error": f"找不到使用者:{user_id}"})

        user_data = doc.to_dict()
        
        full_address = (
            user_data.get("Address") or 
            user_data.get("address") or 
            user_data.get("地址") or 
            "高雄市"
        )
        
        # 台灣縣市列表
        cities = [
            "臺北市", "台北市", "新北市", "桃園市", "臺中市", "台中市", 
            "臺南市", "台南市", "高雄市", "基隆市", "新竹市", "嘉義市",
            "新竹縣", "苗栗縣", "彰化縣", "南投縣", "雲林縣", "嘉義縣",
            "屏東縣", "宜蘭縣", "花蓮縣", "臺東縣", "台東縣", "澎湖縣",
            "金門縣", "連江縣"
        ]
        
        city_name = "高雄市"
        for city in cities:
            if city in full_address:
                city_name = city
                break

        # 查詢氣象局天氣
        url = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001"
        params = {"format": "JSON", "locationName": city_name}
        headers = {"Authorization": CWB_API_KEY}

        session = requests.Session()
        session.verify = False
        res = session.get(url, params=params, headers=headers, timeout=10)
        
        if res.status_code != 200:
            return jsonify({
                "address": full_address,
                "city": city_name,
                "error": f"氣象局 API 回應錯誤 (狀態碼: {res.status_code})"
            })
        
        data = res.json()

        if not data.get("records") or not data["records"].get("location"):
            return jsonify({
                "address": full_address,
                "city": city_name,
                "weather": "查無資料"
            })

        loc = data["records"]["location"][0]
        weather_elements = loc["weatherElement"]
        
        wx_element = next((e for e in weather_elements if e["elementName"] == "Wx"), None)
        pop_element = next((e for e in weather_elements if e["elementName"] == "PoP"), None)
        mint_element = next((e for e in weather_elements if e["elementName"] == "MinT"), None)
        maxt_element = next((e for e in weather_elements if e["elementName"] == "MaxT"), None)
        ci_element = next((e for e in weather_elements if e["elementName"] == "CI"), None)
        
        wx = wx_element["time"][0]["parameter"]["parameterName"] if wx_element else "未知"
        pop = pop_element["time"][0]["parameter"]["parameterName"] if pop_element else "未知"
        minT = mint_element["time"][0]["parameter"]["parameterName"] if mint_element else "未知"
        maxT = maxt_element["time"][0]["parameter"]["parameterName"] if maxt_element else "未知"
        ci = ci_element["time"][0]["parameter"]["parameterName"] if ci_element else "未知"

        weather_info = {
            "完整地址": full_address,
            "查詢縣市": city_name,
            "天氣": wx,
            "溫度範圍": f"{minT}°C ~ {maxT}°C",
            "體感": ci,
            "降雨機率": f"{pop}%"
        }

        return jsonify({
            "address": full_address,
            "city": city_name,
            "weather": weather_info
        })

    except Exception as e:
        return jsonify({"error": str(e)})

# ============================================
# 新增:種植記錄管理
# ============================================

@app.route("/save-planting-record", methods=["POST"])
def save_planting_record():
    """儲存種植記錄到 Firebase"""
    try:
        data = request.get_json()
        
        user_id = data.get('user_id')
        plant_name = data.get('plant_name')
        start_date = data.get('start_date', str(date.today()))
        total_days = data.get('total_days', 90)
        
        if not user_id or not plant_name:
            return jsonify({"error": "缺少必要欄位"})
        
        # 儲存到 Firebase
        planting_ref = db.collection("planting_records").document(user_id)
        planting_ref.set({
            "plant_name": plant_name,
            "start_date": start_date,
            "total_days": total_days,
            "created_at": datetime.utcnow().isoformat()
        })
        
        return jsonify({
            "success": True,
            "message": "種植記錄已儲存",
            "data": {
                "plant_name": plant_name,
                "start_date": start_date,
                "total_days": total_days
            }
        })
        
    except Exception as e:
        return jsonify({"error": str(e)})

def get_stage_tasks(stage_name, day_number, plant_name):
    """根據階段返回任務建議"""
    stages = {
        "種植期": [
            "整地並翻土",
            "施加基礎肥料",
            "準備種植材料",
            f"將{plant_name}種下並澆水"
        ],
        "成長期": [
            "每日觀察生長狀況",
            "保持土壤濕潤",
            "清除周圍雜草",
            "檢查是否有病蟲害跡象"
        ],
        "開花期": [
            "增加澆水頻率",
            "施加開花期專用肥料",
            "協助授粉(如需要)",
            "防治病蟲害",
            "適度修剪枝葉"
        ],
        "結果期": [
            "觀察果實發育情況",
            "調整水分供給",
            "支撐較重的果實",
            "準備採收工具",
            "記錄成長數據"
        ],
        "收成期": [
            "準備採收",
            f"將成熟的{plant_name}採收",
            "整理種植區域",
            "規劃下一期種植"
        ]
    }
    
    return stages.get(stage_name, ["今日無特殊任務"])

@app.route("/get-daily-plan", methods=["GET"])
def get_daily_plan():
    """取得今日種植計畫 - 優化版"""
    try:
        user_id = request.args.get('user_id')
        
        if not user_id:
            return jsonify({"error": "缺少 user_id 參數"})
        
        # 1. 從 Firebase 取得種植記錄
        planting_ref = db.collection("planting_records").document(user_id)
        planting_doc = planting_ref.get()
        
        if not planting_doc.exists:
            return jsonify({"error": "找不到種植記錄,請先生成計畫"})
        
        planting_data = planting_doc.to_dict()
        plant_name = planting_data['plant_name']
        start_date_str = planting_data['start_date']
        total_days = planting_data['total_days']
        
        # 2. 計算今天是第幾天
        start_date = datetime.strptime(start_date_str, "%Y-%m-%d").date()
        today = date.today()
        day_number = (today - start_date).days + 1
        
        if day_number < 1:
            return jsonify({"error": "種植日期尚未開始"})
        
        # 3. 判斷當前階段
        if day_number <= 7:
            current_stage = "種植期"
        elif day_number <= 30:
            current_stage = "成長期"
        elif day_number <= 60:
            current_stage = "開花期"
        elif day_number <= 90:
            current_stage = "結果期"
        else:
            current_stage = "收成期"
        
        # 4. 取得該階段的任務
        daily_tasks = get_stage_tasks(current_stage, day_number, plant_name)
        
        # 5. 取得天氣資料
        try:
            weather_res = requests.get(f"http://127.0.0.1:5001/get-address?user_id={user_id}", timeout=5)
            weather_data = weather_res.json()
            weather_info = weather_data.get('weather', {})
        except:
            weather_info = {}
        
        # 6. 取得感測器數據
        try:
            sensor_res = requests.get("http://127.0.0.1:5001/get-sensor", timeout=5)
            sensor_data = sensor_res.json()
            if not isinstance(sensor_data, list):
                sensor_data = []
        except:
            sensor_data = []
        
        # 7. 計算進度
        progress = round((day_number / total_days) * 100, 1)
        
        # 8. 返回完整資料
        return jsonify({
            "success": True,
            "plant_name": plant_name,
            "day": day_number,
            "total_days": total_days,
            "date": str(today),
            "current_stage": current_stage,
            "daily_tasks": daily_tasks,
            "progress": progress,
            "weather": weather_info,
            "sensor_data": sensor_data
        })
        
    except Exception as e:
        print(f"錯誤詳情: {str(e)}")
        return jsonify({"error": str(e)})

# ============================================
# 主程式入口
# ============================================
if __name__ == "__main__":
    print("\n")
    print("=" * 60)
    print("🌱 智慧種植規劃系統")
    print("=" * 60)
    print()
    
    # 先啟動 Cloud SQL Proxy
    start_proxy()
    
    # 再啟動 Flask
    try:
        print("🌐 正在啟動 Flask 伺服器...")
        print("=" * 60)
        app.run(host="0.0.0.0", port=5001, debug=True, use_reloader=False)
    except KeyboardInterrupt:
        print("\n\n⏹️  停止伺服器...")
    finally:
        stop_proxy()
        print("\n✅ 系統已完全關閉\n")