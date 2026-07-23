# -*- coding: utf-8 -*-
"""
app.py —— FastAPI 入口(实战模式)

现场生成 NGO 水质改善提案(LLM)。核心亮点:
  测水 → 聚合 → AI 生成本区域改善提案 → 反哺本地政府。

路由:
  POST /api/v1/insights/generate  区域 / 点位提案(输入快照由调用方传入)
  GET  /api/v1/insights/records   历史生成记录(输入+响应, 便于操作/备份)
  GET  /api/v1/insights/records/{id}
  GET  /health                    健康检查

持久化: 每次成功生成落库 SQLite(store.py), 同库充当缓存。
安全: 密钥仅存后端, 客户端经此服务代理, 不直连 LLM。
"""
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from schemas import GenerateRequest, GenerateResponse, RecordItem
from llm_client import (
    LLMError,
    generate_region_proposal,
    generate_point_proposal,
)
from store import (
    init_db,
    get_cached,
    save_generation,
    list_records,
    get_record,
)

app = FastAPI(title="清源计划 · 水质提案生成服务", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup() -> None:
    init_db()


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "model": settings.model}


@app.post("/api/v1/insights/generate", response_model=GenerateResponse)
async def generate(req: GenerateRequest) -> GenerateResponse:
    if req.scope == "region":
        if not req.region:
            raise HTTPException(status_code=422, detail="scope=region 需提供 region")
        if req.region_snapshot is None:
            raise HTTPException(status_code=422, detail="scope=region 需提供 region_snapshot")
    else:  # point
        if not req.ref_report_id:
            raise HTTPException(status_code=422, detail="scope=point 需提供 ref_report_id")
        if req.point_snapshot is None:
            raise HTTPException(status_code=422, detail="scope=point 需提供 point_snapshot")

    region_key = req.region or ""

    # 1. 查缓存(命中未过期则直接返回历史记录)
    if not req.no_cache:
        cached = get_cached(req.scope, region_key, req.ref_report_id)
        if cached is not None:
            return GenerateResponse(
                id=cached["id"],
                region=region_key or (req.ref_report_id or ""),
                model=cached["model"],
                content=cached["content"],
                cached=True,
                input_summary=cached["snapshot"],
            )

    # 2. 调 LLM(输入快照来自请求)
    try:
        if req.scope == "region":
            snap = req.region_snapshot
            content = await generate_region_proposal(snap)  # type: ignore[arg-type]
            summary = snap.model_dump()  # type: ignore[union-attr]
            region_out = region_key
        else:
            snap = req.point_snapshot
            content = await generate_point_proposal(snap)  # type: ignore[arg-type]
            summary = snap.model_dump()  # type: ignore[union-attr]
            region_out = req.region or (req.ref_report_id or "")
    except LLMError as e:
        raise HTTPException(status_code=502, detail=f"提案生成失败: {e}") from e

    # 3. 落库(输入+响应)
    rec_id = save_generation(req.scope, region_key, req.ref_report_id,
                             content, settings.model, summary)

    return GenerateResponse(
        id=rec_id,
        region=region_out,
        model=settings.model,
        content=content,
        cached=False,
        input_summary=summary,
    )


@app.get("/api/v1/insights/records", response_model=list[RecordItem])
async def records(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    region: Optional[str] = None,
) -> list[RecordItem]:
    return list_records(limit=limit, offset=offset, region=region)


@app.get("/api/v1/insights/records/{record_id}", response_model=RecordItem)
async def record_detail(record_id: int) -> RecordItem:
    item = get_record(record_id)
    if item is None:
        raise HTTPException(status_code=404, detail="记录不存在")
    return item
