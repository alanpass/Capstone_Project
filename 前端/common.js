/**********************************************
 * common.js － Firebase 全域功能整合版
 * 適用於：
 *  register.html / login.html / logout.html /
 *  revise.html / forget.html / reset.html /
 *  firstpage.html / firstpagelog.html
 **********************************************/

// ==== 1️⃣ 初始化 Firebase ====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  updateProfile,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  confirmPasswordReset
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ⚠️ 請到 Firebase Console → 專案設定 → SDK setup → 複製設定貼到這裡
const firebaseConfig = {
  apiKey: "AIzaSyAVol7FJxkR7qec_4o8ib3V9eOBwdK8g-M",
  authDomain: "plantai-cac82.firebaseapp.com",
  projectId: "plantai-cac82",
  storageBucket: "plantai-cac82.firebasestorage.app",
  messagingSenderId: "421107598181",
  appId: "1:421107598181:web:323e1344fd826f3cce978c"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ====================================================
// 2️⃣ 註冊帳號（含 Firestore 紀錄）
// ====================================================
export async function signUpWithProfile({ name, email, password, address }) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (name) await updateProfile(cred.user, { displayName: name });

  await setDoc(doc(db, "users", cred.user.uid), {
    displayName: name || "",
    email,
    address: address || "",
    createdAt: serverTimestamp(),
  });

  return cred.user;
}

// ====================================================
// 3️⃣ 登入 / 登出
// ====================================================
export async function signInEmail(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function doLogout() {
  await signOut(auth);
}

// ====================================================
// 4️⃣ 登入狀態保護（需登入才能使用頁面）
// ====================================================
export function requireAuth(redirectTo = "login.html") {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      alert("請先登入");
      location.href = redirectTo;
    }
  });
}

// ====================================================
// 5️⃣ 取得目前使用者資料（含 Firestore）
// ====================================================
export async function getMyProfile() {
  const user = auth.currentUser;
  if (!user) return null;

  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};
  return { uid: user.uid, email: user.email, displayName: user.displayName, ...data };
}

// ====================================================
// 6️⃣ 更新使用者資料（Firestore + displayName）
// ====================================================
export async function updateMyProfile({ displayName, address }) {
  const user = auth.currentUser;
  if (!user) throw new Error("尚未登入");

  if (displayName) await updateProfile(user, { displayName });

  const ref = doc(db, "users", user.uid);
  await updateDoc(ref, {
    displayName,
    address,
    updatedAt: serverTimestamp(),
  });
}

// ====================================================
// 7️⃣ 密碼重設：寄信（forget.html）
// ====================================================
export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

// ====================================================
// 8️⃣ 密碼重設：處理連結（reset.html）
// ====================================================
export async function confirmResetPassword(oobCode, newPassword) {
  await confirmPasswordReset(auth, oobCode, newPassword);
}

// ====================================================
// 9️⃣ 登入狀態檢查（firstpagelog.html）
// ====================================================
export function checkLoginRedirect(targetUrl) {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      location.href = targetUrl;
    }
  });
}
export { db };