import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib as mpl
from sklearn.preprocessing import LabelEncoder
import warnings
warnings.filterwarnings('ignore')

# ---------- 中文字体设置 ----------
mpl.rcParams['font.sans-serif'] = ['PingFang SC', 'SimHei', 'Arial Unicode MS']
mpl.rcParams['axes.unicode_minus'] = False

# ---------- 数据加载 ----------
df = pd.read_csv('./Data/Merge.csv')

# 只提取你拥有的4个传感器指标
feature_cols = ['水温(℃)', 'pH(无量纲)', '电导率(μS/cm)', '浊度(NTU)']
X_raw = df[feature_cols].values

# ==========================================
# 第一步：数据正向化处理
# 因为 TOPSIS 要求指标具有单调性（越大越好 或 越小越好）
# 对于 pH 和水温，我们将其转换为“偏离最佳值的程度”（越小越好）
# ==========================================
def preprocess_for_topsis(data):
    """
    输入: data 包含 [水温, pH, 电导率, 浊度]
    输出: 正向化后的矩阵 (全部为极小型指标，即数值越小代表物理状态越好)
    """
    processed = np.zeros_like(data, dtype=float)
    
    # 1. 水温(℃): 最佳范围为 20~30℃，越偏离越差 -> 计算到区间边界的距离
    temp = data[:, 0]
    temp_dev = np.where(temp < 20, 20 - temp, 0)  # 低于20的偏差
    temp_dev += np.where(temp > 30, temp - 30, 0) # 高于30的偏差
    processed[:, 0] = temp_dev  # 偏差越小越好（极小型）
    
    # 2. pH(无量纲): 最佳值为 7.0（中性），偏离越远越差
    ph = data[:, 1]
    ph_dev = np.abs(ph - 7.0)
    processed[:, 1] = ph_dev  # 偏差越小越好（极小型）
    
    # 3. 电导率(μS/cm): 纯水极低，数值越低越好（极小型）
    processed[:, 2] = data[:, 2]  # 直接保留原值（极小型）
    
    # 4. 浊度(NTU): 数值越低水质越清澈（极小型）
    processed[:, 3] = data[:, 3]  # 直接保留原值（极小型）
    
    return processed

# 应用正向化
X_processed = preprocess_for_topsis(X_raw)

# ==========================================
# 第二步：TOPSIS 核心计算
# ==========================================
def topsis(matrix, weights=None):
    """
    标准 TOPSIS 计算 (极小型指标矩阵)
    matrix: 已正向化的矩阵 (样本数, 4)
    weights: 各指标权重 (默认等权重)
    """
    if weights is None:
        weights = np.ones(matrix.shape[1]) / matrix.shape[1]
    
    # 1. 向量归一化 (消除量纲)
    norm_matrix = matrix / np.sqrt(np.sum(matrix**2, axis=0))
    
    # 2. 构造加权规范矩阵
    weighted_matrix = norm_matrix * weights
    
    # 3. 确定理想最优解(Z+) 和 最劣解(Z-)
    # 因为全部是极小型指标，Z+ 取每列最小值，Z- 取每列最大值
    Z_plus = np.min(weighted_matrix, axis=0)
    Z_minus = np.max(weighted_matrix, axis=0)
    
    # 4. 计算每个样本到正负理想解的距离 (欧氏距离)
    D_plus = np.sqrt(np.sum((weighted_matrix - Z_plus) ** 2, axis=1))
    D_minus = np.sqrt(np.sum((weighted_matrix - Z_minus) ** 2, axis=1))
    
    # 5. 计算相对接近度 (C值, 范围0~1, 越大越好)
    C_score = D_minus / (D_plus + D_minus)
    return C_score

# 计算 TOPSIS 得分
# 注：根据传感器可靠性，您可以调整权重。例如浊度和电导率权重大一点（0.3,0.3），pH和温度小一点（0.2,0.2）
# 这里使用等权重 [0.25, 0.25, 0.25, 0.25]
topsis_scores = topsis(X_processed, weights=[0.1, 0.2, 0.4, 0.3])  # 我给浊度和电导率稍高权重

# 将得分加入原 DataFrame
df['TOPSIS_物理综合得分'] = topsis_scores

# ==========================================
# 第三步：结果分析与可视化
# ==========================================

# 1. 查看排名前5 和 后5 的样本
print("=" * 60)
print("TOPSIS 水质物理状态排名 (得分越高，代表仅从4个传感器看水质越好)")
print("=" * 60)
df_sorted = df.sort_values('TOPSIS_物理综合得分', ascending=False)
print("\n【最优的前5个样本】")
print(df_sorted[feature_cols + ['TOPSIS_物理综合得分']].head(5))
print("\n【最差的后5个样本】")
print(df_sorted[feature_cols + ['TOPSIS_物理综合得分']].tail(5))

# 2. 绘制得分直方图
plt.figure(figsize=(10, 4))
plt.hist(topsis_scores, bins=30, color='steelblue', edgecolor='black', alpha=0.7)
plt.xlabel('TOPSIS 综合得分 (0~1)', fontsize=12)
plt.ylabel('样本频数', fontsize=12)
plt.title('仅基于温度、pH、电导率、浊度的水体物理状态分布', fontsize=14)
plt.grid(axis='y', linestyle='--', alpha=0.4)
plt.show()

# 3. 如果想看4个特征原始值与得分的关系（散点矩阵或平行坐标）
# 这里简单画一个：得分 vs 浊度（浊度越低，通常得分越高）
plt.figure(figsize=(10, 4))
plt.scatter(df['浊度(NTU)'], topsis_scores, c='red', alpha=0.5, s=20)
plt.xlabel('浊度 (NTU)', fontsize=12)
plt.ylabel('TOPSIS 物理综合得分', fontsize=12)
plt.title('浊度与 TOPSIS 得分的关系', fontsize=14)
plt.grid(alpha=0.3)
plt.show()