import pandas as pd

# 读取 CSV，将 '--' 识别为缺失值
df = pd.read_csv('./RawData/2026-07-21-1700.csv', na_values=['--'])

# 删除指定列（注意列名与文件完全一致，若有空格需保留）
cols_to_drop = ['省份', '流域', '断面名称', '监测时间', '叶绿素α(mg/L)', '藻密度(cells/L)']
df_dropped = df.drop(columns=cols_to_drop, errors='ignore')

# 横向删除不完整行：剩余列中任一值为 NaN（原 '--'）则删掉
df_clean = df_dropped.dropna(how='any')

# 查看结果
print(df_clean)

df_clean.to_csv('./Data/2026-07-21-1700-Cleaned.csv', index=False)