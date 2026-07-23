# -*- coding: utf-8 -*-
"""整体形势分析：聚合 SQLite 数据后直接调用 OpenAI 兼容 LLM 上游。"""
from __future__ import annotations

from typing import Any, Optional

import httpx

import store
from config import settings


class LLMAnalysisError(Exception):
    """LLM 分析上游不可用。"""


SYSTEM_PROMPT = (
    "你是公益组织“清源计划”的水质政策分析师。基于给定区域的水质检测统计数据，"
    "面向当地政府/水务部门撰写一份专业、可执行的水质改善提案。\n"
    "要求：以事实和数据说话；给出问题诊断—成因推测—分级改善建议—预期资金用途；"
    "语气专业克制，符合公文风格；用中文 Markdown；篇幅约 400–600 字。\n"
    "只依据给定数据，不得编造具体未提供的数字。"
)


def _fmt(value: Any) -> str:
    return "未提供" if value is None else str(value)


def _build_region_prompt(snapshot: dict[str, Any], region: str) -> str:
    exceed_list = snapshot.get("exceed_list") or []
    exceed = "、".join(exceed_list) if exceed_list else "无明显超标"
    return (
        f"区域：{region}\n"
        f"样本数：{snapshot.get('n', 0)}（真实 {snapshot.get('real_n', 0)} / 历史 {snapshot.get('seed_n', 0)}）\n"
        f"达标率(Ⅰ~Ⅲ类)：{_fmt(snapshot.get('pass_rate'))}\n"
        f"平均水质等级：{_fmt(snapshot.get('avg_grade'))}\n"
        f"指标均值：pH {_fmt(snapshot.get('ph'))}｜TDS {_fmt(snapshot.get('tds'))}ppm｜"
        f"浊度 {_fmt(snapshot.get('turbidity'))}NTU｜电导率 {_fmt(snapshot.get('ec'))}μS/cm\n"
        f"主要超标指标：{exceed}\n"
        f"最差水体类型：{_fmt(snapshot.get('worst_water_type'))}\n"
        f"重污染检测点数：{snapshot.get('polluted_count', 0)}\n"
        "请据此生成该区域的水质改善提案。"
    )


def _local_fallback(snapshot: dict[str, Any]) -> str:
    region = snapshot.get("region") or "全部区域"
    n = snapshot.get("n", 0)
    if n == 0:
        return f"## {region} 水质形势分析\n\n暂无可分析的时序数据。请先通过 `/api/v1/lstm/readings` 上报水质读数。"
    return (
        f"## {region} 水质形势分析（本地兜底）\n\n"
        f"当前样本数为 **{n}**。核心均值：pH={snapshot.get('ph')}，"
        f"EC={snapshot.get('ec')} μS/cm，浊度={snapshot.get('turbidity')} NTU，"
        f"TDS={snapshot.get('tds')} ppm。\n\n"
        "LLM 服务暂不可用，因此先返回规则化摘要。建议持续采集同一点位连续样本，"
        "重点观察浊度、电导率和 pH 的突增 / 突降，并结合 LSTM 异常分数筛查潜在污染事件。"
    )


async def _chat_completion(system: str, user: str) -> str:
    if not settings.deepseek_api_key.strip():
        raise LLMAnalysisError("未配置 DEEPSEEK_API_KEY")

    payload = {
        "model": settings.model,
        "max_tokens": settings.max_tokens,
        "temperature": settings.temperature,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    headers = {
        "Authorization": f"Bearer {settings.deepseek_api_key}",
        "Content-Type": "application/json",
    }
    url = f"{settings.deepseek_base_url.rstrip('/')}/chat/completions"
    timeout = settings.request_timeout or settings.llm_request_timeout

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, headers=headers, json=payload)
    except httpx.HTTPError as exc:
        raise LLMAnalysisError(f"请求上游失败: {exc}") from exc

    if resp.status_code != 200:
        raise LLMAnalysisError(f"上游返回 {resp.status_code}: {resp.text[:500]}")

    try:
        content = resp.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, ValueError) as exc:
        raise LLMAnalysisError(f"响应解析失败: {exc}; 原文: {resp.text[:500]}") from exc

    if not isinstance(content, str) or not content.strip():
        raise LLMAnalysisError("模型返回空内容")
    return content.strip()


async def generate_region_analysis(region: Optional[str], limit: int, no_cache: bool) -> dict[str, Any]:
    snapshot = store.aggregate_snapshot(region, limit)
    region_name = snapshot.get("region") or (region or "全部区域")
    # no_cache 是旧代理接口字段；直连上游时没有本地缓存，保留参数仅为接口兼容。
    _ = no_cache
    try:
        content = await _chat_completion(SYSTEM_PROMPT, _build_region_prompt(snapshot, region_name))
        upstream = {
            "id": 0,
            "region": region_name,
            "model": settings.model,
            "content": content,
            "cached": False,
            "input_summary": snapshot,
        }
        return {"snapshot": snapshot, "llm": upstream, "fallback": False}
    except LLMAnalysisError as exc:
        return {
            "snapshot": snapshot,
            "llm": {
                "id": 0,
                "region": region_name,
                "model": "local-fallback",
                "content": _local_fallback(snapshot),
                "cached": False,
                "input_summary": snapshot,
            },
            "fallback": True,
            "error": str(exc),
        }