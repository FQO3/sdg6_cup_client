# LSTM 时序异常检测服务

`Services/LSTM` 是独立 FastAPI 微服务，用于持续接收水杯/客户端上报的水质时序数据，写入 SQLite，并基于 LSTM 预测：

- **当前输入是否异常**：用上一段连续序列预测本次读数，比较实际值与模型预期的标准化误差。
- **下一输入倾向**：用包含当前读数的最新序列预测下一次读数，输出各指标 `increase / decrease / stable`，并给出变化量、变化率和中文解释。
- **持续再训练**：不是每次输入都训练；累计达到阈值后后台随机减点抽样训练新模型。训练期间继续使用旧模型，新模型训练完成后热切换。
- **整体形势分析**：聚合 SQLite 数据后按 `.env` 配置直连 OpenAI 兼容 LLM 上游生成区域分析；LLM 不可用时返回本地兜底摘要。

## 目录

```text
Services/LSTM/
├── app.py             # FastAPI 入口
├── schemas.py         # 请求/响应模型
├── store.py           # SQLite 存储层
├── model.py           # LSTM 网络与热切换 ModelManager
├── trainer.py         # 后台训练、随机减点、模型保存
├── llm_analysis.py    # 聚合快照 + 直连 OpenAI 兼容 LLM 上游
├── config.py          # 环境变量配置
├── requirements.txt
├── .env.example
└── .gitignore
```

## 快速启动

```bash
cd Services/LSTM
python3 -m pip install -r requirements.txt
cp .env.example .env   # 可按需修改训练阈值 / LLM 上游密钥与地址
python3 -m uvicorn app:app --host 0.0.0.0 --port 8091
```

健康检查：

```bash
curl http://localhost:8091/health
```

## 接口

### POST `/api/v1/lstm/readings`

写入一条实时读数，返回异常判断、下一输入预测与趋势。

```bash
curl -X POST http://localhost:8091/api/v1/lstm/readings \
  -H 'Content-Type: application/json' \
  -d '{
    "device_id": "cup-001",
    "location": { "lat": 30.5, "lng": 114.3, "region": "武汉市洪山区", "address": "南湖附近" },
    "metrics": { "temperature": 25.3, "ph": 7.2, "ec": 684, "turbidity": 1.2, "tds": 342, "wet": true },
    "water_type": "river",
    "measured_at": "2026-07-23T10:30:00Z"
  }'
```

响应核心字段：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "reading_id": 1,
    "abnormal": false,
    "anomaly_score": 0.0,
    "anomaly_reasons": [],
    "predicted_current": null,
    "next_prediction": null,
    "tendency": {
      "per_feature": { "temperature": "stable", "ph": "stable", "ec": "stable", "turbidity": "stable" },
      "detail": {
        "temperature": {
          "direction": "stable",
          "description": "暂无可用 LSTM 预测；冷启动阶段默认视为暂稳。"
        }
      },
      "overall": "stable",
      "explanation": "当前没有足够的已训练模型或连续序列，暂不能判断明确升降趋势；服务返回 stable 作为保守结果。"
    },
    "model_version": null,
    "model_status": "cold_start",
    "training_queued": false,
    "training": {
      "queued": false,
      "started": false,
      "job_id": null,
      "reason": "数据量不足：1/20",
      "message": "未开始训练：数据量不足：1/20",
      "is_training": false
    }
  }
}
```

> 冷启动阶段还没有模型时，服务会用近期滚动统计做兜底异常检测；默认满足 `MIN_TRAIN_POINTS=20` 后可训练出第一版 LSTM。为了更快演示和开发，默认训练需求已调低：`SEQ_LEN=8`、`MIN_TRAIN_POINTS=20`、`TRAIN_EVERY_NEW_POINTS=10`、`TRAIN_EPOCHS=20`。

#### 趋势字段解释

- `increase`：模型预测下一次该指标会高于当前值，超过 `TREND_DEADBAND_RATIO` / `TREND_DEADBAND_ABSOLUTE` 形成的死区阈值。
- `decrease`：模型预测下一次该指标会低于当前值，超过死区阈值。
- `stable`：预测值与当前值差异很小，在死区阈值内，视为暂稳。
- `overall`：四个核心指标投票后的整体方向；如果升/降/稳票数无法形成唯一多数，则为 `mixed`。
- `detail.<feature>.delta`：`predicted_next - current`，正值表示预计上升，负值表示预计下降。
- `detail.<feature>.delta_percent`：相对当前值的变化百分比。

注意：`increase/decrease` 只表示数值方向，不直接等价于水质好坏。例如浊度、EC 上升通常需要关注；pH 上升或下降都需要结合合理区间判断。

### POST `/api/v1/lstm/train`

手动触发训练：

```bash
curl -X POST http://localhost:8091/api/v1/lstm/train \
  -H 'Content-Type: application/json' \
  -d '{"force": true}'
```

典型响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "queued": true,
    "started": true,
    "job_id": 3,
    "reason": "强制训练",
    "message": "已开始后台训练任务 #3：强制训练。训练期间继续使用旧模型，新模型完成后自动热切换。",
    "is_training": true
  }
}
```

### GET `/api/v1/lstm/status`

查看模型版本、训练任务和数据量。

### POST `/api/v1/lstm/admin/clear-database`

清空 LSTM SQLite 数据库中的业务数据，包括：

- `readings` 实时读数
- `training_jobs` 训练任务记录
- `model_versions` 模型版本登记
- `kv` 状态键值，例如 `last_trained_reading_id`

> 该接口不会删除磁盘上的 `models/*.pt` 模型文件；如果当前正在训练，会返回 `409`，避免训练任务与清库并发冲突。

请求必须携带确认码，避免误清空：

```bash
curl -X POST http://localhost:8091/api/v1/lstm/admin/clear-database \
  -H 'Content-Type: application/json' \
  -d '{"confirm":"CLEAR_LSTM_DATABASE", "reset_sequences": true}'
```

典型响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "cleared": true,
    "reset_sequences": true,
    "deleted_counts": {
      "readings": 12,
      "model_versions": 1,
      "training_jobs": 2,
      "kv": 2
    },
    "note": "已清空 SQLite 业务数据；磁盘模型文件未删除。"
  }
}
```

### GET `/api/v1/lstm/readings`

查询最近读数：

```bash
curl 'http://localhost:8091/api/v1/lstm/readings?device_id=cup-001&limit=50'
```

### POST `/api/v1/lstm/analysis/generate`

调用 LLM 做整体形势分析：

```bash
curl -X POST http://localhost:8091/api/v1/lstm/analysis/generate \
  -H 'Content-Type: application/json' \
  -d '{"region":"武汉市洪山区", "limit":300, "no_cache":false}'
```

## 训练策略

1. 数据进入 SQLite `readings` 表。
2. 当总数据量 ≥ `MIN_TRAIN_POINTS` 且距离上次训练新增 ≥ `TRAIN_EVERY_NEW_POINTS` 时，后台启动训练。默认值已降低到 `MIN_TRAIN_POINTS=20`、`TRAIN_EVERY_NEW_POINTS=10`，便于快速进入训练阶段。
3. 训练前会按 `MAX_TRAIN_POINTS` 与 `RANDOM_KEEP_RATIO` 做随机减点抽样，并保持时间顺序。
4. 每个 `device_id` 单独构造滑动窗口，避免不同设备序列交叉。
5. 新模型先保存到 `models/lstm-*.pt`，再更新 `models/latest.json`，最后替换内存引用；因此训练期间不影响旧模型推理。

## 字段约定

LSTM 使用四个核心特征：

- `temperature`：水温 ℃
- `ph`：pH
- `ec`：电导率 μS/cm
- `turbidity`：浊度 NTU

同时会保留 `tds / wet / location / water_type / user_note`，供查询、聚合和 LLM 分析使用。

## 主页面
[跳转链接](/README.md)