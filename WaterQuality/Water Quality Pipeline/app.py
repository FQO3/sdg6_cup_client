# -*- coding: utf-8 -*-
"""
api.py —— FastAPI 水质等级预测接口
启动: python3 -m uvicorn app:app --app-dir . --host 0.0.0.0 --port 8080

接口:
  POST /predict         发送 4 个便宜参数 → 等级 + 置信度 + 各类概率
  GET  /health          健康检查
  GET  /info            模型元信息
  
curl -X POST http://localhost:8080/predict \
  -H "Content-Type: application/json" \
  -d '{"temperature":22.5,"ph":7.2,"ec":350,"turbidity":15,"wet":false}'

"""
import logging
import joblib
import numpy as np
from pathlib import Path
from fastapi import FastAPI, Request
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger('water-api')

# ── 加载模型 ──────────────────────────────────
BASE = Path(__file__).parent
MODEL_DIR = BASE / 'models' if (BASE / 'models').is_dir() else BASE
pkg = joblib.load(MODEL_DIR / 'water_rf_4feat.joblib')
meta = joblib.load(MODEL_DIR / 'water_metadata.joblib')

model, scaler, feats, order = pkg['model'], pkg['scaler'], pkg['features'], pkg['order']

# ── FastAPI ───────────────────────────────────
app = FastAPI(title='水质等级预测 API', version='1.0')


@app.middleware('http')
async def log_requests(request: Request, call_next):
    """打印收到的请求"""
    body = await request.body()
    logger.info(
        '收到请求 %s %s client=%s body=%s',
        request.method,
        request.url.path,
        request.client.host if request.client else '-',
        body.decode('utf-8', 'replace') if body else '',
    )
    return await call_next(request)


class PredictRequest(BaseModel):
    temperature: float = Field(..., description='水温(℃)')
    ph: float = Field(..., description='pH(无量纲)')
    ec: float = Field(..., description='电导率(μS/cm)')
    turbidity: float = Field(..., description='浊度(NTU)')
    wet: bool = Field(False, description='是否湿季')


class PredictResponse(BaseModel):
    grade: str                              # 等级，如 "Ⅱ类"
    grade_index: int                        # 0=Ⅰ类 ... 5=劣Ⅵ类
    confidence: float                       # 最大类概率
    probabilities: dict                     # 各类概率


@app.post('/predict', response_model=PredictResponse)
def predict(req: PredictRequest):
    """用 4 个便宜参数预测水质等级"""
    X = np.array([[
        req.temperature,
        req.ph,
        req.ec,
        req.turbidity,
    ]], dtype=float)
    X_s = scaler.transform(X)
    probs = model.predict_proba(X_s)[0]
    idx = int(probs.argmax())

    return PredictResponse(
        grade=order[idx],
        grade_index=idx,
        confidence=round(float(probs[idx]), 4),
        probabilities={order[i]: round(float(p), 4) for i, p in enumerate(probs)},
    )


@app.get('/health')
def health():
    return {'status': 'ok', 'model': '4feat'}


@app.get('/info')
def info():
    return {
        '等级顺序': order,
        '特征清单': feats,
        '互信息(bits)': {k: float(v) for k, v in meta['mutual_info'].items()},
        '测试指标': {k: round(float(v), 4) for k, v in meta['test_metrics'].items()},
    }