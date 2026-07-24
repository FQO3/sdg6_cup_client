# -*- coding: utf-8 -*-
"""
llm_client.py —— 异步调用 LLM(OpenAI 兼容, 默认 gpt-5.5)生成 NGO 水质改善提案

- httpx.AsyncClient 走 OpenAI 兼容 /chat/completions。
- prompt 见 §5.4:
    region: 面向政府/水务部门的区域改善提案(400–600 字 Markdown)
    point:  单点位速评 + 处置建议
- 只依据给定数据, 不编造未提供的具体数字。
"""
import httpx

from config import settings
from schemas import RegionSnapshot, PointSnapshot, ClusterSnapshot


class LLMError(Exception):
    """LLM 上游调用失败。"""


SYSTEM_PROMPT = (
    "你是公益组织“清源计划”的水质政策分析师。基于给定区域的水质检测统计数据，"
    "面向当地政府/水务部门撰写一份专业、可执行的水质改善提案。\n"
    "要求：以事实和数据说话；给出问题诊断—成因推测—分级改善建议—预期资金用途；"
    "语气专业克制，符合公文风格；用中文 Markdown；篇幅约 400–600 字。\n"
    "只依据给定数据，不得编造具体未提供的数字。"
)

SYSTEM_PROMPT_POINT = (
    "你是公益组织“清源计划”的水质分析师。基于单个检测点位的实测数据与稳定性诊断，"
    "撰写一份简洁的“点位速评 + 处置建议”。\n"
    "要求：先给结论/等级，再列关键指标解读，最后给可操作的处置建议；"
    "用中文 Markdown；篇幅约 200–300 字；只依据给定数据，不得编造。"
)

SYSTEM_PROMPT_CLUSTER = (
    "你是公益组织“清源计划”的水质政策分析师。基于一个 K-Means 聚类区域/水质分组的统计快照，"
    "生成面向 NGO 和当地水务部门的聚类专项分析报告。\n"
    "要求：说明该聚类代表的空间或水质特征、风险等级、优先治理原因、建议行动和资金用途；"
    "用中文 Markdown；篇幅约 300–500 字；只依据给定数据，不得编造。"
)


def _fmt(v) -> str:
    return "未提供" if v is None else str(v)


def build_region_prompt(snap: RegionSnapshot) -> str:
    exceed = "、".join(snap.exceed_list) if snap.exceed_list else "无明显超标"
    return (
        f"区域：{snap.region}\n"
        f"样本数：{snap.n}（真实 {snap.real_n} / 历史 {snap.seed_n}）\n"
        f"达标率(Ⅰ~Ⅲ类)：{_fmt(snap.pass_rate)}\n"
        f"平均水质等级：{_fmt(snap.avg_grade)}\n"
        f"指标均值：pH {_fmt(snap.ph)}｜TDS {_fmt(snap.tds)}ppm｜"
        f"浊度 {_fmt(snap.turbidity)}NTU｜电导率 {_fmt(snap.ec)}μS/cm\n"
        f"主要超标指标：{exceed}\n"
        f"最差水体类型：{_fmt(snap.worst_water_type)}\n"
        f"重污染检测点数：{snap.polluted_count}\n"
        "请据此生成该区域的水质改善提案。"
    )


def build_point_prompt(snap: PointSnapshot) -> str:
    return (
        f"检测记录：{snap.ref_report_id}\n"
        f"区域：{_fmt(snap.region)}\n"
        f"水体类型：{_fmt(snap.water_type)}\n"
        f"判定等级：{_fmt(snap.grade)}\n"
        f"指标：pH {_fmt(snap.ph)}｜TDS {_fmt(snap.tds)}ppm｜"
        f"浊度 {_fmt(snap.turbidity)}NTU｜电导率 {_fmt(snap.ec)}μS/cm｜"
        f"温度 {_fmt(snap.temperature)}℃\n"
        f"稳定性诊断：{_fmt(snap.stability_note)}\n"
        "请生成该点位的速评与处置建议。"
    )


def build_cluster_prompt(snap: ClusterSnapshot) -> str:
    center = snap.center or {}
    location = snap.location or {}
    address = location.get("formatted_address") or "未提供"
    return (
        f"聚类：{_fmt(snap.label)}（{snap.cluster_uuid}）\n"
        f"类型：{_fmt(snap.cluster_type)}；样本数：{snap.count}\n"
        f"位置：{address}\n"
        f"中心：lat {_fmt(center.get('lat'))}｜lng {_fmt(center.get('lng'))}\n"
        f"水质中心：pH {_fmt(center.get('ph'))}｜TDS {_fmt(center.get('tds'))}ppm｜"
        f"浊度 {_fmt(center.get('turbidity'))}NTU｜电导率 {_fmt(center.get('ec'))}μS/cm\n"
        f"半径：{_fmt(snap.radius_m)}m；平均等级指数：{_fmt(snap.avg_grade_index)}；优势等级：{_fmt(snap.dominant_grade)}\n"
        f"达标率：{_fmt(snap.pass_rate)}；污染点数：{snap.polluted_count}\n"
        f"等级分布：{snap.grade_distribution}\n"
        f"水体类型分布：{snap.water_type_distribution}\n"
        f"代表样本：{snap.representative_reports[:5]}\n"
        "请据此生成该聚类区域的 LLM 分析报告。"
    )


async def _chat(system: str, user: str) -> str:
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

    try:
        async with httpx.AsyncClient(timeout=settings.request_timeout) as client:
            resp = await client.post(url, headers=headers, json=payload)
    except httpx.HTTPError as e:
        raise LLMError(f"请求上游失败: {e}") from e

    if resp.status_code != 200:
        raise LLMError(f"上游返回 {resp.status_code}: {resp.text[:500]}")

    try:
        content = resp.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, ValueError) as e:
        raise LLMError(f"响应解析失败: {e}; 原文: {resp.text[:500]}") from e

    if not isinstance(content, str) or not content.strip():
        raise LLMError("模型返回空内容")
    return content.strip()


async def generate_region_proposal(snap: RegionSnapshot) -> str:
    return await _chat(SYSTEM_PROMPT, build_region_prompt(snap))


async def generate_point_proposal(snap: PointSnapshot) -> str:
    return await _chat(SYSTEM_PROMPT_POINT, build_point_prompt(snap))


async def generate_cluster_proposal(snap: ClusterSnapshot) -> str:
    return await _chat(SYSTEM_PROMPT_CLUSTER, build_cluster_prompt(snap))
