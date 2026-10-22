// Firebase AI Logic：瀏覽器直接呼叫 Gemini，金鑰由 Firebase 保管（不會出現在前端程式碼），
// 並以 App Check 防止濫用。回應一律要求結構化 JSON，畫面再用 esc() 安全渲染。
import { getAI, getGenerativeModel, GoogleAIBackend, Schema } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-ai.js";
import { GEMINI_MODEL } from "./config.js";
import { app } from "./firebase.js";

const ai = getAI(app, { backend: new GoogleAIBackend() });

const PLANT_CHECK_SCHEMA = Schema.object({
  properties: {
    is_plant: Schema.boolean(),
    normalized_name: Schema.string(),
    duration_value: Schema.number(),
    duration_unit: Schema.enumString({ enum: ["days", "weeks", "months", "years"] }),
    summary: Schema.string(),
  },
});

const GUIDE_SCHEMA = Schema.object({
  properties: {
    headline: Schema.string(),
    expected_state: Schema.string(),
    tasks: Schema.array({
      items: Schema.object({
        properties: { title: Schema.string(), detail: Schema.string(), amount: Schema.string(), reason: Schema.string() },
        optionalProperties: ["amount"],
      }),
    }),
    environment_tips: Schema.array({ items: Schema.string() }),
    risks: Schema.array({
      items: Schema.object({ properties: { risk: Schema.string(), prevention: Schema.string() } }),
    }),
    expert_tip: Schema.string(),
  },
});

async function generateJson(prompt, schema) {
  const model = getGenerativeModel(ai, {
    model: GEMINI_MODEL,
    generationConfig: { responseMimeType: "application/json", responseSchema: schema },
  });
  try {
    const result = await model.generateContent(prompt);
    return JSON.parse(result.response.text());
  } catch (err) {
    throw new Error(aiErrorMessage(err));
  }
}

function aiErrorMessage(err) {
  const text = String(err?.message || err);
  if (/app.?check/i.test(text)) return "AI 服務的 App Check 驗證失敗，請確認 config.js 的 reCAPTCHA 金鑰與 Firebase App Check 設定";
  if (/429|quota|resource.?exhausted/i.test(text)) return "AI 使用量已達上限，請稍後再試";
  if (/api.+(not been used|disabled|not enabled)|firebasevertexai|firebaseml/i.test(text)) return "尚未在 Firebase Console 啟用 AI Logic（Gemini Developer API）";
  if (/JSON/.test(text)) return "AI 回傳格式錯誤，請再試一次";
  if (/fetch|network/i.test(text)) return "無法連線到 AI 服務，請檢查網路";
  return `AI 服務錯誤：${text}`;
}

/** 判斷是否為植物，並估算到第一次採收/開花的時間。 */
export function checkPlant(name) {
  return generateJson(`你是園藝專家。使用者想種植：「${name}」。
1. 判斷它是否為可以種植的植物（作物、花卉、蔬果、香草、樹木皆可）。非生物、料理、動物、虛構名詞或無法辨識的輸入，is_plant 回傳 false。
2. normalized_name：該植物最常見的繁體中文名稱（例如「蕃茄」→「番茄」）。
3. duration_value + duration_unit：從種植到第一次採收或開花所需時間；多年生植物只計算到第一次成熟/開花。
4. summary：用 2~3 句繁體中文介紹這個植物的生長特性與照顧重點。
若 is_plant 為 false，duration_value 填 0、summary 簡短說明原因。`, PLANT_CHECK_SCHEMA);
}

/** 產生第 day 天的照護指南；weather / sensor 只在查詢今天時提供。 */
export function generateGuide({ plantName, day, totalDays, stage, weather, sensor }) {
  const env = [];
  if (weather) env.push(`- 當地天氣（${weather.city}）：${weather.description}，${weather.min_temp}~${weather.max_temp}°C，降雨機率 ${weather.rain_chance}%`);
  if (sensor) env.push(`- 感測器：土壤濕度 ${sensor.soil ?? "未知"}%、氣溫 ${sensor.temperature ?? "未知"}°C、空氣濕度 ${sensor.humidity ?? "未知"}%`);
  return generateJson(`你是頂尖的植物學家與農業顧問，請用繁體中文回答。
作物：${plantName}
進度：第 ${day} 天 / 共 ${totalDays} 天（目前階段：${stage}）
環境資料：
${env.length ? env.join("\n") : "- （無即時資料，請以該階段的典型環境推估）"}

請產生這一天的照護指南：
- headline：一句話總結今天的重點。
- expected_state：這天植物應該呈現的樣子（高度、葉片數、花果狀態等）。
- tasks：3~4 項具體任務，每項含 title（動作）、detail（操作步驟）、amount（建議用量，例如「澆水約 300 ml」，沒有可省略）、reason（科學原因）。
  若有環境資料，請依據天氣與感測數值調整（例如土壤偏濕就減少澆水、高溫就提醒遮陰）。
- environment_tips：2~3 項溫度/濕度/光照檢查重點。
- risks：1~3 項這個階段常見的病蟲害或環境風險與預防方法。
- expert_tip：一個進階栽培技巧。
內容要專業、具體、有數據，不要使用 Markdown 或 HTML 標記。`, GUIDE_SCHEMA);
}
