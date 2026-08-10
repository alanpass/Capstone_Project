from flask import Flask, jsonify, request
import pymysql
import pymysql.cursors
import threading
import time
import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime

# ============================================
# 🎯 配置區塊
# ============================================

# --- Firebase & 同步配置 ---
# 請替換成您正確的路徑，並確保前面有 r
SERVICE_ACCOUNT_KEY_PATH = r'C:\Users\alan\Desktop\nuk_project\page\plantai-cac82-firebase-adminsdk-fbsvc-9cc813ae60.json' 
COLLECTION_NAME = 'thresholds'
SYNC_INTERVAL_SECONDS = 300 # 每 5 分鐘同步一次

# --- MySQL/phpMyAdmin 配置 (用於同步和 Flask) ---
DB_CONFIG = {
    "host": "localhost",
    "port": 3306,
    "user": "nuk",
    "password": "034709167",
    "database": "esp32_data",
    # 注意：這裡使用 pymysql.cursors.DictCursor 是為了讓結果以字典形式返回
    "cursorclass": pymysql.cursors.DictCursor 
}
MYSQL_TABLE = "user_thresholds" # 存放 Firebase 門檻值的目標表格

# ============================================
# ⚙️ 全域變數與初始化
# ============================================
app = Flask(__name__)
firebase_db = None # Firestore 客戶端實例

# ---------------- Firebase 初始化 ----------------
def initialize_firebase():
    """初始化 Firebase Admin SDK。"""
    try:
        cred = credentials.Certificate(SERVICE_ACCOUNT_KEY_PATH)
        if not firebase_admin._apps:
            firebase_admin.initialize_app(cred)
        return firestore.client()
    except Exception as e:
        print(f"❌ Firebase 初始化失敗，請檢查金鑰路徑和檔案: {e}")
        return None

# ---------------- MySQL 連線函式 ----------------
def get_db_connection():
    """建立 MySQL 連線 (使用 DB_CONFIG)"""
    return pymysql.connect(**DB_CONFIG)


# ============================================
# 🔄 資料同步執行緒 (Firebase -> MySQL)
# ============================================

def export_data_to_mysql(db_client):
    """單次執行從 Firestore 讀取資料並寫入 MySQL。"""
    
    current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"\n[{current_time}] ⏳ 正在執行資料同步...")

    data_list = []
    
    # 1. 從 Firestore 讀取資料
    try:
        docs = db_client.collection(COLLECTION_NAME).stream()
        for doc in docs:
            doc_data = doc.to_dict()
            doc_data['uid'] = doc.id 
            
            if 'updatedAt' in doc_data:
                # 處理 Firestore Timestamp 轉換為 ISO 格式字串
                if hasattr(doc_data['updatedAt'], 'isoformat'):
                    doc_data['updatedAt'] = doc_data['updatedAt'].isoformat()
            
            data_list.append(doc_data)
        
        print(f"   讀取成功: {len(data_list)} 筆記錄。")

    except Exception as e:
        print(f"❌ 讀取 Firestore 資料失敗: {e}")
        return

    if not data_list:
        print("   ℹ️ Firestore 中沒有資料可同步。")
        return

    # 2. 寫入資料到 MySQL
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # REPLACE INTO 語句確保更新或插入
        sql = f"""
        REPLACE INTO {MYSQL_TABLE} (
            uid, tempMax, tempMin, humidMax, humidMin, updatedAt
        ) VALUES (
            %s, %s, %s, %s, %s, %s
        )
        """
        
        records_to_insert = []
        for data in data_list:
            record = (
                data.get('uid'),
                # 確保數值類型可以被 pymysql 接受，這裡假設它們是數字
                float(data.get('tempMax', 0)),
                float(data.get('tempMin', 0)),
                float(data.get('humidMax', 0)),
                float(data.get('humidMin', 0)),
                data.get('updatedAt')
            )
            records_to_insert.append(record)

        cursor.executemany(sql, records_to_insert)
        conn.commit()

        print(f"   ✅ 寫入成功: {cursor.rowcount} 筆記錄同步到 MySQL。")

    except pymysql.Error as err:
        print(f"❌ MySQL 寫入錯誤: {err}")
    except Exception as e:
        print(f"❌ 發生未知錯誤: {e}")
    finally:
        if conn and conn.open:
            cursor.close()
            conn.close()

def firebase_sync_thread_function():
    """執行緒函式：持續定時同步資料"""
    global firebase_db
    
    firebase_db = initialize_firebase()
    if not firebase_db:
        print("🛑 Firebase 服務啟動失敗，同步執行緒已停止。")
        return
        
    print("=====================================================")
    print(f"🌐 資料同步程式啟動，每 {SYNC_INTERVAL_SECONDS} 秒執行一次...")
    print("=====================================================")

    while True:
        try:
            export_data_to_mysql(firebase_db)
            print(f"   暫停 {SYNC_INTERVAL_SECONDS} 秒，等待下一輪同步...")
            time.sleep(SYNC_INTERVAL_SECONDS)
        except Exception as e:
            print(f"⚠️ 同步執行緒中發生錯誤: {e}。繼續運行...")
            time.sleep(10) # 發生錯誤時短暫等待，避免CPU佔用過高


# ============================================
# 🌐 Flask API 路由
# ============================================

# ---------------- 取得門檻值 (供 ESP32 讀取) ----------------
# *注意：這裡我將讀取邏輯修改為讀取 'user_thresholds' 表格中的所有欄位
# 以便與 Firebase 同步的數據結構一致。
@app.route("/get_threshold", methods=["GET"])
def get_threshold():
    """
    從 MySQL 的 user_thresholds 表格中獲取最新的溫濕度門檻值。
    假設 ESP32 只關心一個特定的 UID，這裡我們取第一筆資料作為範例。
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # 這裡假設 ESP32 只需要最新同步的一筆資料 (或您可以根據需要增加 user_id 查詢)
        # 由於 user_thresholds 是 REPLACE INTO，我們簡單取第一筆
        sql = f"SELECT tempMax, tempMin, humidMax, humidMin FROM {MYSQL_TABLE} LIMIT 1;"
        
        cursor.execute(sql)
        result = cursor.fetchone()
        conn.close()

        if result:
            return jsonify({
                "status": "success",
                "tempMax": result.get("tempMax"),
                "tempMin": result.get("tempMin"),
                "humidMax": result.get("humidMax"),
                "humidMin": result.get("humidMin")
            })
        else:
            # 如果資料庫沒有數據，提供一個預設值
            return jsonify({
                "status": "success",
                "message": "使用預設門檻值",
                "tempMax": 28,
                "tempMin": 22,
                "humidMax": 80,
                "humidMin": 50
            })
    except Exception as e:
        print("資料庫錯誤:", e)
        return jsonify({"status": "error", "message": "資料庫連線或查詢失敗"})

# ---------------- 修改門檻值 (原有的，但可能與 Firebase 邏輯衝突，需注意) ----------------
# ⚠️ 注意：這個路由將資料寫入 'threshold_table'，而同步執行緒讀取的是 'user_thresholds'。
# 如果您希望所有資料都同步，請將這裡的寫入也導向 Firebase。
@app.route("/set_threshold", methods=["POST"])
def set_threshold():
    try:
        data = request.get_json()
        lower = float(data.get("lower_threshold", 24)) # 假設這是 TempMin
        upper = float(data.get("upper_threshold", 26)) # 假設這是 TempMax

        conn = get_db_connection()
        cursor = conn.cursor()
        
        # 這裡仍然使用您原有的 threshold_table，請注意與同步表格 user_thresholds 的區別
        cursor.execute(
            "INSERT INTO threshold_table (lower_threshold, upper_threshold) VALUES (%s, %s);",
            (lower, upper)
        )
        conn.commit()
        conn.close()
        return jsonify({"status": "success", "lower_threshold": lower, "upper_threshold": upper})
    except Exception as e:
        print("資料庫修改錯誤:", e)
        return jsonify({"status": "error", "message": str(e)})


# ============================================
# 🚀 主程式入口
# ============================================
if __name__ == "__main__":
    
    # 1. 啟動 Firebase 資料同步執行緒
    sync_thread = threading.Thread(target=firebase_sync_thread_function, daemon=True)
    # daemon=True 確保主程式 (Flask) 停止時，這個執行緒也會停止
    sync_thread.start()
    
    # 2. 啟動 Flask 伺服器
    print("\n=====================================================")
    print("🌐 啟動 Flask 伺服器 (提供門檻值給 ESP32)...")
    print("=====================================================")
    
    # Flask 會在主執行緒中運行，阻擋後續代碼，直到停止
    try:
        app.run(host="0.0.0.0", port=5000, debug=False) # 關閉 debug 避免多執行緒問題
    except KeyboardInterrupt:
        print("\n⏹️ Flask 伺服器停止。")
    except Exception as e:
        print(f"\n🛑 Flask 發生錯誤: {e}")
    finally:
        # 雖然 daemon=True 會自動停止，但明確退出更有條理
        print("✅ 程式完全停止。")