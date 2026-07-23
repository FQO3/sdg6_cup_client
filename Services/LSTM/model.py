# -*- coding: utf-8 -*-
"""LSTM 模型定义、加载、推理与热切换。"""
from __future__ import annotations

import json
import math
import threading
from pathlib import Path
from typing import Any, Optional

import numpy as np
import torch
from torch import nn

from config import settings
from schemas import FEATURES


class LSTMForecaster(nn.Module):
    def __init__(self, input_size: int, hidden_size: int, num_layers: int, dropout: float):
        super().__init__()
        actual_dropout = dropout if num_layers > 1 else 0.0
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            dropout=actual_dropout,
            batch_first=True,
        )
        self.head = nn.Sequential(
            nn.Linear(hidden_size, hidden_size),
            nn.ReLU(),
            nn.Linear(hidden_size, input_size),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out, _ = self.lstm(x)
        return self.head(out[:, -1, :])


class ModelManager:
    """线程安全模型持有者：训练完成后一次性替换内存中的模型引用。"""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.model: Optional[LSTMForecaster] = None
        self.metadata: Optional[dict[str, Any]] = None
        self.version: Optional[str] = None

    @property
    def status(self) -> str:
        return "ready" if self.model is not None and self.metadata is not None else "cold_start"

    def load_latest_from_disk(self) -> None:
        model_dir = Path(settings.model_dir)
        latest = model_dir / "latest.json"
        if not latest.exists():
            return
        metadata = json.loads(latest.read_text(encoding="utf-8"))
        bundle_path = Path(metadata["path"])
        if not bundle_path.exists():
            return
        self.load_bundle(bundle_path, metadata)

    def load_bundle(self, bundle_path: Path, metadata: dict[str, Any]) -> None:
        model = LSTMForecaster(
            input_size=len(FEATURES),
            hidden_size=int(metadata["hidden_size"]),
            num_layers=int(metadata["num_layers"]),
            dropout=float(metadata.get("dropout", 0.0)),
        )
        state = torch.load(str(bundle_path), map_location="cpu")
        model.load_state_dict(state["model_state"])
        model.eval()
        with self._lock:
            self.model = model
            self.metadata = metadata
            self.version = metadata.get("version")

    def promote(self, model: LSTMForecaster, metadata: dict[str, Any], bundle_path: Path) -> None:
        model.eval()
        bundle_path.parent.mkdir(parents=True, exist_ok=True)
        torch.save({"model_state": model.state_dict(), "metadata": metadata}, str(bundle_path))
        metadata = {**metadata, "path": str(bundle_path)}
        latest_path = bundle_path.parent / "latest.json"
        tmp_path = bundle_path.parent / "latest.json.tmp"
        tmp_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp_path.replace(latest_path)
        with self._lock:
            self.model = model
            self.metadata = metadata
            self.version = metadata.get("version")

    def _normalize(self, arr: np.ndarray) -> np.ndarray:
        assert self.metadata is not None
        mean = np.array(self.metadata["feature_mean"], dtype=np.float32)
        std = np.array(self.metadata["feature_std"], dtype=np.float32)
        return (arr - mean) / std

    def _denormalize(self, arr: np.ndarray) -> np.ndarray:
        assert self.metadata is not None
        mean = np.array(self.metadata["feature_mean"], dtype=np.float32)
        std = np.array(self.metadata["feature_std"], dtype=np.float32)
        return arr * std + mean

    def predict_next(self, rows: list[dict[str, Any]]) -> Optional[dict[str, float]]:
        with self._lock:
            model = self.model
            metadata = self.metadata
        if model is None or metadata is None:
            return None
        seq_len = int(metadata["seq_len"])
        if len(rows) < seq_len:
            return None
        raw = np.array([[float(r[name]) for name in FEATURES] for r in rows[-seq_len:]], dtype=np.float32)
        x = self._normalize(raw)
        with torch.no_grad():
            pred_norm = model(torch.from_numpy(x[None, :, :])).numpy()[0]
        pred = self._denormalize(pred_norm)
        return {name: round(float(value), 4) for name, value in zip(FEATURES, pred)}

    def anomaly_score(self, actual: dict[str, Any], predicted: Optional[dict[str, float]]) -> tuple[float, list[str]]:
        if predicted is None or self.metadata is None:
            return 0.0, []
        std = np.array(self.metadata["feature_std"], dtype=np.float32)
        diffs: list[float] = []
        reasons: list[tuple[str, float]] = []
        for idx, name in enumerate(FEATURES):
            scale = max(float(std[idx]), 1e-6)
            z = abs(float(actual[name]) - float(predicted[name])) / scale
            diffs.append(z * z)
            if z >= settings.anomaly_z_threshold:
                reasons.append((name, z))
        score = math.sqrt(sum(diffs) / max(len(diffs), 1))
        reasons.sort(key=lambda item: item[1], reverse=True)
        return round(float(score), 4), [f"{name} 偏离模型预期 {z:.2f}σ" for name, z in reasons]


def fallback_anomaly(current: dict[str, Any], history: list[dict[str, Any]]) -> tuple[float, list[str]]:
    if len(history) < 8:
        return 0.0, []
    arr = np.array([[float(r[name]) for name in FEATURES] for r in history], dtype=np.float32)
    mean = arr.mean(axis=0)
    std = np.maximum(arr.std(axis=0), 1e-6)
    cur = np.array([float(current[name]) for name in FEATURES], dtype=np.float32)
    z = np.abs((cur - mean) / std)
    score = float(np.sqrt(np.mean(np.square(z))))
    reasons = [f"{FEATURES[i]} 超出近期滚动均值 {float(v):.2f}σ" for i, v in enumerate(z) if v >= settings.anomaly_z_threshold]
    return round(score, 4), reasons


def compare_trend(current: dict[str, Any], next_prediction: Optional[dict[str, float]]) -> dict[str, Any]:
    per_feature: dict[str, str] = {}
    detail: dict[str, dict[str, Any]] = {}
    if next_prediction is None:
        return {
            "per_feature": {name: "stable" for name in FEATURES},
            "detail": {
                name: {
                    "direction": "stable",
                    "description": "暂无可用 LSTM 预测；冷启动阶段默认视为暂稳。",
                }
                for name in FEATURES
            },
            "overall": "stable",
            "explanation": "当前没有足够的已训练模型或连续序列，暂不能判断明确升降趋势；服务返回 stable 作为保守结果。",
        }
    for name in FEATURES:
        cur = float(current[name])
        nxt = float(next_prediction[name])
        deadband = max(abs(cur) * settings.trend_deadband_ratio, settings.trend_deadband_absolute)
        delta = nxt - cur
        percent = 0.0 if abs(cur) < 1e-9 else delta / abs(cur) * 100.0
        if nxt > cur + deadband:
            per_feature[name] = "increase"
            description = f"模型预测下一次 {name} 高于当前值，预计上升 {delta:.4f}（约 {percent:.2f}%）。"
        elif nxt < cur - deadband:
            per_feature[name] = "decrease"
            description = f"模型预测下一次 {name} 低于当前值，预计下降 {abs(delta):.4f}（约 {abs(percent):.2f}%）。"
        else:
            per_feature[name] = "stable"
            description = f"模型预测下一次 {name} 与当前值差异在死区阈值 {deadband:.4f} 内，视为基本稳定。"
        detail[name] = {
            "direction": per_feature[name],
            "current": round(cur, 4),
            "predicted_next": round(nxt, 4),
            "delta": round(delta, 4),
            "delta_percent": round(percent, 4),
            "deadband": round(deadband, 4),
            "description": description,
        }
    votes = {k: list(per_feature.values()).count(k) for k in ("increase", "decrease", "stable")}
    top_count = max(votes.values())
    winners = [k for k, v in votes.items() if v == top_count]
    overall = winners[0] if len(winners) == 1 else "mixed"
    explanation_map = {
        "increase": "多数核心水质指标的下一次预测值高于当前值，整体趋势偏上升。注意：上升不一定代表水质变好，例如 EC 或浊度上升通常需要重点关注。",
        "decrease": "多数核心水质指标的下一次预测值低于当前值，整体趋势偏下降。注意：下降也不一定代表水质变差，需要结合具体指标含义判断。",
        "stable": "多数核心水质指标的下一次预测值与当前值接近，整体趋势暂稳。",
        "mixed": "不同指标预测方向不一致，整体呈混合变化；建议查看 detail 中每个指标的单独解释。",
    }
    return {"per_feature": per_feature, "detail": detail, "overall": overall, "explanation": explanation_map[overall]}


model_manager = ModelManager()