# -*- coding: utf-8 -*-
"""
config.py —— 集中配置 & 密钥管理

安全约定(§5.5):
  - 密钥仅存后端环境变量 / .env, 绝不硬编码, 大屏/客户端不接触。
  - .env 已加入 .gitignore, 不进版本库。
  - 首次使用: cp .env.example .env, 填入真实 DEEPSEEK_API_KEY。
"""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # DeepSeek(OpenAI 兼容)密钥, 必填
    deepseek_api_key: str

    # OpenAI 兼容端点(此处使用给定中转 base url)
    deepseek_base_url: str = "https://api.xinyunai.net/v1"

    # 模型(该中转 key 提供 gpt-5.5 / claude 系列; deepseek 不可用)
    model: str = "gpt-5.5"

    # 生成参数
    max_tokens: int = 2048
    temperature: float = 0.6
    request_timeout: float = 30.0

    # 缓存过期(秒); 0 表示永不过期
    cache_ttl: int = 6 * 3600

    model_config = SettingsConfigDict(
        env_file=Path(__file__).parent / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
