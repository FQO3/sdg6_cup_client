# -*- coding: utf-8 -*-
"""
水质等级预测：便宜参数(水温/pH/电导率/浊度) -> 等级(I~劣VI)
包含：
  1) 信息论诊断：互信息 + Fano 理论错误率下界
  2) 基线模型：熵权法 + TOPSIS -> 按阈值切6级
  3) 主力模型：随机森林 + 有序回归(mord, 可选)
  4) 评价：Acc / ±1级容错 / QWK(二次加权Kappa) / MAE_ordinal / 混淆矩阵
  5) 对比实验：四因子(现方案) / 去温三因子 / 全因子(9参数)
依赖：pandas numpy scikit-learn scipy matplotlib  (mord 可选)
运行：python water_quality_pipeline.py
"""
import numpy as np
import pandas as pd
from scipy.optimize import brentq
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.feature_selection import mutual_info_classif
from sklearn.metrics import (confusion_matrix, accuracy_score,
                             cohen_kappa_score, mean_absolute_error)

# ----------------------------------------------------------------------
# 0. 读数据
# ----------------------------------------------------------------------
CSV = './Data/Merge.csv'
ORDER = ['Ⅰ类', 'Ⅱ类', 'Ⅲ类', 'Ⅳ类', 'Ⅴ类', '劣Ⅵ类']   # 有序！
CHEAP = ['水温(℃)', 'pH(无量纲)', '电导率(μS/cm)', '浊度(NTU)']   # 4个便宜参数
ALL9 = ['水温(℃)', 'pH(无量纲)', '溶解氧(mg/L)', '电导率(μS/cm)', '浊度(NTU)',
        '高锰酸盐指数(mg/L)', '氨氮(mg/L)', '总磷(mg/L)', '总氮(mg/L)']   # 全部参数
K = len(ORDER)

df = pd.read_csv(CSV)
y = df['水质类别'].map({v: i for i, v in enumerate(ORDER)}).values   # 0..5
print(f'样本 {len(df)} 行, 便宜特征 {CHEAP}, 等级数 {K}')


# ----------------------------------------------------------------------
# 1. 信息论诊断：互信息 + Fano 下界
#    回答“这组参数理论上最多能多准”
# ----------------------------------------------------------------------
def fano_analysis(Xsub, y, K, feats, verbose=True):
    p = np.bincount(y, minlength=K) / len(y)
    HY = -np.sum(p * np.log2(p + 1e-12))                 # 标签熵
    mi = mutual_info_classif(Xsub, y, random_state=0) / np.log(2)   # nats->bits
    I = mi.sum()                                         # 总互信息(bits)
    HYX = max(HY - I, 0.0)                               # 条件熵
    Hb = lambda pe: -pe*np.log2(pe+1e-12) - (1-pe)*np.log2(1-pe+1e-12)
    f = lambda pe: Hb(pe) + pe*np.log2(K-1) - HYX
    try:
        pe = brentq(f, 1e-6, 1-1e-6)
    except Exception:
        pe = 0.0
    if verbose:
        print('\n----- 信息论诊断 (Fano) -----')
        for c, m in zip(feats, mi):
            print(f'  I({c}; 等级) = {m:.3f} bits')
        print(f'  H(Y)   标签不确定性       = {HY:.3f} bits')
        print(f'  I(X;Y) 参数提供信息       = {I:.3f} bits ({I/HY*100:.0f}% of H(Y))')
        print(f'  H(Y|X) 剩余不确定性       = {HYX:.3f} bits')
        print(f'  >>> Fano理论错误率下界 Pe >= {pe*100:.1f}%')
        print(f'  >>> 准确率理论天花板   Acc <= {(1-pe)*100:.1f}%') # type: ignore
        print(f'  (瞎猜基线 = 最大类占比 Acc  = {p.max()*100:.1f}%)')
    return pe, dict(zip(feats, np.round(mi, 3)))


# ----------------------------------------------------------------------
# 2. 基线：熵权法 + TOPSIS  (仅对4便宜参数演示)
# ----------------------------------------------------------------------
def entropy_weight(Xn):
    P = Xn / (Xn.sum(axis=0, keepdims=True) + 1e-12)
    m = Xn.shape[0]
    e = -(P * np.log(P + 1e-12)).sum(axis=0) / np.log(m)   # 每列熵
    d = 1 - e                                              # 差异系数
    return d / d.sum()

def topsis_score(Xn, w):
    V = Xn * w
    ideal_best = V.max(axis=0)
    ideal_worst = V.min(axis=0)
    d_best = np.sqrt(((V - ideal_best) ** 2).sum(axis=1))
    d_worst = np.sqrt(((V - ideal_worst) ** 2).sum(axis=1))
    return d_worst / (d_best + d_worst + 1e-12)

# 各参数“越好”方向：'up'=越大越好, 'down'=越小越好, 'ph'=越接近7越好
# 未在表中的列默认按 'down'(污染物通常越小越好) 处理
DIRECTION = {
    '水温(℃)': 'down',          # 温度对水质是弱代理，偏离常温多与污染相关，按越小越好近似
    'pH(无量纲)': 'ph',         # 越接近中性7越好
    '溶解氧(mg/L)': 'up',       # 溶解氧越高水越好
    '电导率(μS/cm)': 'down',
    '浊度(NTU)': 'down',
    '高锰酸盐指数(mg/L)': 'down',
    '氨氮(mg/L)': 'down',
    '总磷(mg/L)': 'down',
    '总氮(mg/L)': 'down',
}

def _positivize(X, feats):
    """把各列统一成“数值越大 = 水质越好”。"""
    Xp = X.astype(float).copy()
    for j, c in enumerate(feats):
        d = DIRECTION.get(c, 'down')
        if d == 'up':
            pass                                  # 越大越好，不变
        elif d == 'ph':
            Xp[:, j] = -np.abs(Xp[:, j] - 7.0)    # 越接近7越好
        else:  # 'down'
            Xp[:, j] = -Xp[:, j]                  # 越小越好
    return Xp

def run_topsis_baseline(X, y, K, feats, tag='TOPSIS基线'):
    Xp = _positivize(X, feats)
    mn, mx = Xp.min(0), Xp.max(0)
    Xn = (Xp - mn) / (mx - mn + 1e-12)
    w = entropy_weight(Xn)
    score = topsis_score(Xn, w)                   # 越大水越好
    q = np.quantile(score, np.linspace(0, 1, K + 1))
    q[0], q[-1] = -np.inf, np.inf
    grade_from_good = np.digitize(score, q[1:-1])         # 0..5, 0=最差
    pred = (K - 1) - grade_from_good                      # 翻转: 0=最好=I类
    print(f'\n===== 基线: 熵权+TOPSIS [{tag}] =====')
    print('  熵权重:', dict(zip(feats, np.round(w, 3))))
    return report(y, pred, K, tag=tag)


# ----------------------------------------------------------------------
# 3. 主力：随机森林 (+ 可选有序回归 mord)
# ----------------------------------------------------------------------
def run_models(Xsub, y, K, with_ordinal=True):
    Xtr, Xte, ytr, yte = train_test_split(
        Xsub, y, test_size=0.25, random_state=42, stratify=y)
    sc = StandardScaler().fit(Xtr)
    Xtr_s, Xte_s = sc.transform(Xtr), sc.transform(Xte)

    print('\n----- 主力模型: 随机森林 -----')
    rf = RandomForestClassifier(n_estimators=400, max_depth=None,
                                class_weight='balanced', random_state=42, n_jobs=-1)
    rf.fit(Xtr_s, ytr)
    rf_metrics = report(yte, rf.predict(Xte_s), K, tag='RandomForest')

    ord_metrics = None
    if with_ordinal:
        try:
            from mord import LogisticAT
            print('\n----- 对照: 有序回归(LogisticAT) -----')
            ordm = LogisticAT(alpha=1.0)
            ordm.fit(Xtr_s, ytr)
            ord_metrics = report(yte, ordm.predict(Xte_s), K, tag='LogisticAT')
        except ImportError:
            print('\n[提示] 未装 mord，跳过有序回归。装法: pip install mord')

    return rf_metrics, ord_metrics


# ----------------------------------------------------------------------
# 4. 评价：Acc / ±1级容错 / QWK / MAE_ordinal / 混淆矩阵
# ----------------------------------------------------------------------
def report(y_true, y_pred, K, tag=''):
    acc = accuracy_score(y_true, y_pred)
    qwk = cohen_kappa_score(y_true, y_pred, weights='quadratic')  # 二次加权Kappa
    mae = mean_absolute_error(y_true, y_pred)                     # 平均差几级
    tol1 = np.mean(np.abs(np.asarray(y_true) - np.asarray(y_pred)) <= 1)  # ±1级容错
    cm = confusion_matrix(y_true, y_pred, labels=list(range(K)))
    print(f'  [{tag}] 准确率 Acc = {acc*100:.1f}%')
    print(f'  [{tag}] ±1级容错准确率 = {tol1*100:.1f}%')
    print(f'  [{tag}] QWK(二次加权Kappa) = {qwk:.3f}  (1完美/0瞎猜)')
    print(f'  [{tag}] MAE_ordinal(平均差几级) = {mae:.3f}')
    print(f'  [{tag}] 混淆矩阵(行真值/列预测, 顺序{ORDER}):')
    print(cm)
    return {'Acc': acc, 'Tol±1': tol1, 'QWK': qwk, 'MAE': mae}


# ----------------------------------------------------------------------
# 5. 对比实验：不同特征子集
# ----------------------------------------------------------------------
def run_experiment(df, y, feats, K, name):
    print('\n' + '=' * 62)
    print(f'######## 实验: {name}   特征({len(feats)}个)={feats}')
    print('=' * 62)
    Xsub = df[feats].values.astype(float)
    pe, mi = fano_analysis(Xsub, y, K, feats)                 # 信息论天花板
    tp = run_topsis_baseline(Xsub, y, K, feats, tag=name)     # 熵权+TOPSIS 基线
    rf, om = run_models(Xsub, y, K, with_ordinal=True)        # 随机森林 + 有序回归
    base = {'实验': name, 'n_feat': len(feats), 'Fano天花板': 1 - pe} # type: ignore
    out = [
        {**base, '方法': 'TOPSIS+熵权',  **tp},
        {**base, '方法': 'RandomForest', **rf},
    ]
    if om is not None:
        out.append({**base, '方法': 'LogisticAT', **om})
    return out


# ----------------------------------------------------------------------
# main
# ----------------------------------------------------------------------
if __name__ == '__main__':
    X4 = df[CHEAP].values.astype(float)

    # --- 现方案完整跑一遍(含TOPSIS基线 + 有序回归对照) ---
    print('\n' + '#' * 62)
    print('##  A. 现方案完整流程 (4便宜参数)')
    print('#' * 62)
    pe4, _ = fano_analysis(X4, y, K, CHEAP)
    run_topsis_baseline(X4, y, K, CHEAP, tag='四因子(现方案)')
    run_models(X4, y, K, with_ordinal=True)

    # --- B. 三组对比实验 ---
    print('\n' + '#' * 62)
    print('##  B. 对比实验：特征子集')
    print('#' * 62)
    experiments = [
        ('四因子(现方案)', CHEAP),
        ('去温三因子',     ['pH(无量纲)', '电导率(μS/cm)', '浊度(NTU)']),
        ('全因子(9参数)',  ALL9),
    ]
    rows = []
    for name, feats in experiments:
        rows.extend(run_experiment(df, y, feats, K, name))

    # --- 汇总对比表 ---
    print('\n' + '=' * 62)
    print('################  对比实验汇总  ################')
    print('=' * 62)
    tab = pd.DataFrame(rows)[['实验', 'n_feat', '方法', 'Fano天花板', 'Acc', 'Tol±1', 'QWK', 'MAE']]
    disp = tab.copy()
    for c in ['Fano天花板', 'Acc', 'Tol±1']:
        disp[c] = (disp[c] * 100).round(1).astype(str) + '%'
    disp['QWK'] = disp['QWK'].round(3)
    disp['MAE'] = disp['MAE'].round(3)
    print(disp.to_string(index=False))
    out = './Water Quality Pipeline/experiment_comparison.csv'
    disp.to_csv(out, index=False, encoding='utf-8-sig')
    print(f'\n已保存对比表 -> {out}')

    print('\n================ 结论解读 ================')
    print(f'现方案(4参数)天花板 Acc<={(1-pe4)*100:.1f}%。三行对比读法：') # type: ignore
    print('  - 去温三因子 若几乎不掉点 -> 温度传感器可省，成本再降。')
    print('  - 全因子(9参数) 天花板明显更高 -> 量化"因成本放弃贵参数"损失了多少准确率，')
    print('    正好用数学解释 SHAP 里"便宜参数影响力低"的困惑：不是模型无能，是信息缺失。')
