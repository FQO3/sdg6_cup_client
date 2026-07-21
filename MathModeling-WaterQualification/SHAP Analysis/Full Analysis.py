# import pandas as pd
# import numpy as np
# import shap
# import matplotlib.pyplot as plt
# import matplotlib as mpl
# from sklearn.ensemble import RandomForestClassifier
# from sklearn.preprocessing import LabelEncoder
# from scipy.stats import spearmanr
# import seaborn as sns
# import warnings
# warnings.filterwarnings('ignore')

# mpl.rcParams['font.sans-serif'] = ['PingFang SC', 'SimHei', 'Arial Unicode MS']
# mpl.rcParams['axes.unicode_minus'] = False

# df = pd.read_csv('/Users/mimiter/Desktop/A计划/MathModeling-WaterQualification/Data/2026-07-21-11:00-Cleaned.csv')
# feature_cols = ['水温(℃)', 'pH(无量纲)', '溶解氧(mg/L)', '电导率(μS/cm)',
#                 '浊度(NTU)', '高锰酸盐指数(mg/L)', '氨氮(mg/L)', '总磷(mg/L)', '总氮(mg/L)']
# target_col = '水质类别'

# le = LabelEncoder()
# y = le.fit_transform(df[target_col])
# X = df[feature_cols].values

# model = RandomForestClassifier(n_estimators=300, max_depth=12, random_state=42)
# model.fit(X, y)

# explainer = shap.TreeExplainer(model)
# shap_values = explainer.shap_values(X)  # shape: (n_samples, n_features, n_classes)

# class_labels = le.classes_
# n_classes = len(class_labels)

# # 1. SHAP summary bar plot per class
# fig, axes = plt.subplots(2, 3, figsize=(22, 14))
# axes = axes.flatten()
# for i in range(n_classes):
#     sv = shap_values[:, :, i]
#     vals = np.abs(sv).mean(axis=0)
#     order = np.argsort(vals)
#     colors = plt.cm.RdYlBu_r(np.linspace(0, 1, len(feature_cols)))
#     axes[i].barh(range(len(feature_cols)), vals[order], color=colors[order])
#     axes[i].set_yticks(range(len(feature_cols)))
#     axes[i].set_yticklabels([feature_cols[j] for j in order])
#     axes[i].set_title(f'{class_labels[i]}', fontsize=14, fontweight='bold')
#     axes[i].set_xlabel('Mean |SHAP value|')
# plt.tight_layout()
# plt.savefig('shap_summary_bar.png', dpi=200, bbox_inches='tight')
# plt.close()

# # 2. SHAP beeswarm (dot) per class
# fig, axes = plt.subplots(2, 3, figsize=(24, 18))
# axes = axes.flatten()
# for i in range(n_classes):
#     sv = shap_values[:, :, i]
#     f_order = np.argsort(np.abs(sv).mean(axis=0))
#     x_range = max(np.abs(sv).max(), 0.5)
#     for j in range(len(feature_cols)):
#         idx = f_order[j]
#         axes[i].scatter(sv[:, idx], np.full(sv.shape[0], j),
#                        c=X[:, idx], cmap='coolwarm', alpha=0.4, s=4, edgecolors='none')
#     axes[i].set_yticks(range(len(feature_cols)))
#     axes[i].set_yticklabels([feature_cols[f_order[k]] for k in range(len(feature_cols))])
#     axes[i].set_xlabel('SHAP value')
#     axes[i].set_title(f'{class_labels[i]}', fontsize=14, fontweight='bold')
#     axes[i].axvline(0, color='gray', linestyle='--', linewidth=0.5)
# plt.tight_layout()
# plt.savefig('shap_beeswarm.png', dpi=200, bbox_inches='tight')
# plt.close()

# # 3. Mean |SHAP| per feature per class - grouped bar chart
# # shap_values shape: (1099, 9, 6) -> mean abs across samples -> (9, 6)
# mean_shap = np.abs(shap_values).mean(axis=0)  # (9 features, 6 classes)
# df_import = pd.DataFrame(mean_shap, columns=class_labels, index=feature_cols)

# fig, ax = plt.subplots(figsize=(14, 8))
# x = np.arange(len(feature_cols))
# w = 0.12
# for i, cls in enumerate(class_labels):
#     bars = ax.bar(x + i * w, df_import[cls], w, label=cls)
#     for bar, v in zip(bars, df_import[cls]):
#         ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.01,
#                 f'{v:.3f}', ha='center', va='bottom', fontsize=7, rotation=45)
# ax.set_xticks(x + w * (n_classes - 1) / 2)
# ax.set_xticklabels(feature_cols, rotation=30, ha='right')
# ax.set_ylabel('Mean |SHAP value|')
# ax.set_title('SHAP Feature Importance (mean |SHAP|) per Class', fontsize=15, fontweight='bold')
# ax.legend()
# plt.tight_layout()
# plt.savefig('shap_feature_importance_per_class.png', dpi=200, bbox_inches='tight')
# plt.close()

# # 4. Spearman correlation: features vs SHAP values
# # For each class, compute spearman between each feature column and its corresponding SHAP column
# spearman_data = []
# for i, cls in enumerate(class_labels):
#     row = []
#     for j, feat in enumerate(feature_cols):
#         r, p = spearmanr(X[:, j], shap_values[:, j, i])
#         row.append(r)
#     spearman_data.append(row)
# df_spearman = pd.DataFrame(spearman_data, columns=feature_cols, index=class_labels)

# fig, ax = plt.subplots(figsize=(14, 6))
# sns.heatmap(df_spearman, annot=True, cmap='RdBu_r', center=0, vmin=-1, vmax=1,
#             fmt='.3f', linewidths=0.5, ax=ax, cbar_kws={'label': "Spearman's ρ"})
# ax.set_title("Spearman Correlation: Feature vs SHAP Value (by Class)", fontsize=14, fontweight='bold')
# plt.tight_layout()
# plt.savefig('shap_spearman_heatmap.png', dpi=200, bbox_inches='tight')
# plt.close()

# # 5. SHAP waterfall plots for first sample of each class
# X_df = pd.DataFrame(X, columns=feature_cols)
# for i, cls in enumerate(class_labels):
#     idx = np.where(y == i)[0][0]
#     exp = shap.Explanation(values=shap_values[idx, :, i],
#                            base_values=explainer.expected_value[i],
#                            data=X_df.iloc[idx].values,
#                            feature_names=feature_cols)
#     shap.waterfall_plot(exp, show=False, max_display=9)
#     fig = plt.gcf()
#     fig.suptitle(f'SHAP Waterfall - {cls}', fontsize=14, fontweight='bold')
#     plt.tight_layout()
#     plt.savefig(f'shap_waterfall_{cls}.png', dpi=200, bbox_inches='tight')
#     plt.close()

# # 6. Print top-3 features per class
# print("=" * 60)
# print("Top-3 Most Important Features per Water Class (by mean |SHAP|)")
# print("=" * 60)
# for i, cls in enumerate(class_labels):
#     imp = np.abs(shap_values[:, :, i]).mean(axis=0)
#     top3 = np.argsort(imp)[::-1][:3]
#     print(f"\n{class_labels[i]}:")
#     for rank, idx in enumerate(top3, 1):
#         print(f"  {rank}. {feature_cols[idx]}  (mean |SHAP| = {imp[idx]:.4f})")

# # 7. Overall top features (averaged across all classes)
# overall_imp = np.abs(shap_values).mean(axis=(0, 1))
# overall_top3 = np.argsort(overall_imp)[::-1]
# print("\n" + "=" * 60)
# print("Overall Top-3 Features (mean |SHAP| across all classes)")
# print("=" * 60)
# for rank, idx in enumerate(overall_top3[:3], 1):
#     print(f"  {rank}. {feature_cols[idx]}  (mean |SHAP| = {overall_imp[idx]:.4f})")

# print("\nDone! All plots saved to SHAP Analysis/")


import pandas as pd
import numpy as np
import shap
import matplotlib.pyplot as plt
import matplotlib as mpl
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder
from scipy.stats import spearmanr
import seaborn as sns
import warnings
warnings.filterwarnings('ignore')

# ---------- 中文字体设置 ----------
mpl.rcParams['font.sans-serif'] = ['PingFang SC', 'SimHei', 'Arial Unicode MS']
mpl.rcParams['axes.unicode_minus'] = False

# ---------- 数据加载 ----------
df = pd.read_csv('./Data/Merge.csv')
feature_cols = ['水温(℃)', 'pH(无量纲)', '溶解氧(mg/L)', '电导率(μS/cm)',
                '浊度(NTU)', '高锰酸盐指数(mg/L)', '氨氮(mg/L)', '总磷(mg/L)', '总氮(mg/L)']
target_col = '水质类别'

le = LabelEncoder()
y = le.fit_transform(df[target_col])
X = df[feature_cols].values

# ---------- 模型训练 ----------
model = RandomForestClassifier(n_estimators=300, max_depth=12, random_state=42)
model.fit(X, y) # type: ignore

# ---------- SHAP 计算 ----------
explainer = shap.TreeExplainer(model)
shap_values = explainer.shap_values(X)  # shape: (n_samples, n_features, n_classes)

class_labels = le.classes_
n_classes = len(class_labels)

# ========== 1. SHAP summary bar plot per class ==========
fig, axes = plt.subplots(2, 3, figsize=(22, 14))
axes = axes.flatten()
for i in range(n_classes):
    sv = shap_values[:, :, i]
    vals = np.abs(sv).mean(axis=0)
    order = np.argsort(vals)
    colors = plt.cm.RdYlBu_r(np.linspace(0, 1, len(feature_cols))) # type: ignore
    axes[i].barh(range(len(feature_cols)), vals[order], color=colors[order])
    axes[i].set_yticks(range(len(feature_cols)))
    axes[i].set_yticklabels([feature_cols[j] for j in order])
    axes[i].set_title(f'{class_labels[i]}', fontsize=14, fontweight='bold')
    axes[i].set_xlabel('平均 |SHAP 值|')
plt.tight_layout()
plt.show()  # 显示图形，不保存

# ========== 2. SHAP beeswarm (dot) per class ==========
fig, axes = plt.subplots(2, 3, figsize=(24, 18))
axes = axes.flatten()
for i in range(n_classes):
    sv = shap_values[:, :, i]
    f_order = np.argsort(np.abs(sv).mean(axis=0))
    x_range = max(np.abs(sv).max(), 0.5)
    for j in range(len(feature_cols)):
        idx = f_order[j]
        axes[i].scatter(sv[:, idx], np.full(sv.shape[0], j),
                       c=X[:, idx], cmap='coolwarm', alpha=0.4, s=4, edgecolors='none')
    axes[i].set_yticks(range(len(feature_cols)))
    axes[i].set_yticklabels([feature_cols[f_order[k]] for k in range(len(feature_cols))])
    axes[i].set_xlabel('SHAP 值')
    axes[i].set_title(f'{class_labels[i]}', fontsize=14, fontweight='bold')
    axes[i].axvline(0, color='gray', linestyle='--', linewidth=0.5)
plt.tight_layout()
plt.show()

# ========== 3. Mean |SHAP| per feature per class - grouped bar chart ==========
mean_shap = np.abs(shap_values).mean(axis=0)  # (9 features, 6 classes)
df_import = pd.DataFrame(mean_shap, columns=class_labels, index=feature_cols)

fig, ax = plt.subplots(figsize=(14, 8))
x = np.arange(len(feature_cols))
w = 0.12
for i, cls in enumerate(class_labels):
    bars = ax.bar(x + i * w, df_import[cls], w, label=cls)
    for bar, v in zip(bars, df_import[cls]):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.01,
                f'{v:.3f}', ha='center', va='bottom', fontsize=7, rotation=45)
ax.set_xticks(x + w * (n_classes - 1) / 2)
ax.set_xticklabels(feature_cols, rotation=30, ha='right')
ax.set_ylabel('平均 |SHAP 值|')
ax.set_title('各类别 SHAP 特征重要性（平均 |SHAP|）', fontsize=15, fontweight='bold')
ax.legend()
plt.tight_layout()
plt.show()

# ========== 4. Spearman correlation heatmap ==========
spearman_data = []
for i, cls in enumerate(class_labels):
    row = []
    for j, feat in enumerate(feature_cols):
        r, p = spearmanr(X[:, j], shap_values[:, j, i])
        row.append(r)
    spearman_data.append(row)
df_spearman = pd.DataFrame(spearman_data, columns=feature_cols, index=class_labels)

fig, ax = plt.subplots(figsize=(14, 6))
sns.heatmap(df_spearman, annot=True, cmap='RdBu_r', center=0, vmin=-1, vmax=1,
            fmt='.3f', linewidths=0.5, ax=ax, cbar_kws={'label': "Spearman's ρ"})
ax.set_title("特征与 SHAP 值的 Spearman 相关性（按类别）", fontsize=14, fontweight='bold')
plt.tight_layout()
plt.show()

# ========== 5. SHAP waterfall plots for first sample of each class ==========
X_df = pd.DataFrame(X, columns=feature_cols)
for i, cls in enumerate(class_labels):
    idx = np.where(y == i)[0][0]
    exp = shap.Explanation(values=shap_values[idx, :, i],
                           base_values=explainer.expected_value[i], # type: ignore
                           data=X_df.iloc[idx].values,
                           feature_names=feature_cols)
    shap.waterfall_plot(exp, show=False, max_display=9)
    fig = plt.gcf()
    fig.suptitle(f'SHAP 瀑布图 - {cls}', fontsize=14, fontweight='bold')
    plt.tight_layout()
    plt.show()  # 逐个显示瀑布图

# ========== 6. 终端输出特征排名 ==========
print("=" * 60)
print("各类别最重要的前 3 个特征（按平均 |SHAP|）")
print("=" * 60)
for i, cls in enumerate(class_labels):
    imp = np.abs(shap_values[:, :, i]).mean(axis=0)
    top3 = np.argsort(imp)[::-1][:3]
    print(f"\n{class_labels[i]}:")
    for rank, idx in enumerate(top3, 1):
        print(f"  {rank}. {feature_cols[idx]}  (平均 |SHAP| = {imp[idx]:.4f})")

overall_imp = np.abs(shap_values).mean(axis=(0, 1))
overall_top3 = np.argsort(overall_imp)[::-1]
print("\n" + "=" * 60)
print("全部类别综合前 3 个重要特征（平均 |SHAP|）")
print("=" * 60)
for rank, idx in enumerate(overall_top3[:3], 1):
    print(f"  {rank}. {feature_cols[idx]}  (平均 |SHAP| = {overall_imp[idx]:.4f})")

print("\n完成！所有图形已通过 plt.show() 显示。")