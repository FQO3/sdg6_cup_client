# -*- coding: utf-8 -*-
"""
shap_analysis.py —— 对训练好的随机森林做 SHAP 因子重要性分析
复现 train_and_save.py 完全一致的 RF（同特征/同划分/同随机种子），
用 TreeExplainer 计算 SHAP，产出:
  1) shap_global_importance.png   全局 |SHAP| 平均值条形图
  2) shap_per_class.png           每个水质等级各因子的贡献
  3) shap_beeswarm_*.png          蜂群图（可选，关键类别）
  4) 控制台打印数值表 + 结论
运行: python shap_analysis.py
"""
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
import shap

# ── 中文字体（本地若报方块可换成你系统里的中文字体路径）──
for f in ['SimHei', 'Microsoft YaHei', 'WenQuanYi Zen Hei', 'Noto Sans CJK SC', 'Arial Unicode MS']:
    if any(f in fn.name for fn in font_manager.fontManager.ttflist):
        plt.rcParams['font.sans-serif'] = [f]
        break
plt.rcParams['axes.unicode_minus'] = False

# ── 配置：与 train_and_save.py 完全一致 ──
CSV = './Data/Merge.csv'
ORDER = ['Ⅰ类', 'Ⅱ类', 'Ⅲ类', 'Ⅳ类', 'Ⅴ类', '劣Ⅵ类']
CHEAP = ['水温(℃)', 'pH(无量纲)', '电导率(μS/cm)', '浊度(NTU)']
# 画图用简短英文名，避免字体问题
SHORT = ['Temp', 'pH', 'EC', 'Turb']
K = len(ORDER)
OUT = './Water Quality Pipeline/models/shap report'

# ── 复现模型 ──
df = pd.read_csv(CSV)
y = df['水质类别'].map({v: i for i, v in enumerate(ORDER)}).values
X = df[CHEAP].values.astype(float)

Xtr, Xte, ytr, yte = train_test_split(
    X, y, test_size=0.25, random_state=42, stratify=y) # type: ignore
sc = StandardScaler().fit(Xtr)
Xtr_s, Xte_s = sc.transform(Xtr), sc.transform(Xte)

rf = RandomForestClassifier(
    n_estimators=400, max_depth=None,
    class_weight='balanced', random_state=42, n_jobs=-1)
rf.fit(Xtr_s, ytr)
print(f'模型复现完成  训练集测试集准确率={rf.score(Xte_s, yte)*100:.1f}%')

# ── SHAP ──
explainer = shap.TreeExplainer(rf)
sv = explainer.shap_values(Xte_s)   # 兼容多种 shap 版本的返回形态

# 归一化为 shape (n_samples, n_features, n_classes)
sv = np.array(sv)
if sv.ndim == 3 and sv.shape[0] == K:          # (K, n, feat)  旧版
    sv = np.transpose(sv, (1, 2, 0))
elif sv.ndim == 3 and sv.shape[2] == K:        # (n, feat, K)  新版
    pass
else:
    raise RuntimeError(f'未知 SHAP 形状: {sv.shape}')
print(f'SHAP 张量形状 (样本, 特征, 类别) = {sv.shape}')

# ── 1) 全局重要性：对类别和样本取 |SHAP| 平均 ──
abs_mean = np.abs(sv).mean(axis=(0, 2))                 # (feat,)
glob = pd.Series(abs_mean, index=SHORT).sort_values(ascending=True)
glob_pct = (glob / glob.sum() * 100).round(1)

print('\n=== 全局特征重要性 (平均 |SHAP|) ===')
for name, val, pct in zip(glob.index[::-1], glob.values[::-1], glob_pct.values[::-1]):
    print(f'  {name:5s}  {val:.4f}   ({pct:.1f}%)')

plt.figure(figsize=(7, 4))
bars = plt.barh(glob.index, glob.values, color='#3b82f6') # type: ignore
for b, p in zip(bars, glob_pct.values):
    plt.text(b.get_width(), b.get_y() + b.get_height()/2,
             f' {p:.1f}%', va='center', fontsize=10)
plt.xlabel('Mean |SHAP value|  (average impact on model output)')
plt.title('Global Feature Importance (SHAP) — 4 cheap sensors')
plt.tight_layout()
plt.savefig(f'{OUT}/shap_global_importance.png', dpi=150)
plt.close()

# ── 2) 每类重要性：对样本取 |SHAP| 平均，保留类别维 ──
per_class = np.abs(sv).mean(axis=0)          # (feat, K)
pc_df = pd.DataFrame(per_class, index=SHORT, columns=[f'{i}:{ORDER[i]}' for i in range(K)])
print('\n=== 每个等级下各因子的平均 |SHAP| ===')
print(pc_df.round(4).to_string())

fig, ax = plt.subplots(figsize=(9, 5))
bottom = np.zeros(K)
colors = ['#ef4444', '#22c55e', '#3b82f6', '#f59e0b']
for i, feat in enumerate(SHORT):
    ax.bar(range(K), per_class[i], bottom=bottom, label=feat, color=colors[i])
    bottom += per_class[i]
ax.set_xticks(range(K))
ax.set_xticklabels([f'Class {i}\n({["I","II","III","IV","V","VI+"][i]})' for i in range(K)])
ax.set_ylabel('Mean |SHAP value|')
ax.set_title('Per-class Feature Contribution (SHAP)')
ax.legend(title='Feature')
plt.tight_layout()
plt.savefig(f'{OUT}/shap_per_class.png', dpi=150)
plt.close()

# ── 3) 蜂群图：对"劣Ⅵ类"(最重污染)这一类看方向性 ──
worst = K - 1
try:
    shap.summary_plot(sv[:, :, worst], Xte_s, feature_names=SHORT, show=False)
    plt.title(f'SHAP beeswarm — Class {worst} ({ORDER[worst]})')
    plt.tight_layout()
    plt.savefig(f'{OUT}/shap_beeswarm_worst.png', dpi=150, bbox_inches='tight')
    plt.close()
except Exception as e:
    print('beeswarm skipped:', e)

# ── 4) 对比互信息 ──
from sklearn.feature_selection import mutual_info_classif
mi = mutual_info_classif(X, y, random_state=0) / np.log(2) # type: ignore
cmp = pd.DataFrame({
    'SHAP全局%': glob_pct.reindex(SHORT).values,
    '互信息(bits)': np.round(mi, 3),
}, index=CHEAP)
print('\n=== SHAP vs 互信息 对照 ===')
print(cmp.to_string())

print('\n✅ 图已保存到 outputs: shap_global_importance.png / shap_per_class.png / shap_beeswarm_worst.png')