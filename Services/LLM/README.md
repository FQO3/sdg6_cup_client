# 水质提案生成服务（LLM）

异步 FastAPI 微服务，实现核心亮点：**测水 → 聚合 → AI 生成本区域改善提案 → 反哺本地政府**（SDG6 + NGO 资金循环）。

- 模型：`gpt-5.5`（OpenAI 兼容，经 `MODEL` 配置可切换）。
  > 本项目中转 key（`api.xinyunai.net`）仅提供 `gpt-5.5` 与 Claude 系列，**不提供 deepseek 模型**；如换用支持 deepseek 的 key，改 `MODEL=deepseek-chat` 即可。
- 端点：`POST {BASE_URL}/chat/completions`，本项目 `BASE_URL=https://api.xinyunai.net/v1`。
- 支持 `region`（区域整体提案）与 `point`（单点位速评+处置建议）两种 scope。
- **实战模式**：输入快照由调用方（业务后端）聚合后随请求传入，本服务不再内置任何演示数据；每次生成落库 SQLite，同库充当缓存。

## 目录

```
Services/LLM/
├── app.py          # FastAPI 入口: generate / records / health
├── llm_client.py   # 异步 LLM 调用(OpenAI 兼容) + 提示词(region/point)
├── store.py        # SQLite 持久化: 生成记录(输入+响应) + 缓存查询
├── schemas.py      # 请求/响应 & 快照 & 记录模型
├── config.py       # 配置 & 密钥(从 .env / 环境变量)
├── requirements.txt
├── .env.example    # 配置模板
├── llm_reports.db  # 运行时生成的 SQLite(已 .gitignore, 需单独备份)
└── .gitignore
```

## 快速开始

```bash
cd Services/LLM
# 本机 python 在 /usr/bin/python3 (3.9)
/usr/bin/python3 -m pip install --user -r requirements.txt

cp .env.example .env       # 填入真实 LLM key
/usr/bin/python3 -m uvicorn app:app --host 0.0.0.0 --port 8090
```

## 接口 · POST /api/v1/insights/generate

输入快照由调用方随请求传入。

**区域提案**（`scope=region`，需 `region` + `region_snapshot`）：

```bash
curl -X POST http://localhost:8090/api/v1/insights/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "scope": "region",
    "region": "武汉市青山区",
    "region_snapshot": {
      "region": "武汉市青山区",
      "n": 42, "real_n": 30, "seed_n": 12,
      "pass_rate": "61%", "avg_grade": "Ⅲ类",
      "ph": 7.4, "tds": 320, "turbidity": 6.2, "ec": 640,
      "exceed_list": ["浊度", "TDS"],
      "worst_water_type": "工业排口下游", "polluted_count": 5
    }
  }'
```

**点位微提案**（`scope=point`，需 `ref_report_id` + `point_snapshot`）：

```bash
curl -X POST http://localhost:8090/api/v1/insights/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "scope": "point",
    "region": "武汉市青山区",
    "ref_report_id": "rpt_123",
    "point_snapshot": {
      "ref_report_id": "rpt_123", "region": "武汉市青山区",
      "water_type": "地表水", "grade": "Ⅳ类",
      "ph": 6.8, "tds": 410, "turbidity": 9.1, "ec": 820, "temperature": 24.5,
      "stability_note": "读数波动小，数据可信"
    }
  }'
```

响应：

```json
{
  "id": 1,
  "region": "武汉市青山区",
  "model": "gpt-5.5",
  "content": "## 青山区水质改善提案\n...(Markdown)",
  "cached": false,
  "input_summary": { }
}
```

- `id`：持久化记录自增 id。
- `cached=true`：命中未过期历史记录直接返回；传 `"no_cache": true` 可强制重新生成。

## 接口 · 历史记录（操作 / 备份）

```bash
# 列表(最新在前, 可按 region 过滤 / 分页)
curl "http://localhost:8090/api/v1/insights/records?limit=20&region=武汉市青山区"

# 单条详情(含完整输入快照 + Markdown 正文)
curl http://localhost:8090/api/v1/insights/records/1

# 清空所有生成记录(清空 SQLite generations 表)
curl -X DELETE http://localhost:8090/api/v1/insights/records
```

清空接口响应示例：

```json
{
  "status": "ok",
  "deleted": 12
}
```

> 注意：`DELETE /api/v1/insights/records` 会删除全部历史生成记录，同时清空基于历史记录的缓存；操作前如需保留数据，请先备份 `llm_reports.db`。

`GET /health` 健康检查。

## 后端流程

1. 校验 scope 所需字段（region+region_snapshot / ref_report_id+point_snapshot）。
2. 查缓存（`scope`+`region`/`ref_report_id`，最近一条未过期）→ 命中 `cached=true` 直接返回。
3. 未命中 → 用请求携带的快照组装 prompt → 调 LLM `/chat/completions`。
4. 落库（输入快照 + 响应正文）→ 返回 Markdown 与记录 `id`。

## 数据存储与备份

- 单文件 SQLite：`Services/LLM/llm_reports.db`（`generations` 表存 scope / region / 输入 JSON / 正文 / 时间戳）。
- 路径可用环境变量 `LLM_DB_PATH` 覆盖。
- 已加入 `.gitignore`（连同 WAL 的 `-wal` / `-shm`），不进版本库。
- 备份：直接复制该 `.db` 文件即可整库迁移/归档。
- 清空：调用 `DELETE /api/v1/insights/records` 删除 `generations` 表内所有生成记录。

## 安全

- 密钥仅存后端 `.env` / 环境变量（`DEEPSEEK_API_KEY`，即 LLM 中转 key），已被 `.gitignore` 忽略，代码不硬编码。
- 大屏/客户端不直连 LLM，一律经本服务（或 Express）代理，统一鉴权/限流/缓存。
- 已设 `REQUEST_TIMEOUT=30s`；前端配 loading 动效；缓存控制 token 消耗。

## 主页面
[跳转链接](/README.md)