from flask import Flask, jsonify, request
from flask_cors import CORS
import catch1
import firebase_admin
from firebase_admin import credentials, firestore
import requests
import os
import urllib3
from datetime import datetime, date
import sys 
import json 

# 關閉 SSL 警告
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ============================================
# Flask 應用程式設定
# ============================================
app = Flask(__name__)
# ✅ 全域 CORS 設定 (允許所有來源，解決跨域問題)
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)

# Firebase 初始化
# ⚠️ 請確保此 JSON 檔案在您的專案目錄下
FIREBASE_CERT_FILENAME = "plantai-cac82-firebase-adminsdk-fbsvc-9cc813ae60.json"
FIREBASE_CERT_PATH = os.path.join(sys.path[0], FIREBASE_CERT_FILENAME)

try:
    cred = credentials.Certificate(FIREBASE_CERT_PATH)
    firebase_admin.initialize_app(cred)
    db = firestore.client()
except Exception as e:
    print(f"致命錯誤：Firebase 憑證載入失敗: {e}", file=sys.stderr)
    # 若初始化失敗不強制 crash，但後續 DB 操作會報錯
    pass

# API 金鑰
CWB_API_KEY = "CWA-6B550E8E-C837-4BA3-92D7-AFAF1964B82F"
GEMINI_API_KEY = "AIzaSyD9ml9FNte--1fK66tP01oNoqQvqE-re9E" 

# ============================================
# API 路由
# ============================================

@app.route("/", methods=["GET"])
def home():
    return """
    <h1>🌱 智慧種植規劃系統 API (v4.0 Multi-Plant Support)</h1>
    <p>後端正在運行中!</p>
    <ul>
        <li><a href="/get-sensor">感測器資料</a></li>
        <li><a href="/get-address">地址與天氣資料</a></li>
        <li><a href="/get-users">所有使用者列表</a></li>
        <li><a href="/call-gemini-proxy">測試 Proxy</a></li>
    </ul>
    """

# =================================================================
# ✅ Gemini Proxy (解決 CORS 與 Key 安全問題)
# =================================================================
@app.route("/call-gemini-proxy", methods=["POST", "OPTIONS"])
def call_gemini_proxy():
    # 1. 手動處理 OPTIONS 預檢請求
    if request.method == "OPTIONS":
        response = jsonify({"status": "preflight_ok"})
        response.headers.add("Access-Control-Allow-Origin", "*")
        response.headers.add("Access-Control-Allow-Headers", "*")
        response.headers.add("Access-Control-Allow-Methods", "POST, OPTIONS")
        return response

    # 2. 處理實際 POST 請求
    try:
        data = request.get_json()
        prompt = data.get('prompt')
        use_structured_output = data.get('structured', False) 
        schema = data.get('schema') 
        
        if not prompt: return jsonify({"error": "缺少 prompt"}), 400
        
        # 🚨 使用 gemini-2.0-flash
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GEMINI_API_KEY}"
        
        payload = { "contents": [{"parts": [{"text": prompt}]}] }
        
        if use_structured_output and schema:
             payload["generationConfig"] = {
                 "responseMimeType": "application/json",
                 "responseSchema": schema
             }

        session = requests.Session()
        session.verify = False 
        res = session.post(url, json=payload, timeout=30)
        
        if res.status_code != 200:
            return jsonify({"error": f"Gemini API 錯誤 ({res.status_code}): {res.text}"}), res.status_code

        gemini_data = res.json()
        try:
            ai_text = gemini_data['candidates'][0]['content']['parts'][0]['text']
        except (KeyError, IndexError):
            ai_text = "(AI 無法生成回應)"

        if use_structured_output:
             try:
                 final_result = json.loads(ai_text)
             except:
                 final_result = ai_text
        else:
            final_result = ai_text

        response = jsonify({"success": True, "result": final_result})
        response.headers.add("Access-Control-Allow-Origin", "*")
        return response

    except Exception as e:
        err_resp = jsonify({"error": str(e)})
        err_resp.headers.add("Access-Control-Allow-Origin", "*")
        return err_resp, 500

# =================================================================
# ✅ 植物與使用者資料 API (CRUD)
# =================================================================

@app.route("/get-my-plants", methods=["GET"])
def get_my_plants():
    try:
        user_id = request.args.get('user_id')
        if not user_id: return jsonify({"error": "缺少 user_id"})

        # 從 users/{uid}/plants 子集合抓取所有文件
        plants_ref = db.collection("users").document(user_id).collection("plants")
        docs = plants_ref.stream()

        plant_list = []
        today = date.today()

        for doc in docs:
            data = doc.to_dict()
            try:
                start_date = datetime.strptime(data['start_date'], "%Y-%m-%d").date()
                total_days = int(data.get('total_days', 90))
                
                # 計算今天是第幾天
                current_day = (today - start_date).days + 1
                
                # 計算進度百分比
                progress = round((current_day / total_days) * 100, 1)
                progress = max(0, min(100, progress))

                # 判斷階段
                if current_day <= 0: stage = "尚未開始"
                elif current_day <= 7: stage = "種植期"
                elif current_day <= total_days * 0.33: stage = "成長期"
                elif current_day <= total_days * 0.66: stage = "開花期"
                elif current_day <= total_days: stage = "結果期"
                else: stage = "已結束"

            except:
                current_day = 0
                progress = 0
                stage = "數據異常"

            plant_list.append({
                "id": doc.id,
                "plant_name": data.get('plant_name', '未命名'),
                "start_date": data.get('start_date'),
                "total_days": total_days,
                "current_day": current_day,
                "progress": progress,
                "current_stage": stage
            })

        # 依日期倒序
        plant_list.sort(key=lambda x: x['start_date'] or '', reverse=True)

        return jsonify({
            "success": True,
            "plants": plant_list
        })

    except Exception as e:
        return jsonify({"error": str(e)})

@app.route("/save-planting-record", methods=["POST"])
def save_planting_record():
    try:
        data = request.get_json()
        user_id = data.get('user_id')
        plant_name = data.get('plant_name')
        if not user_id or not plant_name: return jsonify({"error": "缺少必要欄位"})
        
        record_data = {
            "plant_name": plant_name,
            "start_date": data.get('start_date', str(date.today())),
            "total_days": data.get('total_days', 90),
            "created_at": datetime.utcnow().isoformat()
        }

        # 1. 舊邏輯：覆蓋 "當前正在種植" (為了相容性保留)
        db.collection("planting_records").document(user_id).set(record_data)

        # 2. 新邏輯：新增到 "我的植物列表"
        db.collection("users").document(user_id).collection("plants").add(record_data)

        return jsonify({"success": True, "message": "種植記錄已儲存並加入花園"})
    except Exception as e:
        return jsonify({"error": str(e)})

# 🔥 刪除植物 API
@app.route("/delete-plant", methods=["POST", "OPTIONS"])
def delete_plant():
    if request.method == "OPTIONS":
        response = jsonify({"status": "preflight_ok"})
        response.headers.add("Access-Control-Allow-Origin", "*")
        response.headers.add("Access-Control-Allow-Headers", "*")
        response.headers.add("Access-Control-Allow-Methods", "POST, OPTIONS")
        return response

    try:
        data = request.get_json()
        user_id = data.get('user_id')
        plant_id = data.get('plant_id')

        if not user_id or not plant_id:
            return jsonify({"error": "缺少 user_id 或 plant_id"}), 400

        # 刪除指定的文件
        db.collection("users").document(user_id).collection("plants").document(plant_id).delete()

        response = jsonify({"success": True, "message": "植物已刪除"})
        response.headers.add("Access-Control-Allow-Origin", "*")
        return response

    except Exception as e:
        err_resp = jsonify({"error": str(e)})
        err_resp.headers.add("Access-Control-Allow-Origin", "*")
        return err_resp, 500

# =================================================================
# 既有路由 (Weather, Sensor, Users...)
# =================================================================

@app.route("/get-plant-info", methods=["GET"])
def get_plant_info():
    try:
        plant_name = request.args.get("plant_name", "")
        if not plant_name: return jsonify({"error": "請提供植物名稱"})
        
        docs = db.collection("plants").where("plant_name", "==", plant_name).limit(1).stream()
        doc = next(docs, None)
        
        if doc: return jsonify({"found": True, "data": doc.to_dict()})
        else: return jsonify({"found": False, "message": f"找不到「{plant_name}」的文件"})
    except Exception as e: return jsonify({"error": str(e)})

@app.route("/get-sensor", methods=["GET"])
def get_sensor():
    try:
        raw_data = catch1.get_thingspeak_data() 
        if isinstance(raw_data, dict) and "error" in raw_data:
            return jsonify({"error": raw_data["error"]})
        
        cleaned_data = []
        for item in raw_data:
            try:
                soil_moisture = float(item.get('土壤濕度', 0) or 0)
                if soil_moisture > 100: soil_moisture = 100
                
                cleaned_data.append({
                    '時間': item.get('時間', '未知'),
                    '土壤濕度': round(soil_moisture, 1),
                    '空氣溫度': round(float(item.get('空氣溫度', 0) or 0), 1),
                    '空氣濕度': round(float(item.get('空氣濕度', 0) or 0), 1)
                })
            except: continue
        return jsonify(cleaned_data)
    except Exception as e: return jsonify({"error": str(e)})

@app.route("/get-users", methods=["GET"])
def get_users():
    try:
        docs = db.collection("users").stream()
        return jsonify([{"id": d.id, "address": d.to_dict().get("Address"), "name": d.to_dict().get("Name")} for d in docs])
    except Exception as e: return jsonify({"error": str(e)})

@app.route("/get-address", methods=["GET"])
def get_address_weather():
    try:
        user_id = request.args.get("user_id", "ZrvCRtgp9AdeBykK1kXGhnBQmlT2")
        doc = db.collection("users").document(user_id).get()
        if not doc.exists: return jsonify({"error": f"找不到使用者:{user_id}"})

        user_data = doc.to_dict()
        full_address = user_data.get("Address") or user_data.get("address") or user_data.get("地址") or "高雄市"
        city_name = "高雄市"
        for city in ["臺北市", "台北市", "新北市", "桃園市", "臺中市", "台中市", "臺南市", "台南市", "高雄市", "基隆市", "新竹市", "嘉義市", "新竹縣", "苗栗縣", "彰化縣", "南投縣", "雲林縣", "嘉義縣", "屏東縣", "宜蘭縣", "花蓮縣", "臺東縣", "台東縣", "澎湖縣", "金門縣", "連江縣"]:
            if city in full_address: city_name = city; break

        url = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001"
        headers = {"Authorization": CWB_API_KEY}
        session = requests.Session(); session.verify = False
        res = session.get(url, params={"format": "JSON", "locationName": city_name}, headers=headers, timeout=10)
        data = res.json()
        if not data.get("records"): return jsonify({"address": full_address, "city": city_name, "weather": "查無資料"})
        els = data["records"]["location"][0]["weatherElement"]
        def g(n): e=next((x for x in els if x["elementName"]==n),None); return e["time"][0]["parameter"]["parameterName"] if e else "?"
        return jsonify({
            "address": full_address, "city": city_name,
            "weather": {"完整地址": full_address, "查詢縣市": city_name, "天氣": g("Wx"), "溫度範圍": f"{g('MinT')}~{g('MaxT')}°C", "體感": g("CI"), "降雨機率": f"{g('PoP')}%"}
        })
    except Exception as e: return jsonify({"error": str(e)})

def get_stage_tasks(stage_name, day, plant_name):
    stages = { "種植期": ["整地", "施肥"], "成長期": ["澆水", "除草"], "開花期": ["施肥", "授粉"], "結果期": ["支撐果實"], "收成期": ["採收"] }
    return stages.get(stage_name, ["日常照護"])

# =================================================================
# 🔥 重點修改：支援植物切換的 get-daily-plan
# =================================================================
@app.route("/get-daily-plan", methods=["GET"])
def get_daily_plan():
    try:
        user_id = request.args.get('user_id')
        target_plant_name = request.args.get('plant_name') # ✅ 接收前端傳來的名字

        if not user_id: return jsonify({"error": "缺少 user_id"})

        data = None

        # 1. 如果有指定植物名稱，去「我的植物列表」搜尋
        if target_plant_name:
            plants_ref = db.collection("users").document(user_id).collection("plants")
            docs = plants_ref.where("plant_name", "==", target_plant_name).limit(1).stream()
            found_doc = next(docs, None)
            if found_doc:
                data = found_doc.to_dict()
            else:
                return jsonify({"error": f"找不到名為「{target_plant_name}」的種植記錄，請確認名稱是否正確。"})

        # 2. 如果沒指定 (或上面沒找到)，就抓取「預設/最新」的記錄
        if not data:
            doc = db.collection("planting_records").document(user_id).get()
            if doc.exists:
                data = doc.to_dict()
            else:
                # 嘗試去 plants 列表抓最新的一筆
                plants_ref = db.collection("users").document(user_id).collection("plants")
                docs = plants_ref.order_by("created_at", direction=firestore.Query.DESCENDING).limit(1).stream()
                found_doc = next(docs, None)
                if found_doc:
                    data = found_doc.to_dict()
                else:
                    return jsonify({"error": "找不到任何種植記錄，請先建立新規劃"})

        # 3. 計算天數與階段
        start_date = datetime.strptime(data['start_date'], "%Y-%m-%d").date()
        total_days = int(data.get('total_days', 90))
        day_number = (date.today() - start_date).days + 1
        
        if day_number <= 7: stage = "種植期"
        elif day_number <= total_days * 0.33: stage = "成長期"
        elif day_number <= total_days * 0.66: stage = "開花期"
        elif day_number <= total_days: stage = "結果期"
        else: stage = "收成期"

        # 4. 取得天氣與感測器 (Context)
        weather_info = {}
        try:
            with app.test_request_context(f'/get-address?user_id={user_id}'):
                w_res = get_address_weather()
                if w_res.status_code == 200: weather_info = w_res.get_json().get('weather', {})
        except: pass

        sensor_data = []
        try:
            with app.test_request_context('/get-sensor'):
                s_res = get_sensor()
                if s_res.status_code == 200: sensor_data = s_res.get_json()
        except: pass

        tasks = get_stage_tasks(stage, day_number, data['plant_name'])

        return jsonify({
            "success": True, 
            "plant_name": data['plant_name'], 
            "day": day_number, 
            "total_days": total_days,
            "date": str(date.today()), 
            "current_stage": stage, 
            "progress": round((day_number/total_days)*100, 1),
            "daily_tasks": tasks, 
            "weather": weather_info, 
            "sensor_data": sensor_data
        })

    except Exception as e: 
        return jsonify({"error": str(e)})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)
