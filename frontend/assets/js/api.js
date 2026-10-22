// 呼叫後端 API：自動附上 Firebase ID Token，後端據此確認身分
import { API_BASE_URL } from "./config.js";
import { auth } from "./firebase.js";

export async function api(path, { method = "GET", body, auth: needAuth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (needAuth) {
    const user = auth.currentUser;
    if (!user) throw new Error("請先登入");
    headers.Authorization = `Bearer ${await user.getIdToken()}`;
  }

  let res;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("無法連線到伺服器（免費主機閒置後首次喚醒約需 30 秒，請稍後再試）");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `伺服器錯誤（${res.status}）`);
  return data;
}
