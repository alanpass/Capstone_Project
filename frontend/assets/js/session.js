// 帳號相關：註冊、登入、登出、密碼重設、個人資料（Supabase Auth）
import { isConfigured } from "./config.js";
import { supabase, unwrap } from "./supabase.js";

const pageUrl = (page) => new URL(page, location.href).href;

/** 目前登入的使用者（未登入為 null）。 */
export async function currentUser() {
  if (!isConfigured) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

/** 需要登入的頁面使用：未登入就導向登入頁，並記住原本要去的頁面。 */
export async function requireUser() {
  const user = await currentUser();
  if (!user) {
    const next = encodeURIComponent(location.pathname.split("/").pop() + location.search);
    location.replace(`login.html?next=${next}`);
    return new Promise(() => {}); // 停在這裡，等待跳轉
  }
  return user;
}

/** 只允許站內相對路徑，避免 open redirect。 */
export function nextPage(fallback = "home.html") {
  const next = new URLSearchParams(location.search).get("next") || "";
  return /^[\w-]+\.html(\?[\w=&%.-]*)?$/.test(next) ? next : fallback;
}

/** 註冊；若專案開啟 Email 驗證，回傳 { needsConfirmation: true }。 */
export async function signUp({ name, email, password, address }) {
  const data = unwrap(await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: name, address }, emailRedirectTo: pageUrl("home.html") },
  }));
  return { user: data.user, needsConfirmation: !data.session };
}

export async function signIn(email, password) {
  return unwrap(await supabase.auth.signInWithPassword({ email, password })).user;
}

export async function signOutUser() {
  await supabase.auth.signOut();
}

export async function sendReset(email) {
  unwrap(await supabase.auth.resetPasswordForEmail(email, { redirectTo: pageUrl("reset.html") }));
}

export async function updatePassword(password) {
  unwrap(await supabase.auth.updateUser({ password }));
}

export async function getProfile(user) {
  const row = unwrap(await supabase.from("profiles").select("display_name, address").eq("id", user.id).maybeSingle());
  return {
    id: user.id,
    email: user.email,
    displayName: row?.display_name || user.user_metadata?.display_name || "",
    address: row?.address || "",
  };
}

export async function saveProfile(user, { displayName, address }) {
  unwrap(await supabase.from("profiles").upsert({
    id: user.id, display_name: displayName, address, updated_at: new Date().toISOString(),
  }));
}

const AUTH_ERRORS = [
  [/invalid login credentials/i, "帳號或密碼錯誤"],
  [/email not confirmed/i, "Email 尚未驗證，請先到信箱點擊驗證連結"],
  [/already registered|already been registered/i, "這個 Email 已經註冊過了"],
  [/password should be at least|weak password/i, "密碼至少需要 6 個字元"],
  [/unable to validate email|invalid email|email address .* is invalid/i, "Email 格式不正確"],
  [/rate limit|too many/i, "嘗試次數過多，請稍後再試"],
  [/failed to fetch|network/i, "網路連線失敗，請檢查網路"],
  [/same.*password|different from the old/i, "新密碼不能與舊密碼相同"],
];

export function authErrorMessage(err) {
  const text = err?.message || String(err);
  return AUTH_ERRORS.find(([re]) => re.test(text))?.[1] || text || "發生未知錯誤";
}
