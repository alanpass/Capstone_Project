// 前端設定。Supabase 的 Project URL 與 Publishable key 本來就是公開的，
// 資料安全由資料庫的 Row Level Security 保護（見 supabase/schema.sql）。
// 取得位置：Supabase Dashboard → Project Settings → API Keys / Data API
export const SUPABASE_URL = "https://pgxfytfwpgyyyklpzwcn.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_xn72aTtTth-NPPEKGFJ0NA_bOHBl_BM";

export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

// 示範用感測資料：使用者還沒有自己的裝置數據時，改讀這個 ThingSpeak 頻道。
// 頻道設為公開（Sharing → Share channel view with everyone）就不需要金鑰；
// 若保持私人頻道，請填 Read API Key（唯讀，但放在網站上等於公開，所以建議直接設為公開）。
export const DEMO_THINGSPEAK_CHANNEL_ID = "3018608";
export const DEMO_THINGSPEAK_READ_KEY = "";
// 舊版韌體上傳 ADC 原始值（> 100），用這兩個校正值換算成百分比
export const SOIL_ADC_DRY = 0;
export const SOIL_ADC_WET = 1993;
