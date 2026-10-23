// Supabase Edge Function：AI 照護助理
// Gemini 金鑰只存在 Supabase 的 Secrets（GEMINI_API_KEY），前端永遠拿不到。
// 只接受已登入使用者，且提示詞固定在這裡，前端只能送「植物名稱 / 天數 / 環境數據」。
// 任務：check（判斷植物與週期）、guide（每日照護指南）、thresholds（各生長階段的自動控制門檻）
import { createClient } from "npm:@supabase/supabase-js@2.117.1";

// ---------- 提示詞與 Gemini 回應格式（responseSchema）。回應一律為 JSON，前端再以純文字安全渲染。 ----------

export const PLANT_CHECK_SCHEMA = {
  type: "OBJECT",
  properties: {
    is_plant: { type: "BOOLEAN" },
    normalized_name: { type: "STRING" },
    duration_value: { type: "NUMBER" },
    duration_unit: { type: "STRING", enum: ["days", "weeks", "months", "years"] },
    summary: { type: "STRING" },
  },
  required: ["is_plant", "normalized_name", "duration_value", "duration_unit", "summary"],
};

export const GUIDE_SCHEMA = {
  type: "OBJECT",
  properties: {
    headline: { type: "STRING" },
    expected_state: { type: "STRING" },
    tasks: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          detail: { type: "STRING" },
          amount: { type: "STRING" },
          reason: { type: "STRING" },
        },
        required: ["title", "detail", "reason"],
      },
    },
    environment_tips: { type: "ARRAY", items: { type: "STRING" } },
    risks: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { risk: { type: "STRING" }, prevention: { type: "STRING" } },
        required: ["risk", "prevention"],
      },
    },
    expert_tip: { type: "STRING" },
  },
  required: ["headline", "expected_state", "tasks", "environment_tips", "risks", "expert_tip"],
};

export function plantCheckPrompt(name: string): string {
  return `你是園藝專家。使用者想種植：「${name}」。
1. 判斷它是否為可以種植的植物（作物、花卉、蔬果、香草、樹木皆可）。非生物、料理、動物、虛構名詞或無法辨識的輸入，is_plant 回傳 false。
2. normalized_name：該植物最常見的繁體中文名稱（例如「蕃茄」→「番茄」）。
3. duration_value + duration_unit：從種植到第一次採收或開花所需時間；多年生植物只計算到第一次成熟/開花。
4. summary：用 2~3 句繁體中文介紹這個植物的生長特性與照顧重點。
若 is_plant 為 false，duration_value 填 0、summary 簡短說明原因。`;
}

type Weather = { city: string; description: string; min: number | null; max: number | null; rain: number | null };
type Sensor = { soil: number | null; temperature: number | null; humidity: number | null };

export function guidePrompt(o: {
  plantName: string; day: number; totalDays: number; stage: string; weather: Weather | null; sensor: Sensor | null;
}): string {
  const v = (x: number | null) => (x === null ? "未知" : x);
  const env: string[] = [];
  if (o.weather) env.push(`- 當地天氣（${o.weather.city}）：${o.weather.description}，${v(o.weather.min)}~${v(o.weather.max)}°C，降雨機率 ${v(o.weather.rain)}%`);
  if (o.sensor) env.push(`- 感測器：土壤濕度 ${v(o.sensor.soil)}%、氣溫 ${v(o.sensor.temperature)}°C、空氣濕度 ${v(o.sensor.humidity)}%`);
  return `你是頂尖的植物學家與農業顧問，請用繁體中文回答。
作物：${o.plantName}
進度：第 ${o.day} 天 / 共 ${o.totalDays} 天（目前階段：${o.stage}）
環境資料：
${env.length ? env.join("\n") : "- （無即時資料，請以該階段的典型環境推估）"}

請產生這一天的照護指南：
- headline：一句話總結今天的重點。
- expected_state：這天植物應該呈現的樣子（高度、葉片數、花果狀態等）。
- tasks：3~4 項具體任務，每項含 title（動作）、detail（操作步驟）、amount（建議用量，例如「澆水約 300 ml」，沒有可留空）、reason（科學原因）。
  若有環境資料，請依據天氣與感測數值調整（例如土壤偏濕就減少澆水、高溫就提醒遮陰）。
- environment_tips：2~3 項溫度/濕度/光照檢查重點。
- risks：1~3 項這個階段常見的病蟲害或環境風險與預防方法。
- expert_tip：一個進階栽培技巧。
內容要專業、具體、有數據，不要使用 Markdown 或 HTML 標記。`;
}

const STAGE_KEYS = ["planting", "growing", "flowering", "fruiting", "harvest"] as const;
const RANGE_SCHEMA = {
  type: "OBJECT",
  properties: {
    tempMin: { type: "NUMBER" },
    tempMax: { type: "NUMBER" },
    humidMin: { type: "NUMBER" },
    humidMax: { type: "NUMBER" },
    soilMin: { type: "NUMBER" },
  },
  required: ["tempMin", "tempMax", "humidMin", "humidMax", "soilMin"],
};
export const STAGE_THRESHOLDS_SCHEMA = {
  type: "OBJECT",
  properties: Object.fromEntries(STAGE_KEYS.map((k) => [k, RANGE_SCHEMA])),
  required: [...STAGE_KEYS],
};

export function stageThresholdsPrompt(plantName: string, totalDays: number): string {
  const d = (ratio: number) => Math.floor(totalDays * ratio);
  return `你是設施園藝與環境控制專家。作物：${plantName}，生長週期共 ${totalDays} 天。
請為下列 5 個生長階段，分別建議自動控制門檻：
- planting 種植期：第 1~7 天
- growing 成長期：第 8~${d(0.33)} 天
- flowering 開花期：第 ${d(0.33) + 1}~${d(0.66)} 天
- fruiting 結果期：第 ${d(0.66) + 1}~${totalDays} 天
- harvest 收成期：第 ${totalDays + 1} 天之後
每個階段提供：
- tempMin / tempMax：適合的空氣溫度範圍（°C，介於 -10~50，tempMin 必須小於 tempMax）；超出範圍時裝置會啟動風扇或加熱片。
- humidMin / humidMax：適合的空氣相對濕度範圍（%，0~100，humidMin 小於 humidMax）。
- soilMin：土壤濕度低於此百分比（0~100）時自動澆水；需考量該作物在此階段的需水量。
數值請符合該作物的實際栽培需求，並反映不同階段的差異（例如開花結果期通常需較穩定的溫度、收成前可減少澆水）。`;
}

// ---------- 呼叫 Gemini 與處理請求 ----------
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent";
const HOURLY_LIMIT = Number(Deno.env.get("AI_HOURLY_LIMIT") ?? 30);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 免費額度是「每個模型分開計算」，所以準備多個穩定版模型輪流使用（可用環境變數覆寫）
const DEFAULT_FALLBACKS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash"];
const REQUEST_TIMEOUT_MS = 30_000; // 單次請求上限：Google 偶爾會卡住不回應
const TOTAL_BUDGET_MS = 100_000; // 整體上限，避免使用者等太久

export function modelChain(): string[] {
  const fallbacks = (Deno.env.get("GEMINI_FALLBACK_MODELS") ?? Deno.env.get("GEMINI_FALLBACK_MODEL") ?? "")
    .split(",").map((m) => m.trim()).filter(Boolean);
  return [Deno.env.get("GEMINI_MODEL") ?? "gemini-3.5-flash", ...(fallbacks.length ? fallbacks : DEFAULT_FALLBACKS)]
    .filter((m, i, all) => all.indexOf(m) === i);
}

/**
 * 呼叫 Gemini 並解析 JSON。
 *   503（模型忙碌）/ 逾時 / 網路錯誤 → 同一模型再試一次，仍失敗就換下一個模型
 *   429（該模型今日額度用完）/ 404（模型已下架）→ 直接換下一個模型
 *   其他 4xx（請求或金鑰有問題）→ 立即回報，重試也沒用
 */
export async function callGemini(prompt: string, schema: unknown, fetchImpl = fetch, wait = sleep): Promise<unknown> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new HttpError(503, "伺服器尚未設定 GEMINI_API_KEY");

  const deadline = Date.now() + TOTAL_BUDGET_MS;
  let lastStatus = 0;
  const tried: string[] = []; // 例如 "gemini-3.5-flash 503"，附在錯誤訊息裡方便除錯（不含任何金鑰）
  models: for (const model of modelChain()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() >= deadline) break models;
      if (attempt > 0) await wait(1000);
      let res: Response;
      try {
        res = await fetchImpl(GEMINI_URL.replace("{model}", model), {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json", responseSchema: schema },
          }),
          signal: AbortSignal.timeout(Math.max(1000, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()))),
        });
      } catch (err) {
        lastStatus = 503; // 逾時或網路錯誤視同暫時無法使用
        const reason = err instanceof DOMException && err.name === "TimeoutError" ? "逾時" : "網路錯誤";
        tried.push(`${model} ${reason}`);
        console.warn(`Gemini ${model} ${reason}（第 ${attempt + 1} 次）：${err}`);
        continue;
      }
      if (res.ok) return parseResult(await res.json());
      lastStatus = res.status;
      tried.push(`${model} ${res.status}`);
      // Google 的錯誤說明（例如模型忙碌、額度用完、金鑰無效）只寫進 Supabase 日誌
      console.warn(`Gemini ${model} 回傳 ${res.status}（第 ${attempt + 1} 次）：${(await res.text()).slice(0, 300)}`);
      if (res.status === 429 || res.status === 404) continue models;
      if (res.status < 500) throw new HttpError(502, `AI 服務錯誤（${tried.join("、")}）`);
    }
  }
  if (lastStatus === 429) throw new HttpError(429, `今日 AI 免費額度已用完，請明天再試（${tried.join("、")}）`);
  throw new HttpError(503, `AI 服務目前忙碌中，請稍後再試（${tried.join("、")}）`);
}

function parseResult(data: { candidates?: { content?: { parts?: { text?: string }[] } }[] }): unknown {
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new HttpError(502, "AI 沒有產生回應，請再試一次");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(502, "AI 回傳格式錯誤，請再試一次");
  }
}

/** 驗證請求內容並產生提示詞；與網路無關，方便單元測試。 */
export function buildRequest(body: Record<string, unknown>): { task: string; prompt: string; schema: unknown } {
  const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

  if (body.task === "check") {
    const name = text(body.plantName, 40);
    if (!name) throw new HttpError(400, "請輸入植物名稱");
    return { task: "check", prompt: plantCheckPrompt(name), schema: PLANT_CHECK_SCHEMA };
  }
  if (body.task === "guide") {
    const plantName = text(body.plantName, 40);
    const day = num(body.day);
    const totalDays = num(body.totalDays);
    if (!plantName || day === null || totalDays === null) throw new HttpError(400, "缺少植物名稱或天數");
    const w = body.weather as Record<string, unknown> | null;
    const s = body.sensor as Record<string, unknown> | null;
    return {
      task: "guide",
      schema: GUIDE_SCHEMA,
      prompt: guidePrompt({
        plantName, day, totalDays, stage: text(body.stage, 10),
        weather: w ? { city: text(w.city, 10), description: text(w.description, 20), min: num(w.min_temp), max: num(w.max_temp), rain: num(w.rain_chance) } : null,
        sensor: s ? { soil: num(s.soil), temperature: num(s.temperature), humidity: num(s.humidity) } : null,
      }),
    };
  }
  if (body.task === "thresholds") {
    const plantName = text(body.plantName, 40);
    const totalDays = num(body.totalDays);
    if (!plantName || totalDays === null || totalDays < 1 || totalDays > 365) throw new HttpError(400, "缺少植物名稱或生長週期");
    return { task: "thresholds", prompt: stageThresholdsPrompt(plantName, Math.round(totalDays)), schema: STAGE_THRESHOLDS_SCHEMA };
  }
  throw new HttpError(400, "未知的任務類型");
}

/** 新版平台注入 SUPABASE_PUBLISHABLE_KEYS（JSON）；舊版只有 SUPABASE_ANON_KEY（預計 2026 年底淘汰）。 */
export function publishableKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
    const key = keys.default ?? Object.values(keys)[0];
    if (typeof key === "string" && key) return key;
  } catch {
    // 格式不符時改用舊版金鑰
  }
  const legacy = Deno.env.get("SUPABASE_ANON_KEY");
  if (!legacy) throw new HttpError(500, "找不到 Supabase 金鑰環境變數");
  return legacy;
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "只接受 POST" }, 405);
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, publishableKey(), {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new HttpError(401, "請先登入");

    const request = buildRequest(await req.json().catch(() => ({})));

    // 每人每小時的呼叫上限，避免額度被單一帳號用光
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await supabase.from("ai_requests").select("id", { count: "exact", head: true }).gte("created_at", since);
    if ((count ?? 0) >= HOURLY_LIMIT) throw new HttpError(429, `每小時最多使用 AI ${HOURLY_LIMIT} 次，請稍後再試`);
    await supabase.from("ai_requests").insert({ task: request.task });

    return json({ result: await callGemini(request.prompt, request.schema) });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: "伺服器發生錯誤，請稍後再試" }, 500);
  }
}

// 單元測試會設定 AI_FUNCTION_TEST=1，只匯入函式而不啟動伺服器
if (Deno.env.get("AI_FUNCTION_TEST") !== "1") Deno.serve(handle);
