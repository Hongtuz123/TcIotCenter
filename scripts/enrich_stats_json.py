# -*- coding: utf-8 -*-
import os
import json
import polars as pl
import pandas as pd

BASE_DIR = r"C:\GoogleAntigravity\2026IoTcenter"
PQ_PATH = os.path.join(BASE_DIR, "Dajia", "output", "dajia_buffer500_hourly_202506_202609.parquet")
JSON_PATH = os.path.join(BASE_DIR, "documents", "figures", "dajia_stats_for_report.json")

with open(JSON_PATH, "r", encoding="utf-8") as f:
    stats_data = json.load(f)

df = pl.read_parquet(PQ_PATH)

excluded_sensors = ["TC0179", "TC0915", "TC0221", "TC0414"]

df_clean = (
    df.filter(~pl.col("name").is_in(excluded_sensors))
    .with_columns([
        pl.when(
            (pl.col("voc") == 65535) | 
            (pl.col("voc") == 29206) | 
            (pl.col("voc") > 15000)
        ).then(None).otherwise(pl.col("voc")).alias("voc_clean"),
        pl.col("hour").str.slice(0, 7).alias("month"),
        pl.col("hour").str.slice(0, 10).alias("date"),
        pl.col("hour").str.slice(11, 2).cast(pl.Int32).alias("h_int")
    ])
    .with_columns([
        pl.col("date").str.to_date("%Y-%m-%d").dt.weekday().alias("weekday_num") # 1=Mon, 7=Sun
    ])
    .with_columns([
        pl.when(pl.col("h_int") < 4).then(pl.lit("00:00-04:00 (深夜)"))
        .when(pl.col("h_int") < 8).then(pl.lit("04:00-08:00 (清晨拂曉)"))
        .when(pl.col("h_int") < 12).then(pl.lit("08:00-12:00 (上午)"))
        .when(pl.col("h_int") < 16).then(pl.lit("12:00-16:00 (下午)"))
        .when(pl.col("h_int") < 20).then(pl.lit("16:00-20:00 (傍晚)"))
        .otherwise(pl.lit("20:00-24:00 (夜間)")).alias("time_block")
    ])
)

df_longterm = df_clean.filter(pl.col("name") != "TC0905")

# 1. 每月均值
monthly = (
    df_longterm.group_by("month")
    .agg([
        pl.col("voc_clean").mean().round(2).alias("mean_voc"),
        pl.col("voc_clean").quantile(0.95).round(2).alias("p95_voc"),
        (pl.col("voc_clean") >= 500).sum().alias("gt500_hours"),
        pl.col("voc_clean").drop_nulls().count().alias("valid_hours")
    ])
    .with_columns(
        ((pl.col("gt500_hours") / pl.col("valid_hours")) * 100).round(2).alias("gt500_rate")
    )
    .sort("month")
).to_dicts()

top_months = ["2025-06", "2025-07", "2025-08", "2025-09", "2025-10"]

# 2. 高濃度月份星期幾分析
weekday_labels = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"]
weekday_top_months = (
    df_longterm.filter(pl.col("month").is_in(top_months))
    .group_by("weekday_num")
    .agg([
        pl.col("voc_clean").mean().round(2).alias("mean_voc"),
        pl.col("voc_clean").quantile(0.95).round(2).alias("p95_voc"),
        (pl.col("voc_clean") >= 500).sum().alias("gt500_hours"),
        pl.col("voc_clean").drop_nulls().count().alias("valid_hours")
    ])
    .with_columns(
        ((pl.col("gt500_hours") / pl.col("valid_hours")) * 100).round(2).alias("gt500_rate")
    )
    .sort("weekday_num")
).to_dicts()

# 全時序 432 天星期幾分析
weekday_all = (
    df_longterm.group_by("weekday_num")
    .agg([
        pl.col("voc_clean").mean().round(2).alias("mean_voc"),
        (pl.col("voc_clean") >= 500).sum().alias("gt500_hours"),
        pl.col("voc_clean").drop_nulls().count().alias("valid_hours")
    ])
    .with_columns(
        ((pl.col("gt500_hours") / pl.col("valid_hours")) * 100).round(2).alias("gt500_rate")
    )
    .sort("weekday_num")
).to_dicts()

# 3. 6 個 4 小時區段分析
timeblock_order = [
    "00:00-04:00 (深夜)",
    "04:00-08:00 (清晨拂曉)",
    "08:00-12:00 (上午)",
    "12:00-16:00 (下午)",
    "16:00-20:00 (傍晚)",
    "20:00-24:00 (夜間)"
]

blocks = (
    df_longterm.group_by("time_block")
    .agg([
        pl.col("voc_clean").mean().round(2).alias("mean_voc"),
        pl.col("voc_clean").median().round(2).alias("median_voc"),
        pl.col("voc_clean").quantile(0.95).round(2).alias("p95_voc"),
        (pl.col("voc_clean") >= 200).sum().alias("gt200_hours"),
        (pl.col("voc_clean") >= 500).sum().alias("gt500_hours"),
        (pl.col("voc_clean") >= 1000).sum().alias("gt1000_hours"),
        pl.col("voc_clean").drop_nulls().count().alias("valid_hours")
    ])
    .with_columns(
        ((pl.col("gt500_hours") / pl.col("valid_hours")) * 100).round(2).alias("gt500_rate")
    )
).to_dicts()

blocks_sorted = sorted(blocks, key=lambda x: timeblock_order.index(x["time_block"]))

# 組合統計數據
stats_data["temporal_analysis"] = {
    "monthly": monthly,
    "top_months": top_months,
    "weekday_top_months": weekday_top_months,
    "weekday_all": weekday_all,
    "time_blocks": blocks_sorted
}

with open(JSON_PATH, "w", encoding="utf-8") as f:
    json.dump(stats_data, f, ensure_ascii=False, indent=2)

print("✅ 成功擴充 dajia_stats_for_report.json 加入三層異常頻率分析數據！")
