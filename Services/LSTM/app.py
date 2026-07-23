# -*- coding: utf-8 -*-
"""
Services/LSTM FastAPI 入口。

核心流程：
1. 用户持续 POST 水质读数；服务写入 SQLite。
2. 用当前热加载模型判断“本次输入是否异常”，并预测下一次输入倾向。
3. 数据累计到阈值后后台训练新 LSTM；训练期间继续用旧模型，新模型完成后热切换。
4. 提供整体形势分析接口，聚合本地数据并按 .env 直连 OpenAI 兼容 LLM 上游。
"""
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

import store
import trainer
from config import settings
from llm_analysis import generate_region_analysis
from model import compare_trend, fallback_anomaly, model_manager
from schemas import AnalysisRequest, ClearDatabaseRequest, PredictionResult, ReadingIn, TrainRequest, TrainingSignal


app = FastAPI(title="清源计划 · LSTM 时序异常检测服务", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def ok(data: object) -> dict:
    return {"code": 0, "message": "ok", "data": data}


@app.on_event("startup")
async def startup() -> None:
    store.init_db()
    model_manager.load_latest_from_disk()


@app.get("/health")
async def health() -> dict:
    return ok(
        {
            "status": "up",
            "db": "ok",
            "model_status": model_manager.status,
            "model_version": model_manager.version,
            "is_training": trainer.is_training(),
            "readings": store.count_readings(),
            "time": store.now_iso(),
        }
    )


@app.post("/api/v1/lstm/readings", response_model=dict)
async def ingest_reading(req: ReadingIn) -> dict:
    """写入一条读数，并返回异常检测与下一输入趋势预测。"""
    region = req.location.region if req.location else None
    previous_rows = store.get_recent_rows(
        device_id=req.device_id,
        region=region,
        limit=max(settings.seq_len, 30),
    )
    current = {name: getattr(req.metrics, name) for name in ("temperature", "ph", "ec", "turbidity")}
    predicted_current = model_manager.predict_next(previous_rows)
    if predicted_current is not None:
        anomaly_score, reasons = model_manager.anomaly_score(current, predicted_current)
    else:
        anomaly_score, reasons = fallback_anomaly(current, previous_rows)

    reading_id = store.insert_reading(req)
    latest_rows = store.get_recent_rows(device_id=req.device_id, region=region, limit=settings.seq_len, include_id=reading_id)
    next_prediction = model_manager.predict_next(latest_rows)
    tendency = compare_trend(current, next_prediction)

    can_train, reason = trainer.should_train(force=False)
    training_queued = False
    training_signal = TrainingSignal(
        queued=False,
        started=False,
        reason=reason,
        message=f"未开始训练：{reason}",
        is_training=trainer.is_training(),
    )
    if can_train and not trainer.is_training():
        # queue_training 内部只创建任务并启动 daemon 线程，不阻塞本次请求；
        # 这里同步拿到 job_id，便于响应明确告诉调用方“已开始后台训练”。
        job_id = trainer.queue_training(reason)
        training_queued = job_id is not None
        training_signal = TrainingSignal(
            queued=training_queued,
            started=training_queued,
            job_id=job_id,
            reason=reason,
            message=(f"已开始后台训练任务 #{job_id}：{reason}。训练期间继续使用旧模型，新模型完成后自动热切换。" if job_id else "训练条件已满足，但已有任务抢先开始；本次不重复启动。"),
            is_training=trainer.is_training(),
        )
    elif can_train and trainer.is_training():
        training_signal = TrainingSignal(
            queued=False,
            started=False,
            reason=reason,
            message=f"训练条件已满足（{reason}），但当前已有训练任务运行中；本次不重复启动。",
            is_training=True,
        )

    result = PredictionResult(
        reading_id=reading_id,
        abnormal=bool(anomaly_score >= settings.anomaly_z_threshold or reasons),
        anomaly_score=anomaly_score,
        anomaly_reasons=reasons,
        predicted_current=predicted_current,
        next_prediction=next_prediction,
        tendency=tendency,  # type: ignore[arg-type]
        model_version=model_manager.version,
        model_status=model_manager.status,
        training_queued=training_queued,
        training=training_signal,
    )
    return ok(result.model_dump())


@app.get("/api/v1/lstm/readings")
async def list_readings(
    device_id: Optional[str] = None,
    region: Optional[str] = None,
    limit: int = Query(50, ge=1, le=1000),
) -> dict:
    return ok(store.get_recent_rows(device_id=device_id, region=region, limit=limit))


@app.post("/api/v1/lstm/train")
async def train(req: TrainRequest) -> dict:
    can_train, reason = trainer.should_train(force=req.force)
    if not can_train:
        return ok(
            {
                "queued": False,
                "started": False,
                "reason": reason,
                "message": f"未开始训练：{reason}",
                "is_training": trainer.is_training(),
            }
        )
    job_id = trainer.queue_training(reason)
    started = job_id is not None
    return ok(
        {
            "queued": started,
            "started": started,
            "job_id": job_id,
            "reason": reason,
            "message": (f"已开始后台训练任务 #{job_id}：{reason}。训练期间继续使用旧模型，新模型完成后自动热切换。" if started else "已有训练任务运行中，本次不重复启动。"),
            "is_training": trainer.is_training(),
        }
    )


@app.get("/api/v1/lstm/status")
async def status() -> dict:
    return ok(
        {
            "model_status": model_manager.status,
            "model_version": model_manager.version,
            "latest_model": store.latest_model_version(),
            "is_training": trainer.is_training(),
            "readings": store.count_readings(),
            "last_trained_reading_id": store.get_kv("last_trained_reading_id", "0"),
            "training_jobs": store.list_training_jobs(limit=10),
        }
    )


@app.post("/api/v1/lstm/admin/clear-database")
async def clear_database(req: ClearDatabaseRequest) -> dict:
    """清空 LSTM SQLite 数据库业务数据。危险操作，需要确认码。"""
    if req.confirm != "CLEAR_LSTM_DATABASE":
        raise HTTPException(status_code=400, detail="确认码错误：请传 confirm='CLEAR_LSTM_DATABASE'")
    if trainer.is_training():
        raise HTTPException(status_code=409, detail="当前正在训练中，请训练结束后再清空数据库")
    result = store.clear_database(reset_sequences=req.reset_sequences)
    return ok(result)


@app.post("/api/v1/lstm/analysis/generate")
async def analysis(req: AnalysisRequest) -> dict:
    """聚合 SQLite 时序数据，并按 .env 直连上游模型生成整体形势分析。"""
    return ok(await generate_region_analysis(req.region, req.limit, req.no_cache))