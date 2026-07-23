# 水质等级预测模型

基于随机森林的 GB 3838-2002 水质等级（Ⅰ~劣Ⅵ）预测模型。仅使用 4 个低成本传感器可测参数——**水温、pH、电导率、浊度**——预测水体等级。

> ⚠️ 4 参数准确率 74.1%，已逼近信息论天花板 78.8%。瓶颈是传感器信息量而非模型能力。

---

## 目录结构

```
Water Quality Pipeline/
├── README.md                           # 本文件
├── train.save.py                       # 训练脚本（只需运行一次）
├── api.py                              # FastAPI 预测接口
├── evaluate.py                         # 评估 / 批量预测脚本
├── model.main.py                       # 完整实验流水线（信息论诊断 + TOPSIS + RF + 有序回归）
├── model.compare.py                    # 三组特征子集对比 benchmark
├── experiment_comparison.csv           # benchmark 对比结果表
├── Data Report/
│   ├── Analysis For Four Factors.txt   # 4 参数分析报告
│   └── Benchmark For Combination Of Factors.txt  # 因子组合 benchmark 报告
│   └── Model Predict Report.txt        # 模型训练结果报告
└── models/
    ├── water_rf_4feat.joblib           # 训练好的随机森林模型（train.save.py 产出）
    ├── water_metadata.joblib           # 模型元数据（train.save.py 产出）
    ├── evaluate.description.txt        # 评估说明
    └── test/
        ├── test.csv                    # 示例测试数据
        └── test_predicted.csv          # 预测结果输出示例
```

---

## 第一步：训练模型

只需运行一次，产出 `models/water_rf_4feat.joblib` 和 `models/water_metadata.joblib`。

```bash
python train.save.py
```

训练数据使用 `Merge.csv`（4308 行，含水质类别标签）。训练完成后控制台输出：

- 各特征互信息（bits）
- 测试集准确率、±1 级容错率、QWK、MAE
- 混淆矩阵

---

## 第二步：启动 API 服务

```bash
python -m uvicorn api:app --app-dir ./Water\ Quality\ Pipeline --host 0.0.0.0 --port 8080
```

浏览器打开 `http://localhost:8080/docs` 可查看 Swagger 交互文档，直接在网页里测试。

### 接口一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/info` | 模型元信息（特征、互信息、测试指标） |
| POST | `/predict` | 输入 4 参数，返回预测等级 + 各类概率 |

### 健康检查

```bash
curl http://localhost:8080/health
```

返回：

```json
{"status":"ok","model":"4feat"}
```

### 模型元信息

```bash
curl http://localhost:8080/info
```

返回：

```json
{
  "等级顺序": ["Ⅰ类","Ⅱ类","Ⅲ类","Ⅳ类","Ⅴ类","劣Ⅵ类"],
  "特征清单": ["水温(℃)","pH(无量纲)","电导率(μS/cm)","浊度(NTU)"],
  "互信息(bits)": {"水温(℃)":0.129,"pH(无量纲)":0.275,"电导率(μS/cm)":0.475,"浊度(NTU)":0.171},
  "测试指标": {"Acc":0.741,"Tol±1":0.973,"QWK":0.869,"MAE":0.316}
}
```

### 预测

```bash
curl -X POST http://localhost:8080/predict \
  -H "Content-Type: application/json" \
  -d '{
    "水温(℃)": 22.5,
    "pH(无量纲)": 7.2,
    "电导率(μS/cm)": 350,
    "浊度(NTU)": 15
  }'
```

返回：

```json
{
  "等级": "Ⅲ类",
  "等级序号": 2,
  "置信度": 0.8721,
  "各类概率": {
    "Ⅰ类": 0.0,
    "Ⅱ类": 0.0473,
    "Ⅲ类": 0.8721,
    "Ⅳ类": 0.0684,
    "Ⅴ类": 0.0122,
    "劣Ⅵ类": 0.0
  }
}
```

---

## 第三步：评估 / 批量预测

```bash
# 对含标签的 CSV 做评估
python evaluate.py --csv models/test/test.csv

# 对无标签的 CSV 仅做预测
python evaluate.py --csv data.csv --no-label

# 指定标签列名（默认 "水质类别"）
python evaluate.py --csv data.csv --label-col "真实等级"

# 交互式逐条输入
python evaluate.py --interactive
```

**有标签时**输出：准确率、±1 级容错率、QWK、MAE、混淆矩阵。

**无标签时**输出每条数据的预测等级和置信度。

预测结果自动保存为 `<输入文件名>_predicted.csv`。

---

## 实验流水线（model.main.py / model.compare.py）

`model.main.py` 是完整的研究流水线，包含：

1. **信息论诊断**：互信息 + Fano 下界，计算理论错误率天花板
2. **熵权 + TOPSIS 基线**：无监督排序后按分位数切 6 级
3. **随机森林**：主力模型，400 estimators，balanced class weight
4. **有序回归（LogisticAT）**：对照模型（可选，需 `pip install mord`）
5. **评价**：Acc / ±1 级容错 / QWK / MAE / 混淆矩阵

`model.compare.py` 在三组特征子集上跑 benchmark 对比：

| 实验组 | 特征 |
|--------|------|
| 四因子（现方案） | 水温、pH、电导率、浊度 |
| 去温三因子 | pH、电导率、浊度 |
| 全因子（9 参数） | 全部 9 个参数 |

结果输出到 `experiment_comparison.csv`。

---

## 输入参数

| 参数 | 单位 | 说明 |
|------|------|------|
| 水温(℃) | ℃ | 水体温度 |
| pH(无量纲) | — | 酸碱度，7 为中性 |
| 电导率(μS/cm) | μS/cm | 溶解性离子总量 |
| 浊度(NTU) | NTU | 水体浑浊程度 |

## 等级对应

| 序号 | 等级 | 含义 |
|------|------|------|
| 0 | Ⅰ类 | 源头水、国家自然保护区 |
| 1 | Ⅱ类 | 集中式饮用水源地一级保护区 |
| 2 | Ⅲ类 | 集中式饮用水源地二级保护区 |
| 3 | Ⅳ类 | 一般工业用水区 |
| 4 | Ⅴ类 | 农业用水区 |
| 5 | 劣Ⅵ类 | 污染水体 |

---

## 模型性能（4 参数）

| 指标 | 值 | 说明 |
|------|-----|------|
| 准确率 Acc | 74.1% | 逼近 Fano 天花板 78.8% |
| ±1 级容错率 | 97.3% | 预测错误均在相邻一级 |
| QWK | 0.869 | 二次加权 Kappa（1=完美, 0=瞎猜） |
| MAE | 0.316 | 平均偏差不到半级 |
| Fano 天花板 | ≤ 78.8% | 信息论理论上限 |

---

## 技术栈

- **模型**：Random Forest（scikit-learn, n=400, balanced）
- **接口**：FastAPI + Pydantic
- **评价**：二次加权 Cohen's Kappa + 混淆矩阵 + MAE
- **理论**：互信息 + Fano 不等式（信息论错误率下界）

## 主页面
[跳转链接](/README.md)