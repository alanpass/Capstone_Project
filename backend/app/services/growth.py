"""植物生長進度計算（純函式，方便單元測試）。"""
from dataclasses import dataclass
from datetime import date

STAGES = ("種植期", "成長期", "開花期", "結果期", "收成期")


@dataclass(frozen=True)
class Progress:
    day: int
    total_days: int
    percent: float
    stage: str


def stage_for(day: int, total_days: int) -> str:
    if day <= 0:
        return "尚未開始"
    if day <= 7:
        return "種植期"
    if day <= total_days * 0.33:
        return "成長期"
    if day <= total_days * 0.66:
        return "開花期"
    if day <= total_days:
        return "結果期"
    return "收成期"


def progress_for(start: date, total_days: int, today: date, day: int | None = None) -> Progress:
    """day 為 None 時代表「今天」；否則計算指定第 N 天的狀態。"""
    total_days = max(1, int(total_days))
    current = (today - start).days + 1 if day is None else int(day)
    percent = round(min(100.0, max(0.0, current / total_days * 100)), 1)
    return Progress(day=current, total_days=total_days, percent=percent, stage=stage_for(current, total_days))


def duration_to_days(value: float, unit: str) -> int:
    """把 AI 回傳的「數字 + 單位」換算成天數，限制在 30~365 天之間。"""
    unit = (unit or "days").lower()
    multiplier = 365 if "year" in unit else 30 if "month" in unit else 7 if "week" in unit else 1
    days = int(round(float(value) * multiplier))
    return max(30, min(365, days))
