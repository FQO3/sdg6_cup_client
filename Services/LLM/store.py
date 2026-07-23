# -*- coding: utf-8 -*-
"""
store.py —— 生成记录持久化(SQLite, 实战模式)

单文件 SQLite 数据库 `llm_reports.db`(可整文件备份/迁移), 保存每次生成的
输入(快照 JSON)与响应(Markdown 正文), 同时充当缓存:
  - 查缓存: 按 (scope, cache_key) 命中且未过期 → cached=true
  - 写入: 每次成功生成落库一条, 便于审计/操作/备份

数据库路径可用环境变量 LLM_DB_PATH 覆盖; 默认在本模块同目录。
"""
import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Optional

from config import settings
from schemas import RecordItem

DB_PATH = os.getenv("LLM_DB_PATH") or str(Path(__file__).parent / "llm_reports.db")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS generations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    scope         TEXT    NOT NULL,
    region        TEXT,
    ref_report_id TEXT,
    cache_key     TEXT    NOT NULL,
    model         TEXT    NOT NULL,
    input_json    TEXT    NOT NULL,
    content       TEXT    NOT NULL,
    created_ts    REAL    NOT NULL,
    created_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gen_cache  ON generations(scope, cache_key, created_ts);
CREATE INDEX IF NOT EXISTS idx_gen_region ON generations(region);
"""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.executescript(_SCHEMA)


def _cache_key(region: str, ref_report_id: Optional[str]) -> str:
    return ref_report_id or region


def get_cached(scope: str, region: str, ref_report_id: Optional[str]) -> Optional[dict]:
    """取最近一条未过期记录作为缓存命中。"""
    key = _cache_key(region, ref_report_id)
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, model, input_json, content, created_ts "
            "FROM generations WHERE scope=? AND cache_key=? "
            "ORDER BY created_ts DESC LIMIT 1",
            (scope, key),
        ).fetchone()
    if row is None:
        return None
    if settings.cache_ttl and (time.time() - row["created_ts"] > settings.cache_ttl):
        return None
    return {
        "id": row["id"],
        "model": row["model"],
        "content": row["content"],
        "snapshot": json.loads(row["input_json"]),
    }


def save_generation(scope: str, region: str, ref_report_id: Optional[str],
                    content: str, model: str, snapshot: dict) -> int:
    """落库一条生成记录, 返回自增 id。"""
    key = _cache_key(region, ref_report_id)
    now = time.time()
    created_at = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(now))
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO generations "
            "(scope, region, ref_report_id, cache_key, model, input_json, content, created_ts, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (
                scope, region or None, ref_report_id, key, model,
                json.dumps(snapshot, ensure_ascii=False), content, now, created_at,
            ),
        )
        return int(cur.lastrowid or 0)


def list_records(limit: int = 50, offset: int = 0,
                 region: Optional[str] = None) -> list[RecordItem]:
    sql = "SELECT * FROM generations"
    params: list = []
    if region:
        sql += " WHERE region=?"
        params.append(region)
    sql += " ORDER BY id DESC LIMIT ? OFFSET ?"
    params += [limit, offset]
    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_to_item(r) for r in rows]


def get_record(record_id: int) -> Optional[RecordItem]:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM generations WHERE id=?", (record_id,)).fetchone()
    return _to_item(row) if row else None


def _to_item(row: sqlite3.Row) -> RecordItem:
    return RecordItem(
        id=row["id"],
        scope=row["scope"],
        region=row["region"],
        ref_report_id=row["ref_report_id"],
        model=row["model"],
        input_summary=json.loads(row["input_json"]),
        content=row["content"],
        created_at=row["created_at"],
    )


def clear_records() -> int:
    """清空所有生成记录, 返回删除的行数。"""
    with _connect() as conn:
        cur = conn.execute("DELETE FROM generations")
        return cur.rowcount
