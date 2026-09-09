# -*- coding: utf-8 -*-
"""
大甲幼獅工業區微型感測器異味污染物 (VOC/TVOC) 熱點深度分析腳本
"""
import os
import polars as pl
import pandas as pd

BASE_DIR = r"C:\GoogleAntigravity\2026IoTcenter"
PQ_PATH = os.path.join(BASE_DIR, "Dajia", "output", "dajia_buffer500_hourly_202506_202609.parquet")
INFO_PATH = os.path.join(BASE_DIR, "iotinformation.csv")

df = pl.read_parquet(PQ_PATH)
df_info = pd.read_csv(INFO_PATH)

# 全區 35 支微感測器 VOC 統計
voc_summary = (
    df.group_by(["deviceId", "name", "lat", "lon"])
    .agg([
        pl.col("voc").count().alias("總時數"),
        pl.col("voc").mean().round(2).alias("平均VOC"),
        pl.col("voc").median().round(2).alias("中位數VOC"),
        pl.col("voc").quantile(0.90).round(2).alias("P90_VOC"),
        pl.col("voc").quantile(0.95).round(2).alias("P95_VOC"),
        pl.col("voc").max().round(2).alias("最大VOC"),
        (pl.col("voc") >= 200).sum().alias("超標200小時數"),
        (pl.col("voc") >= 500).sum().alias("超標500小時數"),
        (pl.col("voc") >= 1000).sum().alias("超標1000小時數"),
        pl.col("pm2_5").mean().round(2).alias("平均PM25")
    ])
    .sort("平均VOC", descending=True)
)

print("=== 大甲幼獅 35 支測站 VOC 總排行 (Top 10) ===")
print(voc_summary.head(10))

# 匹配 iotinformation.csv 的地址或詳細描述
print("\n=== Top 7 測站現場資訊 ===")
top_ids = voc_summary.head(7)["deviceId"].to_list()
for d in top_ids:
    m = df_info[df_info["裝置ID"] == d]
    if not m.empty:
        r = m.iloc[0]
        addr = r.get("地址", r.get("裝設地址", r.get("說明", "無")))
        print(f"裝置ID: {d} | 名稱: {r.get('裝置名稱')} | 裝設位置: {addr} | 經緯度: ({r.get('緯度')}, {r.get('經度')})")

# 24 小時時段分析 (判斷夜間偷排或日間排放)
df_hour = (
    df.filter(pl.col("deviceId").is_in(top_ids))
    .with_columns(pl.col("hour").str.slice(11, 2).alias("h"))
    .group_by(["deviceId", "name", "h"])
    .agg(pl.col("voc").mean().round(1).alias("mean_voc"))
    .sort(["deviceId", "h"])
)

print("\n=== Top 5 測站各時段高峰分析 ===")
for d in top_ids[:5]:
    sub = df_hour.filter(pl.col("deviceId") == d).sort("mean_voc", descending=True)
    name = sub["name"][0]
    top3_h = sub.head(3).iter_rows(named=True)
    h_str = ", ".join([f"{r['h']}時 ({r['mean_voc']} ppb)" for r in top3_h])
    night_mean = sub.filter(pl.col("h").is_in(["22", "23", "00", "01", "02", "03", "04", "05", "06"]))["mean_voc"].mean()
    day_mean = sub.filter(pl.col("h").is_in(["07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17"]))["mean_voc"].mean()
    print(f"[{name}] ID:{d} | 最高3時段: {h_str} | 夜間均值: {night_mean:.1f} ppb vs 日間均值: {day_mean:.1f} ppb")
