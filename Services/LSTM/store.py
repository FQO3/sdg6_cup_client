# -*- coding: utf-8 -*-
"""SQLite 存储层：读数、模型版本、训练任务。"""
import json
import sqlite3
import time
from pathlib import Path
from typing import Any, Optional

from config import settings
from schemas import FEATURES, ReadingIn


DB_PATH = Path(settings.lstm_db_path)


SCHEMA = """
CREATE TABLE IF NOT EXISTS readings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id     TEXT NOT NULL,
    region        TEXT,
    address       TEXT,
    lat           REAL,
    lng           REAL,
    water_type    TEXT,
    temperature   REAL NOT NULL,
    ph            REAL NOT NULL,
    ec            REAL NOT NULL,
    turbidity     REAL NOT NULL,
    tds           REAL,
    wet           INTEGER,
    metrics_json  TEXT NOT NULL,
    user_note     TEXT,
    measured_at   TEXT NOT NULL,
    created_ts    REAL NOT NULL,
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_readings_device_id ON readings(device_id, id);
CREATE INDEX IF NOT EXISTS idx_readings_region ON readings(region, id);
CREATE INDEX IF NOT EXISTS idx_readings_created_ts ON readings(created_ts);

CREATE TABLE IF NOT EXISTS model_versions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    version         TEXT NOT NULL UNIQUE,
    path            TEXT NOT NULL,
    seq_len         INTEGER NOT NULL,
    train_points    INTEGER NOT NULL,
    train_sequences INTEGER NOT NULL,
    val_loss        REAL,
    metadata_json   TEXT NOT NULL,
    created_ts      REAL NOT NULL,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS training_jobs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    status       TEXT NOT NULL,
    reason       TEXT,
    detail       TEXT,
    started_at   TEXT,
    finished_at  TEXT,
    created_ts   REAL NOT NULL,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.executescript(SCHEMA)


def insert_reading(req: ReadingIn) -> int:
    loc = req.location
    metrics = req.metrics.model_dump(exclude_none=True)
    measured_at = req.measured_at or now_iso()
    ts = time.time()
    with _connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO readings (
                device_id, region, address, lat, lng, water_type,
                temperature, ph, ec, turbidity, tds, wet, metrics_json,
                user_note, measured_at, created_ts, created_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                req.device_id,
                loc.region if loc else None,
                loc.address if loc else None,
                loc.lat if loc else None,
                loc.lng if loc else None,
                req.water_type,
                req.metrics.temperature,
                req.metrics.ph,
                req.metrics.ec,
                req.metrics.turbidity,
                req.metrics.tds,
                None if req.metrics.wet is None else int(req.metrics.wet),
                json.dumps(metrics, ensure_ascii=False),
                req.user_note,
                measured_at,
                ts,
                now_iso(),
            ),
        )
        return int(cur.lastrowid or 0)


def get_recent_rows(
    *,
    device_id: Optional[str] = None,
    region: Optional[str] = None,
    limit: int = 100,
    before_id: Optional[int] = None,
    include_id: Optional[int] = None,
) -> list[dict[str, Any]]:
    clauses: list[str] = []
    params: list[Any] = []
    if device_id:
        clauses.append("device_id=?")
        params.append(device_id)
    if region:
        clauses.append("region=?")
        params.append(region)
    if before_id is not None:
        clauses.append("id < ?")
        params.append(before_id)
    if include_id is not None:
        clauses.append("id <= ?")
        params.append(include_id)
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    sql = f"SELECT * FROM readings{where} ORDER BY id DESC LIMIT ?"
    params.append(limit)
    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in reversed(rows)]


def get_training_rows(max_points: int) -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM readings ORDER BY id ASC LIMIT ?",
            (max_points,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_all_training_rows() -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute("SELECT * FROM readings ORDER BY id ASC").fetchall()
    return [dict(r) for r in rows]


def count_readings() -> int:
    with _connect() as conn:
        return int(conn.execute("SELECT COUNT(*) FROM readings").fetchone()[0])


def max_reading_id() -> int:
    with _connect() as conn:
        value = conn.execute("SELECT COALESCE(MAX(id), 0) FROM readings").fetchone()[0]
    return int(value or 0)


def get_kv(key: str, default: Optional[str] = None) -> Optional[str]:
    with _connect() as conn:
        row = conn.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
    return str(row["value"]) if row else default


def set_kv(key: str, value: str) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT INTO kv(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )


def save_model_version(
    *,
    version: str,
    path: str,
    seq_len: int,
    train_points: int,
    train_sequences: int,
    val_loss: Optional[float],
    metadata: dict[str, Any],
) -> None:
    ts = time.time()
    with _connect() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO model_versions
            (version, path, seq_len, train_points, train_sequences, val_loss, metadata_json, created_ts, created_at)
            VALUES (?,?,?,?,?,?,?,?,?)
            """,
            (
                version,
                path,
                seq_len,
                train_points,
                train_sequences,
                val_loss,
                json.dumps(metadata, ensure_ascii=False),
                ts,
                now_iso(),
            ),
        )
        conn.execute("INSERT OR REPLACE INTO kv(key, value) VALUES('active_model_version', ?)", (version,))
        conn.execute("INSERT OR REPLACE INTO kv(key, value) VALUES('last_trained_reading_id', ?)", (str(max_reading_id()),))


def latest_model_version() -> Optional[dict[str, Any]]:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM model_versions ORDER BY id DESC LIMIT 1").fetchone()
    if row is None:
        return None
    item = dict(row)
    item["metadata"] = json.loads(item.pop("metadata_json"))
    return item


def clear_database(reset_sequences: bool = True) -> dict[str, Any]:
    """清空 LSTM 服务 SQLite 中的业务数据。

    清空范围：实时读数、模型版本登记、训练任务和 kv 状态。
    注意：该函数只清空数据库记录，不删除磁盘上的模型文件。
    """
    init_db()
    tables = ["readings", "model_versions", "training_jobs", "kv"]
    before: dict[str, int] = {}
    with _connect() as conn:
        for table in tables:
            before[table] = int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
        for table in tables:
            conn.execute(f"DELETE FROM {table}")
        if reset_sequences:
            conn.execute(
                "DELETE FROM sqlite_sequence WHERE name IN ('readings', 'model_versions', 'training_jobs')"
            )

    # VACUUM 不能在事务内部执行，因此清空并提交后单独整理数据库文件。
    with _connect() as conn:
        conn.execute("VACUUM")
    return {
        "cleared": True,
        "reset_sequences": reset_sequences,
        "deleted_counts": before,
        "note": "已清空 SQLite 业务数据；磁盘模型文件未删除。",
    }


def create_training_job(reason: str) -> int:
    ts = time.time()
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO training_jobs(status, reason, created_ts, created_at) VALUES('queued', ?, ?, ?)",
            (reason, ts, now_iso()),
        )
        return int(cur.lastrowid or 0)


def update_training_job(job_id: int, status: str, detail: Optional[str] = None) -> None:
    field = "started_at" if status == "running" else "finished_at"
    with _connect() as conn:
        conn.execute(
            f"UPDATE training_jobs SET status=?, detail=?, {field}=? WHERE id=?",
            (status, detail, now_iso(), job_id),
        )


def list_training_jobs(limit: int = 10) -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute("SELECT * FROM training_jobs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]


def aggregate_snapshot(region: Optional[str], limit: int) -> dict[str, Any]:
    clauses = ["1=1"]
    params: list[Any] = []
    if region:
        clauses.append("region=?")
        params.append(region)
    where = " AND ".join(clauses)
    sql = f"SELECT * FROM readings WHERE {where} ORDER BY id DESC LIMIT ?"
    params.append(limit)
    with _connect() as conn:
        rows = [dict(r) for r in conn.execute(sql, params).fetchall()]

    if not rows:
        return {"region": region or "全部区域", "n": 0, "real_n": 0, "seed_n": 0}

    def avg(name: str) -> Optional[float]:
        values = [r[name] for r in rows if r.get(name) is not None]
        return round(sum(values) / len(values), 4) if values else None

    water_type_counts: dict[str, int] = {}
    for row in rows:
        wt = row.get("water_type") or "未标注"
        water_type_counts[wt] = water_type_counts.get(wt, 0) + 1

    return {
        "region": region or "全部区域",
        "n": len(rows),
        "real_n": len(rows),
        "seed_n": 0,
        "ph": avg("ph"),
        "tds": avg("tds"),
        "turbidity": avg("turbidity"),
        "ec": avg("ec"),
        "temperature": avg("temperature"),
        "worst_water_type": max(water_type_counts, key=lambda key: water_type_counts[key]),
        "polluted_count": 0,
        "exceed_list": [],
    }


def row_features(row: dict[str, Any]) -> list[float]:
    return [float(row[name]) for name in FEATURES]