import os
import polars as pl
import pandas as pd
import json

PQ_PATH = r"C:\GoogleAntigravity\2026IoTcenter\Dajia\output\dajia_buffer500_hourly_202506_202609.parquet"
INFO_PATH = r"C:\GoogleAntigravity\2026IoTcenter\iotinformation.csv"

df = pl.read_parquet(PQ_PATH)
info = pd.read_csv(INFO_PATH)

# 1. 設備過濾：
# 剔除 0 值比例 >= 80% 或 std == 0 的設備
excluded_sensors = ["TC0179", "TC0915", "TC0221", "TC0414"]

df_valid_dev = df.filter(~pl.col("name").is_in(excluded_sensors))

print(f"排除 4 台失效設備後，剩餘 {df_valid_dev['name'].n_unique()} 台設備，總列數: {len(df_valid_dev)}")

# 2. 數值層級 QC 異常值清理：
# VOC: 剔除 == 65535, == 29206, > 15000
# PM2.5: 剔除 null, > 500
df_cleaned = df_valid_dev.with_columns([
    pl.when(
        (pl.col("voc") == 65535) | 
        (pl.col("voc") == 29206) | 
        (pl.col("voc") > 15000)
    ).then(None).otherwise(pl.col("voc")).alias("voc_clean"),
    
    pl.when(
        pl.col("pm2_5") > 500
    ).then(None).otherwise(pl.col("pm2_5")).alias("pm25_clean")
])

# 統計清理前後的異常筆數
total_rows = len(df_cleaned)
voc_anom = df_cleaned["voc_clean"].null_count()
pm25_anom = df_cleaned["pm25_clean"].null_count()
print(f"VOC 異常值被剔除時數: {voc_anom} 筆 ({voc_anom/total_rows*100:.2f}%)")
print(f"PM2.5 異常值被剔除時數: {pm25_anom} 筆 ({pm25_anom/total_rows*100:.2f}%)")

# 3. 計算各設備統計值
stats = (
    df_cleaned.group_by(["deviceId", "name", "lat", "lon"])
    .agg([
        pl.col("hour").count().alias("total_hours"),
        pl.col("voc_clean").drop_nulls().count().alias("valid_voc_hours"),
        pl.col("voc_clean").mean().round(2).alias("voc_mean"),
        pl.col("voc_clean").median().round(2).alias("voc_median"),
        pl.col("voc_clean").quantile(0.95).round(2).alias("voc_p95"),
        pl.col("voc_clean").max().round(2).alias("voc_max"),
        (pl.col("voc_clean") >= 200).sum().alias("voc_gt200"),
        (pl.col("voc_clean") >= 500).sum().alias("voc_gt500"),
        (pl.col("voc_clean") >= 1000).sum().alias("voc_gt1000"),
        pl.col("pm25_clean").mean().round(2).alias("pm25_mean"),
        pl.col("pm25_clean").quantile(0.95).round(2).alias("pm25_p95"),
        pl.col("hour").min().alias("start_time"),
        pl.col("hour").max().alias("end_time")
    ])
    .sort("voc_mean", descending=True)
)

print("\n=== 清理後設備排行 (Top 15) ===")
stats_df = stats.to_pandas()
print(stats_df.head(15)[["name", "deviceId", "total_hours", "valid_voc_hours", "voc_mean", "voc_median", "voc_p95", "voc_max", "voc_gt200", "voc_gt500", "pm25_mean"]].to_string(index=False))

# 4. 特別分析 TC0905 的情況
tc0905_stat = stats_df[stats_df["name"] == "TC0905"]
print("\n=== TC0905 清理後數據 ===")
print(tc0905_stat[["name", "deviceId", "total_hours", "valid_voc_hours", "voc_mean", "voc_max", "voc_gt200", "voc_gt500"]].to_string(index=False))

