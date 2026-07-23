# 第 3 部分 · 大数据分析平台 + 可视化大屏 — 架构设计

> 状态：**设计阶段（不写代码）** · 面向 Hackathon 评委的「eye-catching 总览平台」
> 定位：把「存报告的普通后端」升级为「有叙事、有数据、有 AI 的大数据分析平台」
> 本文件是第 3 部分的唯一设计事实来源，字段口径与 `client/types/reading.ts` 对齐。

---

## 0. 三个待定决策（已给默认值，可直接覆盖）

设计不阻塞于此，正文按 **默认值** 展开；你改主意只需替换对应小节。

| # | 决策项 | 目标值（务实/3天最快） | 备选 | 影响范围 |
|---|--------|----------------------|------|---------|
| D1 | 数据库 | **SQLite**（单文件、零运维、聚合 SQL 够用） | PostgreSQL(+PostGIS) / MongoDB | §2 数据表、§3 聚合 SQL |
| D2 | 演示城市 | **北京**（区县坐标已内置于种子设计） | 任意城市（替换种子坐标中心） | §4 种子数据 |
| D3 | 地图底图 | **deck.gl + Mapbox**（React 生态，视觉最炸） | 高德 JS API（国内定位/底图更准） | §6 大屏地图层 |

---

## 1. 总体架构

```
                          ┌──────────────── 现场实时（真实数据·主角）──────────────┐
  水杯(ESP32/BLE) ──LIVE──► 客户端(Nuxt3 BFF) ──► Pipeline(FastAPI RF 判级)
                                     │                          │
                                     │  提交报告(20条聚合)        │ grade
                                     ▼                          ▼
                          ┌───────────────────────────────────────────────┐
                          │        分析后端 (Express :4000)                 │
                          │  POST /api/v1/reports   ← 写库(is_seed=false)   │
                          │  GET  /api/v1/analytics/* ← 聚合查询            │
                          │  POST /api/v1/insights/generate ← 现场调 LLM   │
                          └───────────────┬───────────────────────────────┘
                                          │
         seed 脚本 ──(is_seed=true)──►  数据库 (reports / llm_reports)
                                          │
                                          ▼
                          ┌───────────────────────────────────────────────┐
                          │   可视化大屏 (独立 React 项目 · deck.gl)         │
                          │   实时轮询/推送 analytics API → 渲染驾驶舱一屏   │
                          │   点击检测点 → 一键生成 NGO 提案(调 insights)   │
                          └───────────────────────────────────────────────┘
                                          │
                                          ▼
                                   DeepSeek API (OpenAI 兼容)
```

**关键设计原则**
1. **真实为主角 + 仿真铺底**：真实点走完整链路入库 `is_seed=false`，大屏发光/LIVE 标签、可点开详情；仿真种子 `is_seed=true` 作历史底色，让地图不空。
2. **大屏是独立 React 项目**，只通过 HTTP 与 Express 后端对接，**不侵入现有 Nuxt3 客户端**（切栈成本被隔离在大屏内）。
3. **数据已天然齐全**：现有 `ReportPayload` 已含地理/水体/指标/评级/时间，第 3 部分主要工作是「存好→聚合→可视化→LLM」，不重新采集。
4. **LLM 现场实时生成 + 缓存**：演示时点按钮现场出提案；结果入 `llm_reports` 缓存，避免重复烧 token。

---

## 2. 数据模型（默认 SQLite）

### 2.1 `reports` — 检测记录主表（大屏数据心脏）

直接落地 `ReportPayload`（见 `client/types/reading.ts`），指标字段**拍平存储**便于聚合。

| 列 | 类型 | 来源 / 说明 |
|----|------|------------|
| `id` | INTEGER PK AUTOINCREMENT | 主键 |
| `device_id` | TEXT | 水杯设备 ID |
| `lat` | REAL | `location.lat` |
| `lng` | REAL | `location.lng` |
| `region` | TEXT | `location.region` 反地理编码，如「武汉市洪山区」·聚合主键 |
| `water_type` | TEXT | 8 类枚举 tap/river/lake/well/purified/mineral/boiled/other |
| `tds` | REAL | `metrics.tds`（ppm） |
| `ph` | REAL | `metrics.ph` |
| `temperature` | REAL | `metrics.temperature`（℃） |
| `turbidity` | REAL | `metrics.turbidity`（NTU） |
| `ec` | REAL | `metrics.ec`（μS/cm） |
| `grade` | TEXT | GB 六等级 Ⅰ类…劣Ⅵ类（20 条众数） |
| `grade_index` | INTEGER | 0–5，聚合/达标率用 |
| `authenticity_confirmed` | INTEGER(bool) | 用户真实性确认框 |
| `measured_at` | TEXT(ISO8601) | 检测时间 · 趋势时间轴 |
| `created_at` | TEXT(ISO8601) | 入库时间 |
| **`is_seed`** | INTEGER(bool) | ⭐ 真实=0 / 仿真种子=1 |
| `raw_samples` | TEXT(JSON) | 20 条原始传感器读数 `Metrics[]` |
| `stability` | TEXT(JSON) | `CaptureAggregate.stability` 诊断 |
| `user_note` | TEXT NULL | 附加文本 |

**索引**：`region`、`grade_index`、`measured_at`、`is_seed`。

> **设计决策：region 与 lat/lng 分离存储**
> - `region`（如"武汉市洪山区"）来源于前端反地理编码文本，用作区域聚合的 GROUP BY 主键
> - `lat` / `lng` 保留原始上报坐标，不因反地理编码而丢弃，专供地图散点层渲染（`/analytics/map`）
> - 两者无依赖关系：反地理编码失败时 region 可为空，lat/lng 始终存在
> - 大屏得分：region 驱动排行榜/雷达图/LLM 提案聚合；lat/lng 驱动 deck.gl 点位置

### 2.2 `llm_reports` — LLM 提案缓存

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | INTEGER PK | |
| `region` | TEXT | 目标区域 |
| `scope` | TEXT | 'region' / 'point'（区域提案 / 单点提案） |
| `ref_report_id` | INTEGER NULL | scope=point 时关联 reports.id |
| `input_summary` | TEXT(JSON) | 喂给 LLM 的聚合快照（可复现） |
| `content` | TEXT | 生成的提案全文（Markdown） |
| `model` | TEXT | 实际使用的模型名（可追溯） |
| `created_at` | TEXT | |

### 2.3 关于 `region_stats` 预聚合表 —— **不建**

Hackathon 数据量（种子≤150 + 现场数十条）下，实时 `GROUP BY` 毫秒级返回。预聚合表徒增复杂度与不一致风险。**保持简单，直接查 `reports`。**

---

## 3. 聚合口径与分析 API

所有聚合默认对 **全量数据（真实+种子）** 统计，支持 `?real_only=true` 只看真实点（评委验证"这是现场真实测的"）。

### 3.1 API 契约（前缀 `GET /api/v1/analytics/`）

| 端点 | 返回 | 大屏消费方 |
|------|------|-----------|
| `/overview` | `{ total, region_count, avg_grade_index, pass_rate }` | 顶部指标条（数字滚动） |
| `/map` | `[{ id, lat, lng, region, grade_index, water_type, is_seed, measured_at }]` | 中央地图散点/热力 |
| `/regions/ranking` | `[{ region, count, avg_grade_index, pass_rate }]` desc | 左侧区域排行榜 |
| `/water-types` | `[{ water_type, count, avg_grade_index }]` | 左侧水体类型环形图 |
| `/trend?days=30&bucket=day` | `[{ date, count, avg_grade_index, pass_rate }]` | 右侧趋势曲线 |
| `/radar?region=X` | `{ ph, tds, turbidity, ec, temperature }` 归一化均值 | 右侧指标雷达图 |
| `/report/:id` | 单条 `reports` 全字段 + raw_samples | 点击散点→详情弹窗 |
| `/live?after=<ts>` | 时间戳后新增真实点（增量） | 演示"实时冒发光新点" |

### 3.2 口径定义（现场解释一致）

- **达标率 pass_rate**：`grade_index ≤ 2`（Ⅰ~Ⅲ 类=可作饮用水源）占比。Ⅲ 类是饮用水叙事分水岭。
- **平均水质 avg_grade_index**：`grade_index` 算术平均（0 最好、5 最差），映射回 Ⅰ~劣Ⅵ 文字。
- **区域排行**：按 `pass_rate`/`avg_grade_index` 排序（可切换），突出"哪些区域差→NGO 该资助谁"。
- **趋势 bucket**：`day` 为主，数据少时切 `week`。

### 3.3 聚合 SQL 示意（SQLite）

```sql
-- overview
SELECT COUNT(*) total, COUNT(DISTINCT region) region_count,
       AVG(grade_index) avg_grade_index,
       AVG(CASE WHEN grade_index<=2 THEN 1.0 ELSE 0 END) pass_rate
FROM reports;

-- 区域排行（水质差的排前，指向 NGO 资助对象）
SELECT region, COUNT(*) count, AVG(grade_index) avg_grade_index,
       AVG(CASE WHEN grade_index<=2 THEN 1.0 ELSE 0 END) pass_rate
FROM reports GROUP BY region ORDER BY pass_rate ASC;

-- 趋势（按天）
SELECT date(measured_at) date, COUNT(*) count, AVG(grade_index) avg_grade_index
FROM reports GROUP BY date(measured_at) ORDER BY date;
```

### 3.4 实时更新

- **默认**：大屏每 5s 轮询 `/overview` + `/live?after=<lastTs>`，简单可靠，演示不出错。
- 备选：SSE/WebSocket 推送（更实时但增复杂度，非必要不上）。

---

## 4. 仿真种子数据策略（"铺底"，决定大屏好不好看）

目标：地图不空、排行有对比、趋势有起伏、故事有落点。

### 4.1 规模与分布

- **数量**：100–150 条，`is_seed=1`。
- **地理**（默认北京）：围绕 7–9 个区县坐标中心，每区县撒 12–20 点，半径 ~0.03° 随机抖动。
  区县示例：江岸/江汉/硚口/汉阳/武昌/青山/洪山/东西湖/蔡甸。
- **时间**：`measured_at` 均匀散布过去 30 天（趋势曲线才有形状）。

### 4.2 合理性规则（数据"有故事"，评委信服）

按 `water_type` 生成符合直觉的 `grade` 分布：

| 水体类型 | 期望 grade 主分布 |
|---------|------------------|
| purified / mineral | Ⅰ~Ⅱ 类 |
| tap / boiled | Ⅱ~Ⅲ 类 |
| well | Ⅲ~Ⅳ 类 |
| river / lake | Ⅳ~Ⅴ 类，少量劣Ⅵ类（污染点） |

指标（tds/ph/turbidity/ec）按对应 grade 反推合理区间随机。**制造 1–2 个"重污染区县"**（工业区 river 点集中劣Ⅴ/劣Ⅵ），作 LLM 提案与叙事落点。

### 4.3 真实 vs 种子的视觉区分

| | 种子(is_seed=1) | 真实(is_seed=0) |
|---|---|---|
| 散点 | 半透明小点，无标签 | 发光大点 + `LIVE` 脉冲标签 |
| 交互 | 可点开详情 | 详情 + 一键 NGO 提案 |
| 动效 | 静态底色 | 现场测水→冒新发光点（`/live`） |

> 叙事：**"底色是我们积累的水质地图，发光的是评委面前刚测出来的真实数据。"**

---

## 5. LLM 现场生成 NGO 提案（DeepSeek）— 核心亮点

叙事闭环：**测水 → 聚合 → AI 生成本区域改善提案 → 反哺本地政府**（对应 SDG6 + NGO 资金循环）。

### 5.1 模型选择 ⚠️ 待你确认

你之前称 "DeepSeek v4 flash"，官方 API 无此名。稳妥可用：

| 场景 | 模型名 | 端点 |
|------|--------|------|
| **提案生成（推荐）** | `deepseek-chat` | OpenAI 兼容 `POST https://api.deepseek.com/chat/completions` |
| 需强推理时 | `deepseek-reasoner` | 同上 |

> **默认用 `deepseek-chat`**。请确认你手上密钥对应的确切模型名，若非上述再替换。

### 5.2 接口契约

`POST /api/v1/insights/generate`

请求：
```json
{ "scope": "region", "region": "武汉市青山区", "ref_report_id": null }
```
- `scope="region"`：为区域生成整体提案（左侧排行/地图区域点击触发）。
- `scope="point"`：为单条真实检测生成微提案（散点弹窗"一键生成"触发，带 `ref_report_id`）。

响应：
```json
{ "region": "武汉市青山区", "model": "deepseek-chat",
  "content": "## 青山区水质改善提案\n...(Markdown)",
  "cached": false, "input_summary": { } }
```

### 5.3 后端流程

```
1. 收到请求 → 查 llm_reports 是否已有近似缓存(region+scope)
   ├─ 命中且未过期 → 直接返回 cached=true（演示零延迟兜底）
   └─ 未命中 ↓
2. 聚合该 region 快照：样本数、达标率、平均等级、各指标均值、
   主要超标指标(与 GB 阈值比)、最差水体类型、污染点数
3. 组装 system+user prompt（§5.4）→ 调 DeepSeek /chat/completions
4. 写入 llm_reports 缓存 → 返回 content
```

**演示保险**：可对 2–3 个重点区域**预生成并入库**，现场即便断网也能"秒出"（cached=true）；有网则实时生成新内容。

### 5.4 提示词设计

**System**：
```
你是公益组织"清源计划"的水质政策分析师。基于给定区域的水质检测统计数据，
面向当地政府/水务部门撰写一份专业、可执行的水质改善提案。
要求：以事实和数据说话；给出问题诊断—成因推测—分级改善建议—预期资金用途；
语气专业克制，符合公文风格；用中文 Markdown；篇幅约 400–600 字。
只依据给定数据，不得编造具体未提供的数字。
```

**User**（后端用聚合快照动态填充）：
```
区域：{region}
样本数：{n}（真实 {real_n} / 历史 {seed_n}）
达标率(Ⅰ~Ⅲ类)：{pass_rate}
平均水质等级：{avg_grade}
指标均值：pH {ph}｜TDS {tds}ppm｜浊度 {turbidity}NTU｜电导率 {ec}μS/cm
主要超标指标：{exceed_list}
最差水体类型：{worst_water_type}
重污染检测点数：{polluted_count}
请据此生成该区域的水质改善提案。
```

`scope="point"` 时改用单条 raw_samples + 稳定性诊断，生成"该点位速评 + 处置建议"。

### 5.5 安全与成本

- **密钥仅存后端环境变量**（`DEEPSEEK_API_KEY`），大屏/客户端不接触，避免泄露。
- 缓存 + 预生成控制 token 消耗；设置合理 `max_tokens` 与超时（如 30s）+ 前端 loading 动效。
- 大屏不直连 DeepSeek，一律经 Express 代理（统一鉴权/限流/缓存）。

---

## 6. React 大屏设计（评委 eye-catching 主战场）

### 6.1 技术选型

| 关注点 | 选型 | 理由 |
|--------|------|------|
| 框架 | **React 18 + Vite + TS** | 独立项目，与现有 Nuxt3 隔离，起步快 |
| 地图 | **deck.gl + react-map-gl(Mapbox)** | ScatterplotLayer/HeatmapLayer/发光点，科技感最强 |
| 图表 | **ECharts (echarts-for-react)** | 环形/趋势/雷达一站式，暗色主题炫 |
| 动效 | **Framer Motion** + CSS | 数字滚动、卡片入场、LIVE 脉冲 |
| 数字滚动 | react-countup | 顶部指标动态跳动 |
| 数据请求 | fetch + 5s 轮询（或 SWR） | §3.4 |
| 主题 | 深色科技风（深蓝黑底 + 青/品红霓虹描边） | 大屏标配 |

> D3 备选：若 Mapbox token 申请受阻，改 **高德 JS API**（国内底图/定位更准，散点+热力同样可做），deck.gl 章节替换即可。

### 6.2 驾驶舱一屏布局

```
┌──────────────────────────────────────────────────────────────┐
│  [顶栏] 清源计划·水质大数据总览   累计检测 1,247 ↑  覆盖 9 区   │
│         平均水质 Ⅲ类   达标率 63.2%   (数字滚动动画)          │
├──────────────┬───────────────────────────────┬───────────────┤
│ 左栏          │        中央地图（主视觉）       │ 右栏           │
│ ┌──────────┐ │  deck.gl 区域热力 + 检测散点    │ ┌───────────┐ │
│ │区域排行榜 │ │  真实点发光+LIVE脉冲            │ │趋势曲线   │ │
│ │(滚动)     │ │  点击点→详情弹窗               │ │(近30天)   │ │
│ ├──────────┤ │  点击区域→生成提案            │ ├───────────┤ │
│ │水体类型   │ │                               │ │指标雷达图 │ │
│ │环形图     │ │                               │ │pH/TDS/浊度│ │
│ └──────────┘ │                               │ └───────────┘ │
├──────────────┴───────────────────────────────┴───────────────┤
│ [底部/弹层] 检测详情 · 「一键生成 NGO 提案」→ LLM 流式/loading │
└──────────────────────────────────────────────────────────────┘
```

### 6.3 交互脚本（演示动线）

1. 大屏静态展示：地图铺满种子底色，指标条滚动，排行/趋势/雷达有数据。
2. **现场用水杯测一杯水** → 客户端提交 → `/live` 增量 → 地图**冒出发光新点**（Framer Motion 入场 + 脉冲）。
3. 点击该发光点 → 详情弹窗（20 条原始读数、稳定性、评级、水体类型）。
4. 点弹窗「一键生成 NGO 提案」→ loading → DeepSeek 返回本区域改善提案（Markdown 渲染）。
5. 收尾：讲资金循环——**"这份提案配着你捐的钱，回到改善你自己喝的水。"**

### 6.4 组件清单

`TopMetricsBar` · `MapCanvas(deck.gl)` · `RegionRanking` · `WaterTypeDonut` · `TrendLine` · `MetricRadar` · `PointDetailModal` · `InsightPanel(LLM)` · `useLivePolling` hook。

---

## 7. 交付与工作量（第 3 部分，3 天视角）

| 优先级 | 模块 | 说明 |
|-------|------|------|
| P0 核心得分 | 大屏 §6 + LLM 提案 §5 | 评委直接看到的 |
| P1 支撑 | 分析 API §3 + 数据表 §2 | 大屏的数据供给 |
| P1 铺底 | 种子脚本 §4 | 让大屏不空、有故事 |
| P2 够用即可 | 反地理编码/region 填充 | 可先手工映射坐标→区县，不必接第三方 |

**刻意不做**（避免过度投入）：预聚合表、复杂权限、多城市切换、实时推送 WebSocket、LLM 微调。

---

## 8. 待你确认清单

1. **DeepSeek 模型名**："v4 flash" 实际对应？默认按 `deepseek-chat`。
2. **数据库**：默认 SQLite，是否可？（要多端并发写再上 Postgres）
3. **演示城市**：默认武汉，换城市只需替换种子坐标中心。
4. **地图底图**：默认 deck.gl+Mapbox（需 Mapbox token），无 token 走高德，选哪个？
5. **分析 API 归属**：复用现有 Express :4000（推荐，最省），还是新建独立分析服务？默认复用。
