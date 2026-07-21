"""
热力图生成程序
==============
在该区域修改矩阵标签和数据，运行后自动生成热力图。
"""

import matplotlib.pyplot as plt
import matplotlib
import numpy as np
import os

# ============================================================
# ★ 修改区域：在这里修改你的标签和数据
# ============================================================

# 行列标签（行列共用同一组标签时，只设置 labels 即可）
labels = ["Ⅰ类", "Ⅱ类", "Ⅲ类", "Ⅳ类", "Ⅴ类", "劣Ⅵ类"]

# 矩阵数据（每行对应一个行标签，每列对应一个列标签）
data = [[6, 52, 0, 0, 0, 0],
        [4, 308, 62, 0, 0, 0],
        [1, 52, 169, 43, 0, 0],
        [0, 5, 72, 108, 23, 4],
        [0, 0, 6, 43, 26, 15],
        [0, 7, 6, 12, 23, 30]]


# 图表标题
title = "九因子LogisticAT混淆矩阵热力图"

# X轴标签
xlabel = "预测类别"

# Y轴标签
ylabel = "实际类别"

# 色彩映射方案（可选：'Blues', 'YlOrRd', 'RdYlGn', 'coolwarm' 等）
cmap_name = "YlOrRd"

# 是否在格子内显示数值
show_annotations = True

# 数值字体大小
annot_fontsize = 12

# 保存图片的 DPI（分辨率）
save_dpi = 200

# 保存图片的文件名
output_filename = "heatmap.png"

# ============================================================
# ★ 以下为绘图代码，一般无需修改
# ============================================================

# 尝试设置中文字体
_chinese_fonts = [
    "WenQuanYi Micro Hei",
    "WenQuanYi Zen Hei",
    "Noto Sans CJK SC",
    "Noto Sans SC",
    "SimHei",
    "Microsoft YaHei",
    "PingFang SC",
    "Source Han Sans SC",
    "AR PL UMing CN",
    "AR PL UKai CN",
    "DejaVu Sans",
]
_available = {f.name for f in matplotlib.font_manager.fontManager.ttflist} # type: ignore
_selected = None
for _f in _chinese_fonts:
    if _f in _available:
        _selected = _f
        break

if _selected:
    plt.rcParams["font.sans-serif"] = [_selected, "DejaVu Sans"]
else:
    plt.rcParams["font.sans-serif"] = ["DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

# 转换为 numpy 数组
matrix = np.array(data, dtype=float)

# 创建画布
fig, ax = plt.subplots(figsize=(8, 6))

# 绘制热力图
im = ax.imshow(matrix, cmap=cmap_name, aspect="auto")

# 设置刻度
ax.set_xticks(range(len(labels)))
ax.set_yticks(range(len(labels)))
ax.set_xticklabels(labels, fontsize=11)
ax.set_yticklabels(labels, fontsize=11)

# 轴标签
ax.set_xlabel(xlabel, fontsize=13)
ax.set_ylabel(ylabel, fontsize=13)
ax.set_title(title, fontsize=15, fontweight="bold")

# 在格子内显示数值
if show_annotations:
    for i in range(len(labels)):
        for j in range(len(labels)):
            val = matrix[i, j]
            # 根据背景颜色深浅自动选择白色或黑色文字
            norm_val = (val - matrix.min()) / (matrix.max() - matrix.min() + 1e-10)
            text_color = "white" if norm_val > 0.55 else "black"
            ax.text(
                j, i, f"{int(val)}",
                ha="center", va="center",
                fontsize=annot_fontsize,
                color=text_color,
                fontweight="bold",
            )

# 添加颜色条
cbar = plt.colorbar(im, ax=ax, shrink=0.85, pad=0.02)
cbar.set_label("样本数", fontsize=11)

plt.tight_layout()

# 保存到 outputs 目录
output_dir = "./Water Quality Pipeline/Data Report/outputs"
os.makedirs(output_dir, exist_ok=True)
output_path = os.path.join(output_dir, output_filename)
plt.savefig(output_path, dpi=save_dpi, bbox_inches="tight")
print(f"热力图已保存至: {output_path}")

# ============================================================
# ★ 终端打印矩阵预览
# ============================================================
print("\n当前矩阵数据预览:")
print("-" * 50)
header = "        " + "  ".join(f"{l:>6s}" for l in labels)
print(header)
for label, row in zip(labels, data):
    row_str = "  ".join(f"{v:6d}" for v in row)
    print(f"{label:>6s}  {row_str}")
print("-" * 50)
