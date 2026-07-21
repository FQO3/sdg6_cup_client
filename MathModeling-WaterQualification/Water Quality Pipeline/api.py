# -*- coding: utf-8 -*-
"""
api.py —— FastAPI 水质等级预测接口
启动: python3 -m uvicorn api:app --app-dir . --host 0.0.0.0 --port 8080

接口:
  POST /predict         发送 4 个便宜参数 → 等级 + 置信度 + 各类概率
  GET  /health          健康检查
  GET  /info            模型元信息
  
curl -X POST http://localhost:8080/predict \
  -H "Content-Type: application/json" \
  -d '{"水温(℃)":22.5,"pH(无量纲)":7.2,"电导率(μS/cm)":350,"浊度(NTU)":15}'

"""
import joblib
import numpy as np
from pathlib import Path
from fastapi import FastAPI
from pydantic import BaseModel, Field

# ── 加载模型 ──────────────────────────────────
BASE = Path(__file__).parent
MODEL_DIR = BASE / 'models' if (BASE / 'models').is_dir() else BASE
pkg = joblib.load(MODEL_DIR / 'water_rf_4feat.joblib')
meta = joblib.load(MODEL_DIR / 'water_metadata.joblib')

model, scaler, feats, order = pkg['model'], pkg['scaler'], pkg['features'], pkg['order']

# ── FastAPI ───────────────────────────────────
app = FastAPI(title='水质等级预测 API', version='1.0')


class PredictRequest(BaseModel):
    水温_degC: float = Field(..., alias='水温(℃)', description='水温(℃)')
    pH: float = Field(..., alias='pH(无量纲)', description='pH(无量纲)')
    电导率_uScm: float = Field(..., alias='电导率(μS/cm)', description='电导率(μS/cm)')
    浊度_NTU: float = Field(..., alias='浊度(NTU)', description='浊度(NTU)')


class PredictResponse(BaseModel):
    等级: str
    等级序号: int           # 0=I类 ... 5=劣Ⅵ类
    置信度: float           # 最大类概率
    各类概率: dict


@app.post('/predict', response_model=PredictResponse)
def predict(req: PredictRequest):
    """用 4 个便宜参数预测水质等级"""
    X = np.array([[
        req.水温_degC,
        req.pH,
        req.电导率_uScm,
        req.浊度_NTU,
    ]], dtype=float)
    X_s = scaler.transform(X)
    probs = model.predict_proba(X_s)[0]
    idx = int(probs.argmax())

    return PredictResponse(
        等级=order[idx],
        等级序号=idx,
        置信度=round(float(probs[idx]), 4),
        各类概率={order[i]: round(float(p), 4) for i, p in enumerate(probs)},
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