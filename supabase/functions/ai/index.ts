// Supabase Edge Function：AI 照護助理
// Gemini 金鑰只存在 Supabase 的 Secrets（GEMINI_API_KEY），前端永遠拿不到。
// 只接受已登入使用者，且提示詞固定在這裡，前端只能送「植物名稱 / 天數 / 環境數據」。
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

/**
 * 呼叫 Gemini 並解析 JSON。Gemini 尖峰時段常回 503（模型忙碌）或 429（該模型額度用完），
 * 因此每個模型最多試 2 次，主要模型不行再改用備援模型（各模型額度分開計算）。
 */
export async function callGemini(prompt: string, schema: unknown, fetchImpl = fetch, wait = sleep): Promise<unknown> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new HttpError(503, "伺服器尚未設定 GEMINI_API_KEY");
  const models = [
    Deno.env.get("GEMINI_MODEL") ?? "gemini-3.5-flash",
    Deno.env.get("GEMINI_FALLBACK_MODEL") ?? "gemini-3.1-flash-lite",
  ].filter((m, i, all) => m && all.indexOf(m) === i);

  let lastStatus = 0;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await wait(1000 * attempt);
      let res: Response;
      try {
        res = await fetchImpl(GEMINI_URL.replace("{model}", model), {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json", responseSchema: schema },
          }),
        });
      } catch {
        lastStatus = 503; // 網路錯誤視同暫時無法使用，重試
        continue;
      }
      if (res.ok) return parseResult(await res.json());
      lastStatus = res.status;
      console.warn(`Gemini ${model} 回傳 ${res.status}（第 ${attempt + 1} 次）`);
      if (res.status === 429) break; // 該模型額度用完，直接換下一個模型
      if (res.status < 500) throw new HttpError(502, `AI 服務錯誤（${res.status}）`); // 請求本身有問題，重試也沒用
    }
  }
  if (lastStatus === 429) throw new HttpError(429, "AI 使用量已達上限，請稍後再試");
  throw new HttpError(503, "AI 服務目前忙碌中，請稍後再試");
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
