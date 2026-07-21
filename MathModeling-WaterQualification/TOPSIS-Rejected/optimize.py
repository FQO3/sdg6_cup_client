#!/usr/bin/env python
# -*- coding: utf-8 -*-

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.stats import spearmanr
import matplotlib as mpl
import matplotlib.pyplot as plt
import warnings
warnings.filterwarnings('ignore')

# ---------- 中文字体设置 ----------
mpl.rcParams['font.sans-serif'] = ['PingFang SC', 'SimHei', 'Arial Unicode MS']
mpl.rcParams['axes.unicode_minus'] = False

# =========================================
# 1. 配置区域（请根据实际情况修改）
# =========================================
FILE_PATH = './Data/Merge.csv'          # 你的 CSV 文件路径
FEATURE_COLS = ['水温(℃)', 'pH(无量纲)', '电导率(μS/cm)', '浊度(NTU)']  # 输入特征
GRADE_COL = '水质类别'                    # 等级列名

# 指标方向设定（根据专业知识调整）
# 'pos'  -> 越大越好
# 'neg'  -> 越小越好
# 'interval' -> 有最佳区间（需指定上下界）
INDICATOR_TYPES = {
    '水温(℃)': 'interval',    # 最佳范围 20~25℃
    'pH(无量纲)': 'interval', # 最佳范围 6.5~8.5
    '电导率(μS/cm)': 'neg',   # 越低越好
    '浊度(NTU)': 'neg'        # 越低越好
}
INTERVAL_BOUNDS = {
    '水温(℃)': [20, 25],
    'pH(无量纲)': [6.5, 8.5]
}

# 是否划分训练/测试集（样本量 > 30 时可设为 True）
USE_TRAIN_TEST_SPLIT = False
TEST_SIZE = 0.3
RANDOM_SEED = 42

# =========================================
# 2. 数据读取
# =========================================
df = pd.read_csv(FILE_PATH, encoding='utf-8')  # 若编码问题可改为 'gbk'
print(f"成功读取数据，共 {len(df)} 条记录。")
print("数据列名：", df.columns.tolist())

for col in FEATURE_COLS + [GRADE_COL]:
    if col not in df.columns:
        raise KeyError(f"列 '{col}' 不存在，请检查 CSV 列名。")

X_raw = df[FEATURE_COLS].values
grades_raw = df[GRADE_COL].values

# =========================================
# 3. 等级映射（自动识别所有等级，按优→差顺序分配 1.0 → 0.0）
# =========================================
unique_grades = np.unique(grades_raw) # type: ignore
print("数据中的等级类别：", unique_grades.tolist())

# 定义标准等级顺序（从优到差），可根据实际情况扩充
standard_order = ['Ⅰ类', 'Ⅱ类', 'Ⅲ类', 'Ⅳ类', 'Ⅴ类', '劣Ⅵ类', '劣VI类']

existing_grades = []
for g in standard_order:
    if g in unique_grades:
        existing_grades.append(g)
for g in unique_grades:
    if g not in existing_grades:
        existing_grades.append(g)
        print(f"注意：'{g}' 未在标准顺序中，已自动排在最后（最差等级）。")

n_levels = len(existing_grades)
if n_levels == 1:
    grade_mapping = {existing_grades[0]: 0.5}
else:
    grade_mapping = {grade: 1.0 - i * (1.0 / (n_levels - 1)) for i, grade in enumerate(existing_grades)}

print("等级映射表：", grade_mapping)
y = np.array([grade_mapping[g] for g in grades_raw], dtype=float)

# =========================================
# 4. 标准化函数（支持正向、负向、区间型）
# =========================================
def normalize_matrix(X, types, interval_bounds):
    X_norm = np.zeros_like(X, dtype=float)
    for j, col_name in enumerate(types.keys()):
        col = X[:, j]
        t = types[col_name]
        if t == 'pos':
            min_val, max_val = col.min(), col.max()
            if max_val - min_val < 1e-12:
                X_norm[:, j] = 0.5
            else:
                X_norm[:, j] = (col - min_val) / (max_val - min_val)
        elif t == 'neg':
            min_val, max_val = col.min(), col.max()
            if max_val - min_val < 1e-12:
                X_norm[:, j] = 0.5
            else:
                X_norm[:, j] = (max_val - col) / (max_val - min_val)
        elif t == 'interval':
            a, b = interval_bounds[col_name]
            M = max(a - col.min(), col.max() - b)
            if M < 1e-12:
                X_norm[:, j] = 1.0
            else:
                for i, val in enumerate(col):
                    if a <= val <= b:
                        X_norm[i, j] = 1.0
                    elif val < a:
                        X_norm[i, j] = 1 - (a - val) / M
                    else:
                        X_norm[i, j] = 1 - (val - b) / M
        else:
            raise ValueError(f"未知的指标类型: {t}")
    return X_norm

# =========================================
# 5. TOPSIS 评价函数
# =========================================
def topsis_score(X_norm, weights):
    w = weights / np.sum(weights)
    X_weighted = X_norm * w
    ideal_pos = X_weighted.max(axis=0)
    ideal_neg = X_weighted.min(axis=0)
    dist_pos = np.sqrt(((X_weighted - ideal_pos) ** 2).sum(axis=1))
    dist_neg = np.sqrt(((X_weighted - ideal_neg) ** 2).sum(axis=1))
    C = dist_neg / (dist_pos + dist_neg + 1e-12)
    return C

# =========================================
# 6. 损失函数（均方误差）
# =========================================
def loss_function(weights, X_norm, y_true):
    y_pred = topsis_score(X_norm, weights)
    return np.mean((y_pred - y_true) ** 2)

# =========================================
# 7. 数据标准化与划分
# =========================================
X_norm_full = normalize_matrix(X_raw, INDICATOR_TYPES, INTERVAL_BOUNDS)

if USE_TRAIN_TEST_SPLIT and len(df) >= 30:
    from sklearn.model_selection import train_test_split
    X_train, X_test, y_train, y_test = train_test_split(
        X_norm_full, y, test_size=TEST_SIZE, random_state=RANDOM_SEED
    )
    print(f"划分训练集 {len(X_train)} 条，测试集 {len(X_test)} 条。")
    X_opt, y_opt = X_train, y_train
else:
    X_opt, y_opt = X_norm_full, y
    X_train = X_test = X_opt
    y_train = y_test = y_opt
    print("使用全部数据进行优化（未划分训练/测试集）。")

# =========================================
# 8. 权重优化
# =========================================
n_features = X_raw.shape[1] # type: ignore
initial_weights = np.ones(n_features) / n_features
constraint = {'type': 'eq', 'fun': lambda w: np.sum(w) - 1}
bounds = [(0, 1) for _ in range(n_features)]

print("开始优化权重...")
result = minimize(
    loss_function,
    initial_weights,
    args=(X_opt, y_opt),
    method='trust-constr',
    bounds=bounds,
    constraints=constraint,
    options={'maxiter': 10000, 'disp': True, 'xtol': 1e-12, 'gtol': 1e-8}
)

if not result.success:
    print("优化未成功收敛，请检查数据或尝试其他优化方法。")
    print("返回信息：", result.message)

optimized_weights = result.x / np.sum(result.x)
print("\n优化后的权重：")
for i, col in enumerate(FEATURE_COLS):
    print(f"  {col}: {optimized_weights[i]:.4f}")

# =========================================
# 9. 模型评估
# =========================================
y_pred_opt = topsis_score(X_opt, optimized_weights)
mse_opt = np.mean((y_pred_opt - y_opt) ** 2)
corr_opt = np.corrcoef(y_opt, y_pred_opt)[0, 1]

print(f"\n优化数据集上的 MSE: {mse_opt:.6f}")
print(f"优化数据集上的相关系数: {corr_opt:.4f}")

if USE_TRAIN_TEST_SPLIT and len(df) >= 30:
    y_pred_test = topsis_score(X_test, optimized_weights)
    mse_test = np.mean((y_pred_test - y_test) ** 2)
    corr_test = np.corrcoef(y_test, y_pred_test)[0, 1]
    print(f"测试集上的 MSE: {mse_test:.6f}")
    print(f"测试集上的相关系数: {corr_test:.4f}")

# =========================================
# 10. 可视化对比
# =========================================
plt.figure(figsize=(10, 6))
idx_sorted = np.argsort(y_opt)
plt.plot(y_opt[idx_sorted], 'o-', label='真实等级映射值', markersize=8)
plt.plot(y_pred_opt[idx_sorted], 's-', label='TOPSIS 预测贴近度', markersize=8)
plt.xlabel('样本索引（按真实值升序排列）')
plt.ylabel('得分')
plt.title('TOPSIS 预测与真实等级对比')
plt.legend()
plt.grid(True)
plt.tight_layout()
plt.savefig('topsis_fit.png', dpi=300)
plt.show()

# =========================================
# 11. 结果排序与排名对比（核心新增）
# =========================================
# 计算所有样本的TOPSIS贴近度（使用优化权重）
y_pred_full = topsis_score(X_norm_full, optimized_weights)

results_df = pd.DataFrame({
    '原始等级': grades_raw,
    '等级映射值': y,
    'TOPSIS贴近度': y_pred_full
})

# 真实排名（等级映射值越高排名越靠前）
results_df['真实排名'] = results_df['等级映射值'].rank(method='min', ascending=False).astype(int)
# 预测排名（贴近度越高排名越靠前）
results_df['预测排名'] = results_df['TOPSIS贴近度'].rank(method='min', ascending=False).astype(int)
# 排名差异（正值表示模型排得偏后）
results_df['排名差异'] = results_df['预测排名'] - results_df['真实排名']

# 按预测排名从优到差排序
results_sorted = results_df.sort_values(by='预测排名', ascending=True).reset_index(drop=True)

# print("\n" + "="*60)
# print("按 TOPSIS 预测水质从优到差排序结果（排名越靠前水质越好）：")
# print("="*60)
# pd.set_option('display.max_rows', None)
# pd.set_option('display.width', 120)
# print(results_sorted.to_string(index=False))

# 保存排序结果到 CSV
results_sorted.to_csv('topsis_ranking_results.csv', index=False, encoding='utf-8-sig')
print("\n排序结果已保存到 topsis_ranking_results.csv")

# 计算 Spearman 相关系数（评估排序一致性）
spearman_corr, p_value = spearmanr(results_df['真实排名'], results_df['预测排名'])
print(f"\n预测排名与真实排名的 Spearman 相关系数: {spearman_corr:.4f} (p值: {p_value:.4f})")
if spearman_corr > 0.8: # type: ignore
    print("> 排序一致性很高（极强相关），TOPSIS模型能较好复现真实等级顺序。")
elif spearman_corr > 0.6: # type: ignore
    print("> 排序一致性中等（强相关），模型有一定参考价值。")
else:
    print("> 排序一致性较低，建议检查指标方向设定或增加样本量。")

# 显示前5和后5
print("\n" + "="*60)
print("水质最优 TOP 5（预测排名前5）：")
print("="*60)
print(results_sorted.head(5).to_string(index=False))

print("\n" + "="*60)
print("水质最差 BOTTOM 5（预测排名后5）：")
print("="*60)
print(results_sorted.tail(5).to_string(index=False))

# 显示前10个样本的详细信息（快速核对）
print("\n前10条样本的预测结果：")
n_show = min(10, len(results_df))
for i in range(n_show):
    row = results_df.iloc[i]
    print(f"样本 {i+1}: 等级={row['原始等级']}, 映射值={row['等级映射值']:.3f}, 贴近度={row['TOPSIS贴近度']:.3f}, 真实排名={row['真实排名']}, 预测排名={row['预测排名']}")

print("\n所有处理完成。")