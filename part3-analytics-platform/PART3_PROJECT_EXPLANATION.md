# part3-analytics-platform 项目说明

`part3-analytics-platform` 是 SDG6 水质检测 Hackathon 项目的第三部分：**大数据分析与 NGO 决策支持平台**。它负责接收客户端上传的水质检测报告，存储到本地 SQLite 数据库，在大屏上展示 AMAP 地理态势，并把区域或点位快照转发给队友提供的 LLM / LSTM 服务进行进一步分析。

本目录目前已经从原来的 Express + SQLite 后端，改造为 **Nuxt3 全栈项目**：前端大屏由 `pages/index.vue` 提供，后端接口由 Nuxt Nitro 的 `server/api/**` 提供，原有 `src/**` 中的数据库、配置、工具函数和外部服务 client 继续复用。

---

## 1. 项目定位

在整个 SDG6 项目中，三端分工如下：

1. **水杯端**：BW16 + BLE + 水质传感器，持续采集 pH、TDS、电导率、浊度、温度等原始数据。
2. **客户端**：接收 BLE 数据，执行稳定性判断、离散点过滤、评分，并在用户确认后上传报告。
3. **大数据分析端，也就是本项目**：保存所有检测报告，展示地图态势，按区域聚合水质问题，并把数据快照交给 LLM / LSTM 服务生成 NGO 可用的提案和时序分析。

本平台更偏向评委演示和 NGO 后台，而不是普通用户 App。它的核心价值是：

- 让评委看到水质检测数据如何形成城市级地图态势；
- 让 NGO 工作者看到不同区域的风险排序；
- 让外部 LLM 基于真实数据快照生成政府汇报 / 公益行动建议；
- 让外部 LSTM 服务分析水质随时间变化的趋势。

---

## 2. 当前技术栈

| 模块 | 技术 |
|---|---|
| 全栈框架 | Nuxt 3.15.1 |
| 前端框架 | Vue 3.5.13 |
| 后端运行时 | Nuxt Nitro |
| 数据库 | SQLite |
| SQLite 驱动 | better-sqlite3 |
| 地图 | AMAP 高德地图 JS API / Web Service |
| LLM 编排 | 调用队友 FastAPI 服务，默认 `http://localhost:8090` |
| LSTM 编排 | 调用队友 FastAPI 服务，默认 `http://localhost:8091` |
| 旧后端兼容 | 保留 Express 依赖和 `src/routes/**` 作为历史实现参考 |

---

## 3. 目录结构说明

```txt
part3-analytics-platform/
├── app.vue                     # Nuxt 根组件，只渲染 NuxtPage
├── nuxt.config.ts              # Nuxt 配置，端口、标题、字体、AMAP Web Key 等
├── package.json                # npm scripts 与依赖
├── .env.example                # 环境变量示例
├── data/
│   └── analytics.sqlite        # SQLite 数据库
├── pages/
│   └── index.vue               # 大屏首页：AMAP + KPI + 报告流 + LLM/LSTM 操作
├── server/
│   ├── api/v1/                 # Nuxt Nitro API 路由
│   └── utils/                  # Nitro API 复用工具
├── src/
│   ├── db.js                   # SQLite 初始化和连接
│   ├── config.js               # 环境变量配置
│   ├── seed.js                 # 北京演示种子数据
│   ├── services/               # AMAP / LLM / LSTM 外部服务 client
│   ├── utils/                  # 通用函数、响应结构、枚举常量
│   └── routes/                 # 旧 Express Router 实现，保留作参考
├── P3_API_DESIGN.md            # API 设计文档
└── ORCHESTRATION_API.md        # 与队友服务编排对接文档
```

---

## 4. 核心数据流

### 4.1 客户端上传检测报告

客户端不是直接上传一次传感器瞬时值，而是执行以下流程：

1. 用户点击“开始记录”；
2. 水杯端持续检测水质；
3. 客户端等待数据进入基本稳定状态；
4. 去除离散值和不稳定阶段数据；
5. 收集满 20 条稳定原始传感器数据；
6. 客户端对 20 条样本进行评级，评级取出现次数最多的类别；
7. 用户输入附加文本；
8. 用户勾选确认“上传的是真实水体数据”；
9. 用户选择水体类型，例如自来水、河水、湖水、井水、纯净水、矿泉水、煮沸后的水等；
10. 客户端调用 `POST /api/v1/reports` 上传报告。

后端会强校验：

- `raw_samples` 必须是数组；
- 默认必须正好 20 条稳定样本；
- `authenticity_confirmed` 必须为 `true`；
- `water_type` 必须是允许枚举；
- `grade` 和 `grade_index` 必须合法；
- 经纬度和核心指标必须是有效数字。

### 4.2 后端存储

报告保存到 SQLite 的 `reports` 表，主要字段包括：

- `report_id`
- `device_id`
- `lat` / `lng`
- `city` / `district` / `address`
- `water_type`
- `tds` / `ph` / `temperature` / `turbidity` / `ec`
- `grade` / `grade_index`
- `authenticity_confirmed`
- `user_note`
- `raw_samples_json`
- `capture_json`
- `measured_at` / `created_at`

### 4.3 大屏展示

`pages/index.vue` 会加载以下数据：

- `GET /api/v1/dashboard/overview`：总报告数、真实报告数、达标率、污染数量等 KPI；
- `GET /api/v1/map/points`：地图点位散点；
- `GET /api/v1/map/districts`：区域聚合和等级分布；
- `GET /api/v1/reports`：最新报告流。

如果配置了 `AMAP_WEB_KEY`，前端会加载高德地图 JS API；如果没有配置，则自动显示 fallback 风格的散点地图，方便 Hackathon 演示不被 Key 配置卡住。

### 4.4 LLM 分析

当用户在大屏点击“生成区域提案”或点击某条报告时，本平台会：

1. 从 SQLite 聚合区域快照或单点快照；
2. 调用队友的 LLM 服务；
3. 接收 Markdown 格式的分析内容；
4. 写入 `analysis_results` 表缓存；
5. 在前端右侧面板显示。

LLM 默认服务地址：

```txt
http://localhost:8090
```

对应后端 client：

```txt
src/services/llmClient.js
```

### 4.5 LSTM 时序分析

LSTM 可能耗时较长，所以本平台用异步 job 包装：

1. 前端点击“启动时序分析”；
2. 调用 `POST /api/v1/analysis/lstm/jobs`；
3. 后端创建 `analysis_jobs` 记录，状态为 `pending`；
4. 后端异步调用队友 LSTM 服务；
5. 前端轮询 `GET /api/v1/analysis/lstm/jobs/:job_id`；
6. 成功后展示 LSTM 返回的结果。

LSTM 默认服务地址：

```txt
http://localhost:8091
```

对应后端 client：

```txt
src/services/lstmClient.js
```

---

## 5. API 总览

所有 API 返回结构统一为：

```json
{
  "code": 0,
  "message": "ok",
  "data": {}
}
```

错误时会返回非 0 `code`，并带错误信息。

### Health

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/v1/health` | 查看服务状态、数据库路径、外部集成配置 |

### Reports

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/v1/reports` | 分页查询报告列表 |
| POST | `/api/v1/reports` | 上传一条检测报告 |
| GET | `/api/v1/reports/:report_id` | 查询单条报告详情 |

常用查询参数：

- `city`
- `district`
- `water_type`
- `real_only`
- `limit`
- `offset`

### Map

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/v1/map/points` | 获取地图点位，返回 `markers` 数组 |
| GET | `/api/v1/map/districts` | 获取区域聚合、等级分布、平均指标 |

### Dashboard

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/v1/dashboard/overview` | 大屏 KPI 总览 |
| GET | `/api/v1/dashboard/trend` | 按天或周聚合的趋势序列 |

### Insights / LLM

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/v1/insights/generate` | 生成区域或单点 LLM 提案 |
| GET | `/api/v1/insights/records` | 查询已生成的 LLM 记录 |
| GET | `/api/v1/insights/records/:id` | 查询某条 LLM 记录详情 |

### Analysis / LSTM

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/v1/analysis/lstm/jobs` | 创建 LSTM 时序分析任务 |
| GET | `/api/v1/analysis/lstm/jobs` | 查询 LSTM 任务列表 |
| GET | `/api/v1/analysis/lstm/jobs/:job_id` | 查询单个 LSTM 任务状态和结果 |

### Geo / AMAP

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/v1/geo/reverse` | 根据经纬度调用高德逆地理编码 |

---

## 6. 关键环境变量

参考 `.env.example`：

```env
PORT=4000
NODE_ENV=development
DB_PATH=./data/analytics.sqlite
DEFAULT_CITY=beijing
ALLOW_SHORT_SAMPLES=false

AMAP_KEY=
AMAP_WEB_KEY=
AMAP_REVERSE_URL=https://restapi.amap.com/v3/geocode/regeo
AMAP_TIMEOUT_MS=8000

LLM_SERVICE_URL=http://localhost:8090
LLM_TIMEOUT_MS=60000
LLM_CACHE_TTL_HOURS=6

LSTM_SERVICE_URL=http://localhost:8091
LSTM_TIMEOUT_MS=30000
```

说明：

- `AMAP_KEY`：服务端调用逆地理编码用；
- `AMAP_WEB_KEY`：前端加载高德地图 JS API 用；
- `ALLOW_SHORT_SAMPLES=false`：默认要求上传 20 条稳定样本；
- `LLM_SERVICE_URL`：队友 LLM 服务地址；
- `LSTM_SERVICE_URL`：队友 LSTM 服务地址。

---

## 7. 运行方式

安装依赖：

```bash
npm install
```

写入演示数据：

```bash
npm run seed
```

开发模式：

```bash
npm run dev
```

生产构建：

```bash
npm run build
```

生产启动：

```bash
npm run start
```

默认端口是 `4000`，访问：

```txt
http://localhost:4000
```

---

## 8. 当前已验证状态

当前项目已完成以下验证：

- `npm install` 成功；
- `npm run seed` 成功；
- `npm run check` 成功；
- `npm run build` 成功；
- 首页 `/` 可访问；
- 核心 API 可访问：
  - `/api/v1/health`
  - `/api/v1/map/points`
  - `/api/v1/map/districts`
  - `/api/v1/reports`
  - `/api/v1/reports/:report_id`
  - `/api/v1/dashboard/trend`
  - `/api/v1/insights/records`
  - `/api/v1/analysis/lstm/jobs`

---

## 9. 给评委演示时的讲法

可以这样解释本部分：

> 这是 SDG6 项目的大数据分析与 NGO 决策支持平台。用户用智能水杯检测水质，客户端会先过滤不稳定数据和离散点，只上传 20 条稳定原始样本与最终评级。后台把所有检测记录按区域存储和聚合，并在 AMAP 上展示城市水质点位。NGO 工作者可以看到哪些区域风险更高、哪些水体类型问题更集中，然后一键调用 LLM 生成面向政府或水资源组织的改善提案。同时，平台把区域水质数据发送给 LSTM 服务做时序分析，用于观察水质是否正在变差或改善。这样，水杯不只是单点检测工具，而是一个可以形成公共水质数据网络和公益资金决策依据的平台。

---

## 10. 后续可继续增强的方向

1. 把 LLM 生成改为真正异步 job，避免慢请求阻塞；
2. 增加登录和 NGO 工作台权限；
3. 增加基金分区管理模块，把检测区域、污染风险和公益基金关联；
4. 接入真实 AMAP 区域边界 GeoJSON，做区级热力图；
5. 增加 CSV / PDF 导出，用于政府汇报材料；
6. 增加异常点审核机制，避免恶意上传或错误传感器数据影响 NGO 决策；
7. 将 SQLite 切换到 PostgreSQL，适合公网部署和多人并发。
