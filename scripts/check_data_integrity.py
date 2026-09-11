import os
import polars as pl
import pandas as pd

PQ_PATH = r"C:\GoogleAntigravity\2026IoTcenter\Dajia\output\dajia_buffer500_hourly_202506_202609.parquet"
INFO_PATH = r"C:\GoogleAntigravity\2026IoTcenter\iotinformation.csv"

df = pl.read_parquet(PQ_PATH)
info = pd.read_csv(INFO_PATH)

print("=== 1. 整體資料時間與筆數 ===")
print("總筆數:", len(df))
print("最早時間:", df["hour"].min())
print("最晚時間:", df["hour"].max())
unique_hours = df["hour"].n_unique()
print("不重複整點時數:", unique_hours)

print("\n=== 2. 35 支測站觀測時數與有效性 ===")
stats = (
    df.group_by(["name", "deviceId"])
    .agg([
        pl.col("hour").count().alias("total_hours"),
        pl.col("hour").min().alias("start_time"),
        pl.col("hour").max().alias("end_time"),
        pl.col("voc").null_count().alias("voc_nulls"),
        pl.col("voc").mean().round(2).alias("voc_mean"),
        pl.col("voc").median().round(2).alias("voc_median"),
        pl.col("voc").quantile(0.95).round(2).alias("voc_p95"),
        pl.col("voc").max().round(2).alias("voc_max"),
        (pl.col("voc") >= 200).sum().alias("gt200"),
        (pl.col("voc") >= 500).sum().alias("gt500"),
        (pl.col("voc") >= 1000).sum().alias("gt1000"),
        pl.col("pm2_5").mean().round(2).alias("pm25_mean")
    ])
    .sort("voc_mean", descending=True)
)

stats_df = stats.to_pandas()
print(stats_df.to_string(index=False))

print("\n=== 3. 檢查 TC0905 的具體時段 ===")
tc0905 = df.filter(pl.col("name") == "TC0905").sort("hour")
print("TC0905 前 5 筆:")
print(tc0905.head(5).select(["hour", "name", "voc", "pm2_5"]))
print("TC0905 後 5 筆:")
print(tc0905.tail(5).select(["hour", "name", "voc", "pm2_5"]))

print("\n=== 4. 檢查是否有其他筆數極低或異常的測站 ===")
low_hours = stats_df[stats_df["total_hours"] < 5000]
print("總時數 < 5000 小時的測站:")
print(low_hours[["name", "deviceId", "total_hours", "start_time", "end_time", "voc_mean"]])

print("\n=== 5. 檢查各測站 voc 欄位的極端值與 0 值 ===")
for r in stats_df.itertuples():
    sub = df.filter(pl.col("name") == r.name)
    zeros = (sub["voc"] == 0).sum()
    print(f"{r.name}: 總{r.total_hours}筆, VOC=0有{zeros}筆({zeros/r.total_hours*100:.1f}%), 最大值={r.voc_max}, 均值={r.voc_mean}")
