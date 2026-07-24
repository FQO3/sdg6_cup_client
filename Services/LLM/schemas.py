# -*- coding: utf-8 -*-
"""
schemas.py —— 请求/响应数据模型

对应接口契约:
  POST /api/v1/insights/generate
    scope="region": 为区域生成整体水质改善提案(携带区域聚合快照)
    scope="point":  为单条真实检测生成"点位速评 + 处置建议"(携带点位快照)

实战模式: 快照数据由调用方(业务后端)聚合后随请求传入, 本服务不内置任何演示数据。
"""
from typing import Literal, Optional

from pydantic import BaseModel, Field


class RegionSnapshot(BaseModel):
    """区域聚合快照(由调用方业务后端聚合填充)。"""
    region: str
    n: int = 0
    real_n: int = 0
    seed_n: int = 0
    pass_rate: Optional[str] = None       # 达标率(Ⅰ~Ⅲ类)
    avg_grade: Optional[str] = None       # 平均水质等级
    ph: Optional[float] = None
    tds: Optional[float] = None
    turbidity: Optional[float] = None
    ec: Optional[float] = None
    exceed_list: list[str] = Field(default_factory=list)  # 主要超标指标
    worst_water_type: Optional[str] = None
    polluted_count: int = 0


class PointSnapshot(BaseModel):
    """单点检测快照(scope=point)。"""
    ref_report_id: str
    region: Optional[str] = None
    water_type: Optional[str] = None
    ph: Optional[float] = None
    tds: Optional[float] = None
    turbidity: Optional[float] = None
    ec: Optional[float] = None
    temperature: Optional[float] = None
    grade: Optional[str] = None
    stability_note: Optional[str] = None  # 稳定性诊断


class ClusterSnapshot(BaseModel):
    """聚类区域快照(scope=cluster)。"""
    cluster_uuid: str
    run_uuid: Optional[str] = None
    cluster_type: Optional[str] = None
    label: Optional[str] = None
    count: int = 0
    location: Optional[dict] = None
    center: dict = Field(default_factory=dict)
    radius_m: Optional[float] = None
    avg_grade_index: Optional[float] = None
    dominant_grade: Optional[str] = None
    pass_rate: Optional[str] = None
    polluted_count: int = 0
    grade_distribution: dict = Field(default_factory=dict)
    water_type_distribution: dict = Field(default_factory=dict)
    representative_reports: list[dict] = Field(default_factory=list)


class GenerateRequest(BaseModel):
    scope: Literal["region", "point", "cluster"] = "region"
    region: Optional[str] = Field(None, description="区域名, 如 '武汉市青山区'")
    ref_report_id: Optional[str] = Field(None, description="scope=point 时引用的检测记录 id")
    cluster_uuid: Optional[str] = Field(None, description="scope=cluster 时引用的聚类 id")
    # 实战模式: 由调用方聚合后传入; scope=region 用 region_snapshot, scope=point 用 point_snapshot
    region_snapshot: Optional[RegionSnapshot] = None
    point_snapshot: Optional[PointSnapshot] = None
    cluster_snapshot: Optional[ClusterSnapshot] = None
    no_cache: bool = Field(False, description="为 true 时跳过缓存, 强制重新生成")


class GenerateResponse(BaseModel):
    id: int = Field(..., description="持久化记录自增 id")
    region: str
    model: str
    content: str = Field(..., description="Markdown 提案正文")
    cached: bool = False
    input_summary: dict = Field(default_factory=dict)


class RecordItem(BaseModel):
    """持久化的一条生成记录(输入 + 响应)。"""
    id: int
    scope: str
    region: Optional[str]
    ref_report_id: Optional[str]
    model: str
    input_summary: dict
    content: str
    created_at: str
