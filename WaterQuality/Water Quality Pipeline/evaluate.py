# -*- coding: utf-8 -*-
"""
evaluate.py —— 加载已训练模型 → 评估 / 批量预测

用法:
  python evaluate.py                          # 在测试集上复现评估
  python evaluate.py --csv your_data.csv      # 批预测含标签的CSV (评估)
  python evaluate.py --csv your_data.csv --no-label  # 批预测无标签CSV (仅预测)
  python evaluate.py --interactive            # 交互式逐个输入

依赖: joblib pandas numpy scikit-learn
"""
import argparse
import joblib
import numpy as np
import pandas as pd
from pathlib import Path
from sklearn.metrics import (confusion_matrix, accuracy_score,
                             cohen_kappa_score, mean_absolute_error)

# ── 加载模型 ──────────────────────────────────
BASE = Path(__file__).parent
MODEL_DIR = BASE / 'models' if (BASE / 'models').is_dir() else BASE
PKG = joblib.load(MODEL_DIR / 'water_rf_4feat.joblib')
model, scaler, feats, order = PKG['model'], PKG['scaler'], PKG['features'], PKG['order']
K = len(order)

# ── 工具 ──────────────────────────────────────
def predict_batch(df):
    """对 DataFrame 批量预测，返回预测结果 DataFrame"""
    X = df[feats].values.astype(float)
    X_s = scaler.transform(X)
    probs = model.predict_proba(X_s)
    pred_indices = np.argmax(probs, axis=1)
    confs = probs[np.arange(len(probs)), pred_indices]

    out = df.copy()
    out['预测等级'] = [order[i] for i in pred_indices]
    out['置信度'] = np.round(confs, 4)
    for i, lbl in enumerate(order):
        out[f'P({lbl})'] = np.round(probs[:, i], 4)
    return out


def evaluate_csv(df, label_col='水质类别'):
    """对含标签的 CSV 做评估"""
    y_true = df[label_col].map({v: i for i, v in enumerate(order)}).values
    if np.any(pd.isna(y_true)):
        print(f'⚠ 标签列"{label_col}"有无法映射的值，将丢弃对应行')
        mask = ~pd.isna(y_true)
        df, y_true = df[mask].copy(), y_true[mask].astype(int)

    out = predict_batch(df)
    y_pred = out['预测等级'].map({v: i for i, v in enumerate(order)}).values

    acc = accuracy_score(y_true, y_pred)
    qwk = cohen_kappa_score(y_true, y_pred, weights='quadratic')
    mae = mean_absolute_error(y_true, y_pred)
    tol1 = np.mean(np.abs(y_true - y_pred) <= 1)
    cm = confusion_matrix(y_true, y_pred, labels=list(range(K)))

    print(f'\n──── 评估结果 ────')
    print(f'  样本数: {len(y_true)}')
    print(f'  准确率 Acc = {acc*100:.1f}%')
    print(f'  ±1级容错  = {tol1*100:.1f}%')
    print(f'  QWK(二次加权Kappa) = {qwk:.3f}')
    print(f'  MAE(平均差几级)    = {mae:.3f}')
    print(f'  混淆矩阵 (行=真实, 列=预测):')
    print(f'        ', '  '.join(f'{o:>5}' for o in order))
    for i, row in enumerate(cm):
        print(f'  {order[i]:>5}', '  '.join(f'{v:5d}' for v in row))
    return out


def interactive():
    """交互式输入单条预测"""
    print(f'\n交互预测 (输入 q 退出)')
    print(f'特征顺序: {feats}')
    print(f'等级: {order}\n')
    while True:
        try:
            vals = []
            for f in feats:
                v = input(f'{f} = ')
                if v.lower() == 'q':
                    return
                vals.append(float(v))
        except (ValueError, EOFError):
            print('输入无效，重试\n')
            continue

        X = np.array([vals], dtype=float)
        X_s = scaler.transform(X)
        probs = model.predict_proba(X_s)[0]
        pred = int(np.argmax(probs))
        conf = float(probs[pred])

        print(f'\n  → 预测等级: {order[pred]}  置信度: {conf:.3f}')
        print('    各类概率:', {o: round(float(p), 3) for o, p in zip(order, probs)})
        print()


# ── main ──────────────────────────────────────
if __name__ == '__main__':
    p = argparse.ArgumentParser(description='水质等级模型评估/预测')
    p.add_argument('--csv', type=str, help='待预测/评估的 CSV 文件路径')
    p.add_argument('--no-label', action='store_true', help='CSV 不含标签列，仅做预测')
    p.add_argument('--label-col', type=str, default='水质类别', help='标签列名 (默认: 水质类别)')
    p.add_argument('--interactive', '-i', action='store_true', help='交互式逐个输入预测')
    p.add_argument('--out', type=str, help='预测结果输出路径 (CSV)')
    args = p.parse_args()

    if args.interactive:
        interactive()
        exit(0)

    if args.csv:
        df_in = pd.read_csv(args.csv)
        if args.no_label:
            out = predict_batch(df_in)
            print(f'\n预测完成，共 {len(out)} 条')
            print(out[['预测等级', '置信度']].to_string())
        else:
            out = evaluate_csv(df_in, label_col=args.label_col)

        save_path = args.out or (str(Path(args.csv).with_suffix('')) + '_predicted.csv')
        out.to_csv(save_path, index=False, encoding='utf-8-sig')
        print(f'\n✅ 结果已保存: {save_path}')
    else:
        # 默认：在原始训练集的测试集划分上复现评估（仅展示保存时的指标）
        print('未指定 --csv。默认展示训练时保存的指标:')
        m = PKG['test_metrics']
        print(f'  准确率 Acc   = {m["Acc"]*100:.1f}%')
        print(f'  ±1级容错      = {m["Tol±1"]*100:.1f}%')
        print(f'  QWK          = {m["QWK"]:.3f}')
        print(f'  MAE          = {m["MAE"]:.3f}')
        print(f'\n使用 --csv <文件> 对自定义数据评估；--interactive 逐个输入。')