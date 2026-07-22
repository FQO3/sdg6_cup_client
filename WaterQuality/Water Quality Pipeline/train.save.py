# -*- coding: utf-8 -*-
"""
train_and_save.py —— 训练随机森林 + 持久化
产出:
  water_rf_4feat.joblib     # 4便宜参数模型
  water_metadata.joblib     # 元数据: 特征顺序 / 等级映射 / 互信息 / 测试指标
运行: python train_and_save.py
"""
import numpy as np
import pandas as pd
import joblib
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.feature_selection import mutual_info_classif
from sklearn.metrics import (confusion_matrix, accuracy_score,
                             cohen_kappa_score, mean_absolute_error)

# ── 配置 ──────────────────────────────────────
CSV = './Data/Merge.csv'
ORDER = ['Ⅰ类', 'Ⅱ类', 'Ⅲ类', 'Ⅳ类', 'Ⅴ类', '劣Ⅵ类']
K = len(ORDER)

CHEAP = ['水温(℃)', 'pH(无量纲)', '电导率(μS/cm)', '浊度(NTU)']

DIRECTION = {
    '水温(℃)': 'down',
    'pH(无量纲)': 'ph',
    '电导率(μS/cm)': 'down',
    '浊度(NTU)': 'down',
}

# 数据集划分比例：训练集 : 测试集 = 8 : 2
TRAIN_RATIO = 0.8
TEST_RATIO = 0.2
RANDOM_STATE = 42

# ── 读数据 ────────────────────────────────────
df = pd.read_csv(CSV)
y = df['水质类别'].map({v: i for i, v in enumerate(ORDER)}).values
print(f'数据: {len(df)} 行, 等级 {ORDER}')


# ── 工具函数 ──────────────────────────────────
def evaluate(y_true, y_pred, tag=''):
    acc = accuracy_score(y_true, y_pred)
    qwk = cohen_kappa_score(y_true, y_pred, weights='quadratic')
    mae = mean_absolute_error(y_true, y_pred)
    tol1 = np.mean(np.abs(np.asarray(y_true) - np.asarray(y_pred)) <= 1)
    cm = confusion_matrix(y_true, y_pred, labels=list(range(K)))
    print(f'\n  [{tag}] Acc={acc*100:.1f}%  Tol±1={tol1*100:.1f}%  QWK={qwk:.3f}  MAE={mae:.3f}')
    print(f'  混淆矩阵:\n{cm}')
    return {'Acc': acc, 'Tol±1': tol1, 'QWK': qwk, 'MAE': mae}


def compute_mutual_info(X, y, feats):
    """返回每列互信息 (bits)"""
    mi = mutual_info_classif(X, y, random_state=0) / np.log(2)
    return dict(zip(feats, np.round(mi, 3)))


def train_one(feats, name):
    print(f'\n{"="*50}')
    print(f'训练: {name}  ({len(feats)} 特征)')
    print(f'{"="*50}')

    X = df[feats].values.astype(float)
    mi = compute_mutual_info(X, y, feats)
    print(f'  互信息 (bits): {mi}')

    Xtr, Xte, ytr, yte = train_test_split(
        X, y, test_size=TEST_RATIO, random_state=RANDOM_STATE, stratify=y) # type: ignore
    print(f'  数据集划分: 训练集 {len(Xtr)} 条 ({TRAIN_RATIO:.0%}), 测试集 {len(Xte)} 条 ({TEST_RATIO:.0%})')

    sc = StandardScaler().fit(Xtr)
    Xtr_s = sc.transform(Xtr)
    Xte_s = sc.transform(Xte)

    rf = RandomForestClassifier(
        n_estimators=400, max_depth=None,
        class_weight='balanced', random_state=42, n_jobs=-1)
    rf.fit(Xtr_s, ytr)

    metrics = evaluate(yte, rf.predict(Xte_s), tag=f'{name} 测试集')
    return rf, sc, mi, metrics


# ── 训练 ──────────────────────────────────────
rf, sc, mi, m = train_one(CHEAP, '4便宜参数')

# ── 保存 ──────────────────────────────────────
pkg = {
    'model': rf, 'scaler': sc,
    'features': CHEAP, 'order': ORDER, 'direction': DIRECTION,
    'mutual_info': mi, 'test_metrics': m,
}
joblib.dump(pkg, './Water Quality Pipeline/models/water_rf_4feat.joblib', compress=3)
print('\n✅ 已保存: water_rf_4feat.joblib')

metadata = {
    'features': CHEAP,
    'order': ORDER,
    'direction': DIRECTION,
    'mutual_info': mi,
    'test_metrics': m,
}
joblib.dump(metadata, './Water Quality Pipeline/models/water_metadata.joblib')
print('✅ 已保存: water_metadata.joblib')