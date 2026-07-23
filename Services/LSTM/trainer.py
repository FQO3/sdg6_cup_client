# -*- coding: utf-8 -*-
"""后台训练调度与 LSTM 训练实现。"""
from __future__ import annotations

import random
import threading
import time
from collections import defaultdict
from pathlib import Path
from typing import Any, Optional

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

import store
from config import settings
from model import LSTMForecaster, model_manager
from schemas import FEATURES


_training_lock = threading.Lock()


def is_training() -> bool:
    return _training_lock.locked()


def should_train(force: bool = False) -> tuple[bool, str]:
    total = store.count_readings()
    if total < settings.min_train_points:
        return False, f"数据量不足：{total}/{settings.min_train_points}"
    if force:
        return True, "force"
    last_id = int(store.get_kv("last_trained_reading_id", "0") or "0")
    new_points = store.max_reading_id() - last_id
    if new_points >= settings.train_every_new_points:
        return True, f"新增 {new_points} 条，达到训练阈值"
    return False, f"新增数据不足：{new_points}/{settings.train_every_new_points}"


def queue_training(reason: str) -> Optional[int]:
    if is_training():
        return None
    job_id = store.create_training_job(reason)
    thread = threading.Thread(target=run_training_job, args=(job_id,), daemon=True)
    thread.start()
    return job_id


def _random_decimate(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(rows) <= settings.max_train_points:
        candidate = rows
    else:
        rng = random.Random(settings.seed + len(rows))
        keep = sorted(rng.sample(range(len(rows)), settings.max_train_points))
        candidate = [rows[i] for i in keep]
    ratio = min(max(settings.random_keep_ratio, 0.1), 1.0)
    if ratio >= 0.999:
        return candidate
    rng = random.Random(settings.seed + int(time.time() // 3600))
    keep_count = max(settings.min_train_points, int(len(candidate) * ratio))
    keep = sorted(rng.sample(range(len(candidate)), min(keep_count, len(candidate))))
    return [candidate[i] for i in keep]


def _build_dataset(rows: list[dict[str, Any]]) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[str(row["device_id"])].append(row)

    vectors: list[list[float]] = []
    for row in rows:
        vectors.append([float(row[name]) for name in FEATURES])
    all_arr = np.array(vectors, dtype=np.float32)
    mean = all_arr.mean(axis=0)
    std = np.maximum(all_arr.std(axis=0), 1e-6)

    X: list[np.ndarray] = []
    y: list[np.ndarray] = []
    seq_len = settings.seq_len
    for device_rows in grouped.values():
        device_rows.sort(key=lambda r: int(r["id"]))
        if len(device_rows) <= seq_len:
            continue
        arr = np.array([[float(r[name]) for name in FEATURES] for r in device_rows], dtype=np.float32)
        arr = (arr - mean) / std
        for i in range(0, len(arr) - seq_len):
            X.append(arr[i : i + seq_len])
            y.append(arr[i + seq_len])

    if not X:
        raise RuntimeError("可构造的时序窗口为 0，请增加单设备连续样本或降低 SEQ_LEN")
    return np.stack(X).astype(np.float32), np.stack(y).astype(np.float32), mean, std


def run_training_job(job_id: int) -> None:
    if not _training_lock.acquire(blocking=False):
        store.update_training_job(job_id, "skipped", "已有训练任务运行中")
        return
    try:
        store.update_training_job(job_id, "running", "开始训练")
        result = train_once()
        store.update_training_job(job_id, "succeeded", result)
    except Exception as exc:  # noqa: BLE001 - 需要把后台错误写入任务表
        store.update_training_job(job_id, "failed", repr(exc))
    finally:
        _training_lock.release()


def train_once() -> str:
    random.seed(settings.seed)
    np.random.seed(settings.seed)
    torch.manual_seed(settings.seed)

    rows = _random_decimate(store.get_all_training_rows())
    if len(rows) < settings.min_train_points:
        raise RuntimeError(f"训练数据不足：{len(rows)}/{settings.min_train_points}")

    X, y, mean, std = _build_dataset(rows)
    indices = np.arange(len(X))
    np.random.shuffle(indices)
    val_size = max(1, int(len(indices) * settings.validation_ratio)) if len(indices) > 5 else 0
    val_idx = indices[:val_size]
    train_idx = indices[val_size:] if val_size else indices

    train_ds = TensorDataset(torch.from_numpy(X[train_idx]), torch.from_numpy(y[train_idx]))
    train_loader = DataLoader(train_ds, batch_size=settings.batch_size, shuffle=True)
    val_x = torch.from_numpy(X[val_idx]) if val_size else None
    val_y = torch.from_numpy(y[val_idx]) if val_size else None

    model = LSTMForecaster(
        input_size=len(FEATURES),
        hidden_size=settings.hidden_size,
        num_layers=settings.num_layers,
        dropout=settings.dropout,
    )
    optimizer = torch.optim.AdamW(model.parameters(), lr=settings.learning_rate)
    loss_fn = nn.MSELoss()

    best_state: Optional[dict[str, torch.Tensor]] = None
    best_val = float("inf")
    for _epoch in range(settings.train_epochs):
        model.train()
        for batch_x, batch_y in train_loader:
            optimizer.zero_grad()
            loss = loss_fn(model(batch_x), batch_y)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()
        model.eval()
        if val_x is not None and val_y is not None:
            with torch.no_grad():
                val_loss = float(loss_fn(model(val_x), val_y).item())
        else:
            val_loss = float(loss.item())
        if val_loss < best_val:
            best_val = val_loss
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}

    if best_state is not None:
        model.load_state_dict(best_state)

    version = time.strftime("lstm-%Y%m%d-%H%M%S", time.gmtime())
    metadata = {
        "version": version,
        "features": FEATURES,
        "seq_len": settings.seq_len,
        "hidden_size": settings.hidden_size,
        "num_layers": settings.num_layers,
        "dropout": settings.dropout,
        "feature_mean": [float(v) for v in mean.tolist()],
        "feature_std": [float(v) for v in std.tolist()],
        "train_points": len(rows),
        "train_sequences": int(len(X)),
        "val_loss": round(float(best_val), 6),
        "created_at": store.now_iso(),
    }
    bundle_path = Path(settings.model_dir) / f"{version}.pt"
    model_manager.promote(model, metadata, bundle_path)
    store.save_model_version(
        version=version,
        path=str(bundle_path),
        seq_len=settings.seq_len,
        train_points=len(rows),
        train_sequences=int(len(X)),
        val_loss=float(best_val),
        metadata=metadata,
    )
    return f"version={version}, train_points={len(rows)}, sequences={len(X)}, val_loss={best_val:.6f}"