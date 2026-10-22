// 前端設定。Firebase Web 設定本來就會公開在瀏覽器中，安全性由 Firestore 規則與 Authentication 保護。
export const firebaseConfig = {
  apiKey: "AIzaSyAVol7FJxkR7qec_4o8ib3V9eOBwdK8g-M",
  authDomain: "plantai-cac82.firebaseapp.com",
  projectId: "plantai-cac82",
  storageBucket: "plantai-cac82.firebasestorage.app",
  messagingSenderId: "421107598181",
  appId: "1:421107598181:web:323e1344fd826f3cce978c",
};

const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);

// 後端 API 位址：本機開發時連到 Flask，正式環境連到 Render
export const API_BASE_URL = isLocal ? "http://localhost:8080" : "https://two025-zhuan-ti.onrender.com";

export const THINGSPEAK_CHANNEL_ID = "3013983";
