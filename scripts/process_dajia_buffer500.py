# -*- coding: utf-8 -*-
"""
大甲幼獅工業區 Buffer 500m 微型感測器數據整併器
- 範圍：以 dajia_buffer500.shp 空間交集出之 35 支微型感測器
- 資料來源：C:\\GoogleAntigravity\\2026IoTcenter\\Dajia\\原始數據csv (432 天)
- 產出：
  1. 呈報長官 Excel (.xlsx)：包含感測器清單與每小時觀測數據明細 (自動篩選、凍結窗格)
  2. 分析用 Parquet (.parquet)：供 Python 高速載入分析
"""

import os
import glob
import time
import shapefile
from shapely.geometry import shape, Point
from shapely.ops import transform, unary_union
import pyproj
import pandas as pd
import polars as pl
import xlsxwriter
from tqdm import tqdm

# ── 路徑設定 ──────────────────────────────────────────────────────────
BASE_DIR = r"C:\GoogleAntigravity\2026IoTcenter"
DAJIA_DIR = os.path.join(BASE_DIR, "Dajia")
SHP_PATH = os.path.join(DAJIA_DIR, "大甲幼獅工業區buffer500", "dajia_buffer500.shp")
INFO_PATH = os.path.join(BASE_DIR, "iotinformation.csv")
RAW_CSV_DIR = os.path.join(DAJIA_DIR, "原始數據csv")
OUTPUT_DIR = os.path.join(DAJIA_DIR, "output")

EXCEL_OUTPUT = os.path.join(OUTPUT_DIR, "大甲幼獅500m微感測器_每小時觀測數據_202506_202609.xlsx")
PARQUET_OUTPUT = os.path.join(OUTPUT_DIR, "dajia_buffer500_hourly_202506_202609.parquet")

os.makedirs(OUTPUT_DIR, exist_ok=True)

# ── 1. 空間幾何篩選範圍內感測器 ──────────────────────────────────────────
def get_target_sensors():
    print(">>> 正在載入 Shapefile 並執行坐標轉換 (TWD97 -> WGS84)...")
    sf = shapefile.Reader(SHP_PATH, encoding="utf-8")
    transformer = pyproj.Transformer.from_crs("EPSG:3826", "EPSG:4326", always_xy=True)

    polygons_wgs84 = []
    for s in sf.shapes():
        geom = shape(s)
        geom_wgs84 = transform(transformer.transform, geom)
        polygons_wgs84.append(geom_wgs84)
    union_poly = unary_union(polygons_wgs84)

    print(">>> 正在比對感測器清單 (Point in Polygon)...")
    df_info = pd.read_csv(INFO_PATH)
    matched = []
    for _, row in df_info.iterrows():
        p = Point(row["經度"], row["緯度"])
        if union_poly.contains(p):
            matched.append({
                "deviceId": int(row["裝置ID"]),
                "name": str(row["裝置名稱"]),
                "lat": float(row["緯度"]),
                "lon": float(row["經度"])
            })

    df_sensors = pd.DataFrame(matched)
    print(f"✅ 成功鎖定範圍內感測器共 {len(df_sensors)} 台。")
    return df_sensors

# ── 2. 批次逐日讀取並計算小時平均值 ────────────────────────────────────────
def process_daily_files(target_ids):
    csv_files = sorted(glob.glob(os.path.join(RAW_CSV_DIR, "Taichung_*.csv")))
    print(f">>> 找到原始 CSV 檔案共 {len(csv_files)} 天，開始高速串流整併...")

    daily_dfs = []
    t0 = time.time()

    for fpath in tqdm(csv_files, desc="整併進度"):
        try:
            lazy = (
                pl.scan_csv(fpath)
                .select(["localTime", "deviceId", "sensorId", "value"])
                .filter(
                    pl.col("deviceId").is_in(target_ids) &
                    pl.col("localTime").str.contains(r"^\d{4}-\d{2}-\d{2} \d{2}:")
                )
                .with_columns(
                    (pl.col("localTime").str.slice(0, 13) + ":00").alias("hour")
                )
                .group_by(["hour", "deviceId", "sensorId"])
                .agg([
                    pl.col("value").mean().round(2).alias("mean_val"),
                    pl.col("value").count().alias("count_val")
                ])
            )
            df_day = lazy.collect()
            if df_day.is_empty():
                continue

            df_counts = (
                df_day.filter(pl.col("sensorId") == "pm2_5")
                .select(["hour", "deviceId", pl.col("count_val").alias("sample_count")])
            )

            df_pivot = df_day.pivot(
                index=["hour", "deviceId"],
                on="sensorId",
                values="mean_val"
            )

            if not df_counts.is_empty():
                df_pivot = df_pivot.join(df_counts, on=["hour", "deviceId"], how="left")
            else:
                df_pivot = df_pivot.with_columns(pl.lit(None).alias("sample_count"))

            daily_dfs.append(df_pivot)
        except Exception as e:
            print(f"\n⚠️ 處理檔案失敗 {os.path.basename(fpath)}: {e}")
            continue

    if not daily_dfs:
        raise ValueError("未能解析出任何數據！")

    print("\n>>> 正在合併全時段資料...")
    df_all = pl.concat(daily_dfs, how="diagonal_relaxed")
    t1 = time.time()
    print(f"✅ 全時段 432 天數據整併完成！耗時: {t1 - t0:.1f} 秒，共取得 {len(df_all)} 列小時平均數據。")
    return df_all

# ── 3. 欄位整合與格式標準化 ──────────────────────────────────────────────
def format_and_enrich(df_all, df_sensors):
    print(">>> 正在關聯感測器資訊並排序...")
    df_sensors_pl = pl.DataFrame(df_sensors)
    df_merged = df_all.join(df_sensors_pl, on="deviceId", how="left")

    expected_cols = ["pm2_5", "pm10", "temperature", "humidity", "voc", "tvoc", "sample_count"]
    for col in expected_cols:
        if col not in df_merged.columns:
            df_merged = df_merged.with_columns(pl.lit(None).cast(pl.Float64).alias(col))

    df_sorted = df_merged.sort(["hour", "deviceId"])

    ordered_cols = [
        "hour", "deviceId", "name", "lat", "lon",
        "pm2_5", "pm10", "temperature", "humidity", "voc", "tvoc", "sample_count"
    ]
    df_final = df_sorted.select(ordered_cols)

    rename_map = {
        "hour": "觀測時間(整點)",
        "deviceId": "設備ID",
        "name": "設備名稱",
        "lat": "緯度",
        "lon": "經度",
        "pm2_5": "PM2.5(μg/m³)",
        "pm10": "PM10(μg/m³)",
        "temperature": "溫度(°C)",
        "humidity": "濕度(%)",
        "voc": "VOC(ppb)",
        "tvoc": "TVOC(ppb)",
        "sample_count": "每小時取樣筆數"
    }
    return df_final, rename_map

# ── 4. 輸出 Parquet 與 Excel (.xlsx) ──────────────────────────────────────
def export_files(df_final, rename_map):
    # 4.1 儲存 Parquet
    print(f">>> 正在輸出分析專用 Parquet: {PARQUET_OUTPUT}")
    df_final.write_parquet(PARQUET_OUTPUT, compression="zstd")
    pq_size_mb = os.path.getsize(PARQUET_OUTPUT) / (1024 * 1024)
    print(f"✅ Parquet 產出成功！檔案大小: {pq_size_mb:.2f} MB")

    # 4.2 儲存 Excel
    print(f">>> 正在產製呈報長官專業級 Excel: {EXCEL_OUTPUT}")
    df_renamed = df_final.rename(rename_map)

    sensor_stats = (
        df_renamed.group_by(["設備ID", "設備名稱", "緯度", "經度"])
        .agg([
            pl.col("觀測時間(整點)").count().alias("總觀測小時數"),
            pl.col("觀測時間(整點)").min().alias("起始時間"),
            pl.col("觀測時間(整點)").max().alias("結束時間"),
            pl.col("PM2.5(μg/m³)").mean().round(2).alias("PM2.5平均值"),
            pl.col("PM10(μg/m³)").mean().round(2).alias("PM10平均值"),
            pl.col("溫度(°C)").mean().round(2).alias("溫度平均值"),
            pl.col("濕度(%)").mean().round(2).alias("濕度平均值"),
            pl.col("VOC(ppb)").mean().round(2).alias("VOC平均值"),
            pl.col("TVOC(ppb)").mean().round(2).alias("TVOC平均值"),
        ])
        .sort("設備ID")
    )

    t0 = time.time()
    wb = xlsxwriter.Workbook(EXCEL_OUTPUT)
    header_fmt = wb.add_format({"bold": True, "bg_color": "#4F81BD", "font_color": "white", "border": 1})

    # Sheet 1: 感測器概況
    ws1 = wb.add_worksheet("感測器清單與概況")
    ws1.freeze_panes(1, 0)
    cols1 = sensor_stats.columns
    for c_idx, col_name in enumerate(cols1):
        ws1.write(0, c_idx, col_name, header_fmt)
    for r_idx, row in enumerate(sensor_stats.iter_rows()):
        ws1.write_row(r_idx + 1, 0, row)
    ws1.autofilter(0, 0, len(sensor_stats), len(cols1) - 1)
    for i, col in enumerate(cols1):
        ws1.set_column(i, i, max(len(str(col)) * 2, 14))

    # Sheet 2: 小時明細
    ws2 = wb.add_worksheet("每小時觀測數據明細")
    ws2.freeze_panes(1, 0)
    cols2 = df_renamed.columns
    for c_idx, col_name in enumerate(cols2):
        ws2.write(0, c_idx, col_name, header_fmt)
    for r_idx, row in enumerate(df_renamed.iter_rows()):
        ws2.write_row(r_idx + 1, 0, row)
    ws2.autofilter(0, 0, len(df_renamed), len(cols2) - 1)
    for i, col in enumerate(cols2):
        ws2.set_column(i, i, max(len(str(col)) * 2, 14))

    wb.close()
    xl_size_mb = os.path.getsize(EXCEL_OUTPUT) / (1024 * 1024)
    print(f"🎉 Excel 產出完畢！耗時: {time.time() - t0:.1f} 秒，檔案大小: {xl_size_mb:.2f} MB")
    print(f"\n檔案已存放於:\n- Excel: {EXCEL_OUTPUT}\n- Parquet: {PARQUET_OUTPUT}")

# ── 主執行入口 ────────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("微感測器數據整併系統：大甲幼獅工業區 Buffer 500m")
    print("=" * 60)
    df_sensors = get_target_sensors()
    target_ids = df_sensors["deviceId"].tolist()

    df_all = process_daily_files(target_ids)
    df_final, rename_map = format_and_enrich(df_all, df_sensors)
    export_files(df_final, rename_map)

if __name__ == "__main__":
    main()
