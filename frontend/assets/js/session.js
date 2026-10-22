// 帳號相關：註冊、登入、登出、密碼重設、個人資料
import {
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  verifyPasswordResetCode,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { doc, getDoc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { auth, db } from "./firebase.js";

/** 等 Firebase 判斷完登入狀態後回傳目前使用者（未登入為 null）。 */
export function currentUser() {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (user) => { stop(); resolve(user); });
  });
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

export async function signUp({ name, email, password, address }) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name });
  await setDoc(doc(db, "users", cred.user.uid), {
    displayName: name, email, address, createdAt: serverTimestamp(),
  });
  return cred.user;
}

export const signIn = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const signOutUser = () => signOut(auth);
export const sendReset = (email) =>
  sendPasswordResetEmail(auth, email, { url: new URL("login.html", location.href).href });
export const checkResetCode = (code) => verifyPasswordResetCode(auth, code);
export const applyReset = (code, password) => confirmPasswordReset(auth, code, password);

export async function getProfile(user) {
  const snap = await getDoc(doc(db, "users", user.uid));
  const data = snap.exists() ? snap.data() : {};
  return {
    uid: user.uid,
    email: user.email,
    displayName: data.displayName || user.displayName || "",
    address: data.address || data.Address || "",
  };
}

export async function saveProfile(user, { displayName, address }) {
  await updateProfile(user, { displayName });
  await setDoc(doc(db, "users", user.uid), { displayName, address, updatedAt: serverTimestamp() }, { merge: true });
}

const AUTH_ERRORS = {
  "auth/invalid-email": "Email 格式不正確",
  "auth/user-not-found": "帳號或密碼錯誤",
  "auth/wrong-password": "帳號或密碼錯誤",
  "auth/invalid-credential": "帳號或密碼錯誤",
  "auth/email-already-in-use": "這個 Email 已經註冊過了",
  "auth/weak-password": "密碼至少需要 6 個字元",
  "auth/too-many-requests": "嘗試次數過多，請稍後再試",
  "auth/network-request-failed": "網路連線失敗，請檢查網路",
  "auth/expired-action-code": "連結已過期，請重新申請",
  "auth/invalid-action-code": "連結無效或已使用過，請重新申請",
  "auth/unauthorized-domain": "此網域尚未加入 Firebase 授權網域",
};

export function authErrorMessage(err) {
  return AUTH_ERRORS[err?.code] || err?.message || "發生未知錯誤";
}
