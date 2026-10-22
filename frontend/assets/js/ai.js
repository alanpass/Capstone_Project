// 呼叫 Supabase Edge Function「ai」：Gemini 金鑰與提示詞都在伺服器端，前端只傳必要資料
import { supabase } from "./supabase.js";

async function invoke(body) {
  const { data, error } = await supabase.functions.invoke("ai", { body });
  if (error) {
    // 伺服器回傳的錯誤訊息在 error.context（Response）裡
    const detail = await error.context?.json?.().catch(() => null);
    if (detail?.error) throw new Error(detail.error);
    if (/failed to send|fetch/i.test(error.message)) throw new Error("無法連線到 AI 服務（請確認已部署 Edge Function「ai」）");
    throw new Error(error.message);
  }
  return data.result;
}

/** 判斷是否為植物，並估算到第一次採收/開花的時間。 */
export const checkPlant = (plantName) => invoke({ task: "check", plantName });

/** 產生第 day 天的照護指南；weather / sensor 只在查詢今天時提供。 */
export const generateGuide = (params) => invoke({ task: "guide", ...params });
