# -*- coding: utf-8 -*-
"""
config.py —— Services/LSTM 集中配置。

本服务定位为实时水质时序学习服务：SQLite 落库，后台按批次训练 LSTM，
训练完成后热切换新模型；训练期间推理继续使用旧模型。
"""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).parent


class Settings(BaseSettings):
    # ── 存储 ─────────────────────────────────────
    lstm_db_path: str = str(BASE_DIR / "lstm_readings.db")
    model_dir: str = str(BASE_DIR / "models")

    # ── LSTM 训练 / 推理 ──────────────────────────
    # 为了让服务更快从 cold_start 进入可训练状态，默认训练门槛保持偏低：
    # 单设备至少需要 seq_len + 1 条连续样本才能构造一个训练窗口。
    seq_len: int = 8
    min_train_points: int = 20
    train_every_new_points: int = 10
    max_train_points: int = 5000
    random_keep_ratio: float = 0.8
    train_epochs: int = 20
    batch_size: int = 64
    learning_rate: float = 1e-3
    hidden_size: int = 64
    num_layers: int = 1
    dropout: float = 0.0
    validation_ratio: float = 0.15
    seed: int = 42

    # 当前输入异常判定阈值：预测误差的标准化 RMSE 超过该值视为异常。
    anomaly_z_threshold: float = 2.5
    # 趋势判断死区：小于 max(abs(current) * ratio, absolute) 判 stable。
    trend_deadband_ratio: float = 0.01
    trend_deadband_absolute: float = 1e-3

    # ── LLM 直连(OpenAI 兼容) ─────────────────────
    # LSTM 的整体形势分析不再依赖本地 Services/LLM:8090 代理，
    # 而是直接读取 .env 中的上游配置请求 /chat/completions。
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.xinyunai.net/v1"
    model: str = "gpt-5.5"
    max_tokens: int = 2048
    temperature: float = 0.6
    request_timeout: float = 30.0

    # 兼容旧变量名：如果只配置了 LLM_REQUEST_TIMEOUT，也会作为直连超时使用。
    llm_request_timeout: float = 30.0

    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings = get_settings()