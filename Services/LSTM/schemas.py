# -*- coding: utf-8 -*-
"""Pydantic 请求 / 响应模型。"""
from typing import Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator


FEATURES = ["temperature", "ph", "ec", "turbidity"]
Direction = Literal["increase", "decrease", "stable"]


class Metrics(BaseModel):
    """与客户端 Metrics 保持兼容，LSTM 使用其中 4 个核心时序特征。"""

    temperature: float = Field(..., description="水温(℃)")
    ph: float = Field(..., ge=0, le=14, description="pH")
    ec: float = Field(..., ge=0, description="电导率(μS/cm)")
    turbidity: float = Field(..., ge=0, description="浊度(NTU)")
    tds: Optional[float] = Field(None, ge=0, description="TDS(ppm)")
    wet: Optional[bool] = Field(None, description="是否浸没 / 湿季标记")

    def feature_vector(self) -> list[float]:
        return [float(getattr(self, name)) for name in FEATURES]


class Location(BaseModel):
    lat: Optional[float] = None
    lng: Optional[float] = None
    region: Optional[str] = Field(None, description="反地理编码区域，如 武汉市洪山区")
    address: Optional[str] = Field(None, description="更细地址 / 点位文字描述")


class ReadingIn(BaseModel):
    device_id: str = Field(..., min_length=1)
    metrics: Metrics
    location: Optional[Location] = None
    water_type: Optional[str] = None
    measured_at: Optional[str] = Field(None, description="ISO8601，缺省使用服务端时间")
    user_note: Optional[str] = None


class TrendResult(BaseModel):
    per_feature: dict[str, Direction]
    detail: dict[str, dict[str, Union[float, str]]] = Field(
        default_factory=dict,
        description="每个指标的趋势解释：当前值、预测值、变化量、变化率、死区阈值、中文说明",
    )
    overall: Literal["increase", "decrease", "stable", "mixed"]
    explanation: str = Field("", description="整体趋势中文说明")


class TrainingSignal(BaseModel):
    queued: bool = False
    started: bool = False
    job_id: Optional[int] = None
    reason: str
    message: str
    is_training: bool = False


class PredictionResult(BaseModel):
    reading_id: int
    abnormal: bool
    anomaly_score: float
    anomaly_reasons: list[str] = Field(default_factory=list)
    predicted_current: Optional[dict[str, float]] = None
    next_prediction: Optional[dict[str, float]] = None
    tendency: TrendResult
    model_version: Optional[str] = None
    model_status: str
    training_queued: bool = False
    training: TrainingSignal


class TrainRequest(BaseModel):
    force: bool = Field(False, description="即使新增数据不足也强制训练")


class ClearDatabaseRequest(BaseModel):
    confirm: str = Field(..., description="危险操作确认码，必须为 CLEAR_LSTM_DATABASE")
    reset_sequences: bool = Field(True, description="是否重置 SQLite 自增 ID")


class AnalysisRequest(BaseModel):
    region: Optional[str] = None
    limit: int = Field(300, ge=20, le=5000)
    no_cache: bool = False

    @field_validator("region")
    @classmethod
    def normalize_region(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        return value or None