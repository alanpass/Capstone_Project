"""Firestore 資料存取層。

資料結構：
  users/{uid}                       使用者資料（displayName, email, address）
  users/{uid}/plants/{plantId}      使用者的種植專案
  users/{uid}/plants/{plantId}/guides/{day}   AI 照護指南快取（同一天不重複呼叫 AI）
  thresholds/{uid}                  ESP32 自動控制門檻值
  plants/{id}                       植物百科（公開唯讀）
"""
from datetime import datetime, timezone


class FirestoreRepository:
    def __init__(self, client):
        self.db = client

    def _plants(self, uid: str):
        return self.db.collection("users").document(uid).collection("plants")

    def get_profile(self, uid: str) -> dict:
        snap = self.db.collection("users").document(uid).get()
        return (snap.to_dict() or {}) if snap.exists else {}

    def list_plants(self, uid: str) -> list[dict]:
        return [{"id": doc.id, **doc.to_dict()} for doc in self._plants(uid).stream()]

    def get_plant(self, uid: str, plant_id: str) -> dict | None:
        snap = self._plants(uid).document(plant_id).get()
        return {"id": snap.id, **snap.to_dict()} if snap.exists else None

    def add_plant(self, uid: str, data: dict) -> str:
        data = {**data, "created_at": datetime.now(timezone.utc).isoformat()}
        _, ref = self._plants(uid).add(data)
        return ref.id

    def delete_plant(self, uid: str, plant_id: str) -> bool:
        ref = self._plants(uid).document(plant_id)
        if not ref.get().exists:
            return False
        for guide in ref.collection("guides").stream():
            guide.reference.delete()
        ref.delete()
        return True

    def get_guide(self, uid: str, plant_id: str, key: str) -> dict | None:
        snap = self._plants(uid).document(plant_id).collection("guides").document(key).get()
        return snap.to_dict() if snap.exists else None

    def save_guide(self, uid: str, plant_id: str, key: str, guide: dict) -> None:
        self._plants(uid).document(plant_id).collection("guides").document(key).set(guide)

    def get_thresholds(self, uid: str) -> dict | None:
        snap = self.db.collection("thresholds").document(uid).get()
        return snap.to_dict() if snap.exists else None
