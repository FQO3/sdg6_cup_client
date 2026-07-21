# -*- coding: utf-8 -*-
"""
水质等级预测：4便宜参数(水温/pH/电导率/浊度) -> 等级(I~劣VI)
包含：
  1) 信息论诊断：互信息 + Fano 理论错误率下界
  2) 基线模型：熵权法 + TOPSIS -> 按阈值切6级
  3) 主力模型：随机森林 + 有序回归(mord, 可选)
  4) 评价：准确率 / QWK(二次加权Kappa) / MAE_ordinal / 混淆矩阵
依赖：pandas numpy scikit-learn scipy matplotlib  (mord 可选)
运行：python water_quality_pipeline.py
"""
import numpy as np
import pandas as pd
from scipy.optimize import brentq
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (confusion_matrix, accuracy_score,
                             cohen_kappa_score, mean_absolute_error)

# ----------------------------------------------------------------------
# 0. 读数据
# ----------------------------------------------------------------------
CSV = './Data/Merge.csv'
ORDER = ['Ⅰ类', 'Ⅱ类', 'Ⅲ类', 'Ⅳ类', 'Ⅴ类', '劣Ⅵ类']   # 有序！
CHEAP = ['水温(℃)', 'pH(无量纲)', '电导率(μS/cm)', '浊度(NTU)']
K = len(ORDER)

df = pd.read_csv(CSV)
y = df['水质类别'].map({v: i for i, v in enumerate(ORDER)}).values   # 0..5
X = df[CHEAP].values.astype(float)
print(f'样本 {len(df)} 行, 特征 {CHEAP}, 等级数 {K}')


# ----------------------------------------------------------------------
# 1. 信息论诊断：互信息 + Fano 下界
#    回答“4个便宜参数理论上最多能多准”
# ----------------------------------------------------------------------
def fano_analysis(X, y, K):
    from sklearn.feature_selection import mutual_info_classif
    p = np.bincount(y, minlength=K) / len(y)
    HY = -np.sum(p * np.log2(p + 1e-12))                 # 标签熵
    mi = mutual_info_classif(X, y, random_state=0)
    I = mi.sum() / np.log(2)                             # nats->bits (sklearn输出nats)
    HYX = max(HY - I, 0.0)                               # 条件熵
    Hb = lambda pe: -pe*np.log2(pe+1e-12) - (1-pe)*np.log2(1-pe+1e-12)
    f = lambda pe: Hb(pe) + pe*np.log2(K-1) - HYX
    try:
        pe = brentq(f, 1e-6, 1-1e-6)
    except Exception:
        pe = 0.0
    print('\n===== 信息论诊断 (Fano) =====')
    for c, m in zip(CHEAP, mi/np.log(2)):
        print(f'  I({c}; 等级) = {m:.3f} bits')
    print(f'  H(Y)   标签不确定性       = {HY:.3f} bits')
    print(f'  I(X;Y) 4参数提供信息      = {I:.3f} bits ({I/HY*100:.0f}% of H(Y))')
    print(f'  H(Y|X) 剩余不确定性       = {HYX:.3f} bits')
    print(f'  >>> Fano理论错误率下界 Pe >= {pe*100:.1f}%')
    print(f'  >>> 准确率理论天花板   Acc <= {(1-pe)*100:.1f}%') # type: ignore
    print(f'  (瞎猜基线 = 最大类占比 Acc  = {p.max()*100:.1f}%)')
    return pe


# ----------------------------------------------------------------------
# 2. 基线：熵权法 + TOPSIS
# ----------------------------------------------------------------------
def entropy_weight(Xn):
    """熵权法算客观权重。Xn: 已归一到[0,1]的正向化矩阵。"""
    P = Xn / (Xn.sum(axis=0, keepdims=True) + 1e-12)
    m = Xn.shape[0]
    e = -(P * np.log(P + 1e-12)).sum(axis=0) / np.log(m)   # 每列熵
    d = 1 - e                                              # 差异系数
    return d / d.sum()

def topsis_score(Xn, w):
    """TOPSIS 相对贴近度 (越大水越好)。"""
    V = Xn * w
    ideal_best = V.max(axis=0)
    ideal_worst = V.min(axis=0)
    d_best = np.sqrt(((V - ideal_best) ** 2).sum(axis=1))
    d_worst = np.sqrt(((V - ideal_worst) ** 2).sum(axis=1))
    return d_worst / (d_best + d_worst + 1e-12)

def run_topsis_baseline(X, y, K):
    """
    正向化：pH取|pH-7|后取负(越接近7越好)；电导率/浊度越小越好取负；水温做中性(标准化)。
    然后熵权+TOPSIS得连续得分，按训练集分位数切成6级。
    """
    Xp = X.copy()
    # 列: 水温, pH, 电导率, 浊度
    Xp[:, 1] = -np.abs(Xp[:, 1] - 7.0)   # pH -> 越接近7越好
    Xp[:, 2] = -Xp[:, 2]                 # 电导率 越小越好
    Xp[:, 3] = -Xp[:, 3]                 # 浊度   越小越好
    # min-max 归一到[0,1]
    mn, mx = Xp.min(0), Xp.max(0)
    Xn = (Xp - mn) / (mx - mn + 1e-12)
    w = entropy_weight(Xn)
    score = topsis_score(Xn, w)          # 越大水越好
    # 得分越高 -> 等级越好(0=I)。按分位数切6段。
    q = np.quantile(score, np.linspace(0, 1, K + 1))
    q[0], q[-1] = -np.inf, np.inf
    grade_from_good = np.digitize(score, q[1:-1])         # 0..5, 0=最差
    pred = (K - 1) - grade_from_good                      # 翻转: 0=最好=I类
    print('\n===== 基线: 熵权+TOPSIS =====')
    print('  熵权重:', dict(zip(CHEAP, np.round(w, 3))))
    report(y, pred, K, tag='TOPSIS基线')
    return pred


# ----------------------------------------------------------------------
# 3. 主力：随机森林 (+ 可选有序回归 mord)
# ----------------------------------------------------------------------
def run_models(X, y, K):
    Xtr, Xte, ytr, yte = train_test_split(
        X, y, test_size=0.25, random_state=42, stratify=y)
    sc = StandardScaler().fit(Xtr)
    Xtr_s, Xte_s = sc.transform(Xtr), sc.transform(Xte)

    print('\n===== 主力模型: 随机森林 =====')
    rf = RandomForestClassifier(n_estimators=400, max_depth=None,
                                class_weight='balanced', random_state=42, n_jobs=-1)
    rf.fit(Xtr_s, ytr)
    report(yte, rf.predict(Xte_s), K, tag='RandomForest')

    # 可选：有序回归 (pip install mord)
    try:
        from mord import LogisticAT # type: ignore
        print('\n===== 主力模型: 有序回归(LogisticAT) =====')
        ordm = LogisticAT(alpha=1.0)
        ordm.fit(Xtr_s, ytr)
        report(yte, ordm.predict(Xte_s), K, tag='OrdinalLogit')
    except ImportError:
        print('\n[提示] 未装 mord，跳过有序回归。装法: pip install mord')

    return yte, rf.predict(Xte_s)


# ----------------------------------------------------------------------
# 4. 评价：Acc / QWK / MAE_ordinal / 混淆矩阵
# ----------------------------------------------------------------------
def report(y_true, y_pred, K, tag=''):
    acc = accuracy_score(y_true, y_pred)
    qwk = cohen_kappa_score(y_true, y_pred, weights='quadratic')  # 二次加权Kappa
    mae = mean_absolute_error(y_true, y_pred)                     # 平均差几级
    print(f'  [{tag}] 准确率 Acc = {acc*100:.1f}%')
    print(f'  [{tag}] QWK(二次加权Kappa) = {qwk:.3f}  (1完美/0瞎猜)')
    print(f'  [{tag}] MAE_ordinal(平均差几级) = {mae:.3f}')
    cm = confusion_matrix(y_true, y_pred, labels=list(range(K)))
    print(f'  [{tag}] 混淆矩阵(行真值/列预测, 顺序{ORDER}):')
    print(cm)


# ----------------------------------------------------------------------
# main
# ----------------------------------------------------------------------
if __name__ == '__main__':
    pe = fano_analysis(X, y, K)
    run_topsis_baseline(X, y, K)
    yte, ypred = run_models(X, y, K)
    print('\n================ 结论解读 ================')
    print(f'把主力模型 Acc 与 Fano天花板 {(1-pe)*100:.1f}% 对比：') # type: ignore
    print('  - 若已接近天花板 -> 瓶颈是"只有4个便宜参数"，非建模问题(呼应SHAP)。')
    print('  - 若差距大       -> 还有建模空间(调参/加交互特征/换有序模型)。')
