import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/+esm";
import { isConfigured, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config.js";

// 尚未設定時給一個不會連線的佔位網址，讓公開頁面（植物百科、示範感測資料）仍可正常運作
export const supabase = createClient(
  isConfigured ? SUPABASE_URL : "https://not-configured.supabase.co",
  isConfigured ? SUPABASE_PUBLISHABLE_KEY : "not-configured",
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);

/** Supabase 查詢結果有錯就丟出例外，讓呼叫端可以用 try/catch。 */
export function unwrap({ data, error }) {
  if (error) throw new Error(error.message || "資料庫錯誤");
  return data;
}
