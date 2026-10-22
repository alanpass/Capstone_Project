// 前端設定。Firebase Web 設定本來就會公開在瀏覽器中，安全性由 Firestore 規則、Authentication 與 App Check 保護。
export const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/12.19.0";

export const firebaseConfig = {
  apiKey: "AIzaSyAVol7FJxkR7qec_4o8ib3V9eOBwdK8g-M",
  authDomain: "plantai-cac82.firebaseapp.com",
  projectId: "plantai-cac82",
  storageBucket: "plantai-cac82.firebasestorage.app",
  messagingSenderId: "421107598181",
  appId: "1:421107598181:web:323e1344fd826f3cce978c",
};

// Firebase AI Logic 使用的 Gemini 模型（穩定版，最早 2027-05 才停用）
export const GEMINI_MODEL = "gemini-3.5-flash";

// App Check（reCAPTCHA Enterprise）網站金鑰。Firebase AI Logic 預設強制 App Check，
// 請在 Google Cloud 建立金鑰後填入；留空則不啟用 App Check。
export const RECAPTCHA_ENTERPRISE_SITE_KEY = "";

export const THINGSPEAK_CHANNEL_ID = "3013983";
// 舊版韌體上傳 ADC 原始值（> 100），用這兩個校正值換算成百分比
export const SOIL_ADC_DRY = 0;
export const SOIL_ADC_WET = 1993;
