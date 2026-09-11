import os
import polars as pl
import pandas as pd
import json
from datetime import datetime

PQ_PATH = r"C:\GoogleAntigravity\2026IoTcenter\Dajia\output\dajia_buffer500_hourly_202506_202609.parquet"
df = pl.read_parquet(PQ_PATH)

# 品管條件
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

# 1. 月均值分析 (全區 30 台長期測站，排除短期 TC0905)
df_longterm = df_clean.filter(pl.col("name") != "TC0905")

monthly_stats = (
    df_longterm.group_by("month")
    .agg([
        pl.col("voc_clean").mean().round(2).alias("mean_voc"),
        pl.col("voc_clean").median().round(2).alias("median_voc"),
        pl.col("voc_clean").quantile(0.95).round(2).alias("p95_voc"),
        (pl.col("voc_clean") >= 500).sum().alias("gt500_hours"),
        pl.col("voc_clean").drop_nulls().count().alias("valid_hours")
    ])
    .with_columns(
        ((pl.col("gt500_hours") / pl.col("valid_hours")) * 100).round(2).alias("gt500_rate_pct")
    )
    .sort("month")
)

print("=== 1. 月度 VOC 均值與高污染率統計 ===")
print(monthly_stats.to_pandas().to_string(index=False))

# 找出濃度最高的幾個月 (例如 Top 4 ~ 5 個高濃度月份)
top_months = (
    monthly_stats.sort("mean_voc", descending=True)
    .head(5)["month"].to_list()
)
print(f"\n濃度最高前 5 個月: {top_months}")

# 2. 針對高濃度月份分析「星期幾 (週一至週日)」的特徵
weekday_names = {1: "週一 (Mon)", 2: "週二 (Tue)", 3: "週三 (Wed)", 4: "週四 (Thu)", 5: "週五 (Fri)", 6: "週六 (Sat)", 7: "週日 (Sun)"}

df_top_months = df_longterm.filter(pl.col("month").is_in(top_months))

weekday_stats = (
    df_top_months.group_by("weekday_num")
    .agg([
        pl.col("voc_clean").mean().round(2).alias("mean_voc"),
        pl.col("voc_clean").median().round(2).alias("median_voc"),
        pl.col("voc_clean").quantile(0.95).round(2).alias("p95_voc"),
        (pl.col("voc_clean") >= 500).sum().alias("gt500_hours"),
        pl.col("voc_clean").drop_nulls().count().alias("valid_hours")
    ])
    .with_columns(
        ((pl.col("gt500_hours") / pl.col("valid_hours")) * 100).round(2).alias("gt500_rate_pct")
    )
    .sort("weekday_num")
)

weekday_df = weekday_stats.to_pandas()
weekday_df["weekday"] = weekday_df["weekday_num"].map(weekday_names)
print(f"\n=== 2. 高濃度月份 ({', '.join(top_months)}) 星期幾 (週一至週日) 分析 ===")
print(weekday_df[["weekday", "mean_voc", "median_voc", "p95_voc", "gt500_hours", "gt500_rate_pct"]].to_string(index=False))

# 同時也看全時段 432 天的星期幾分析對照
all_weekday_stats = (
    df_longterm.group_by("weekday_num")
    .agg([
        pl.col("voc_clean").mean().round(2).alias("mean_voc"),
        (pl.col("voc_clean") >= 500).sum().alias("gt500_hours"),
        pl.col("voc_clean").drop_nulls().count().alias("valid_hours")
    ])
    .with_columns(
        ((pl.col("gt500_hours") / pl.col("valid_hours")) * 100).round(2).alias("gt500_rate_pct")
    )
    .sort("weekday_num")
)
all_w_df = all_weekday_stats.to_pandas()
all_w_df["weekday"] = all_w_df["weekday_num"].map(weekday_names)
print("\n=== 全時段 432 天星期幾分析對照 ===")
print(all_w_df[["weekday", "mean_voc", "gt500_hours", "gt500_rate_pct"]].to_string(index=False))

# 3. 4小時時段區間分析 (00-04, 04-08, 08-12, 12-16, 16-20, 20-24)
timeblock_order = [
    "00:00-04:00 (深夜)",
    "04:00-08:00 (清晨拂曉)",
    "08:00-12:00 (上午)",
    "12:00-16:00 (下午)",
    "16:00-20:00 (傍晚)",
    "20:00-24:00 (夜間)"
]

block_stats = (
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
        ((pl.col("gt500_hours") / pl.col("valid_hours")) * 100).round(2).alias("gt500_rate_pct")
    )
)

block_df = block_stats.to_pandas()
block_df["sort_key"] = block_df["time_block"].apply(lambda x: timeblock_order.index(x) if x in timeblock_order else 99)
block_df = block_df.sort_values("sort_key")
print("\n=== 3. 全區 6 個 4 小時區段濃度與異常頻率 ===")
print(block_df[["time_block", "mean_voc", "median_voc", "p95_voc", "gt200_hours", "gt500_hours", "gt500_rate_pct"]].to_string(index=False))

# 4. 東南常態震央 TC1043 在 6 個時段的表現
tc1043_blocks = (
    df_clean.filter(pl.col("name") == "TC1043")
    .group_by("time_block")
    .agg([
        pl.col("voc_clean").mean().round(2).alias("mean_voc"),
        pl.col("voc_clean").quantile(0.95).round(2).alias("p95_voc"),
        (pl.col("voc_clean") >= 500).sum().alias("gt500_hours"),
        pl.col("voc_clean").drop_nulls().count().alias("valid_hours")
    ])
    .with_columns(
        ((pl.col("gt500_hours") / pl.col("valid_hours")) * 100).round(2).alias("gt500_rate_pct")
    )
).to_pandas()
tc1043_blocks["sort_key"] = tc1043_blocks["time_block"].apply(lambda x: timeblock_order.index(x) if x in timeblock_order else 99)
tc1043_blocks = tc1043_blocks.sort_values("sort_key")
print("\n=== TC1043 (中山路二段) 在 6 個時段的表現 ===")
print(tc1043_blocks[["time_block", "mean_voc", "p95_voc", "gt500_hours", "gt500_rate_pct"]].to_string(index=False))
