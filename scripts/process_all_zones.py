# -*- coding: utf-8 -*-
"""
全臺中 20 工業/產業園區 Buffer 500m 微型感測器長期歷史數據整併器
- 範圍：以 industrial-zones.geojson 之 20 園區 500m Buffer 空間交集出之微型感測器
- 資料來源：Dajia/原始數據/*.csv.gz (432 天)
- 產出：
  1. scripts/sensor_zone_mapping.json：感測器與所屬園區對照表
  2. output/all_zones_hourly.parquet：20 園區每小時觀測聚合資料
"""

import os
import glob
import time
import json
import pyproj
from shapely.geometry import shape, Point
from shapely.ops import transform
import polars as pl
from tqdm import tqdm

BASE_DIR = r"C:\GoogleAntigravity\2026IoTcenter"
GEOJSON_PATH = os.path.join(BASE_DIR, "dashboard", "public", "industrial-zones.geojson")
INFO_PATH = os.path.join(BASE_DIR, "iotinformation.csv")
RAW_DATA_DIR = os.path.join(BASE_DIR, "Dajia", "原始數據")
OUTPUT_DIR = os.path.join(BASE_DIR, "output")
MAPPING_PATH = os.path.join(BASE_DIR, "scripts", "sensor_zone_mapping.json")
PARQUET_OUTPUT = os.path.join(OUTPUT_DIR, "all_zones_hourly.parquet")

os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(os.path.dirname(MAPPING_PATH), exist_ok=True)

def build_sensor_zone_mapping():
    """使用 20 園區 GeoJSON 與 500m Buffer 篩選感測器"""
    print(">>> [1/4] 載入園區 GeoJSON 與建立 500m 空間緩衝區...")
    with open(GEOJSON_PATH, "r", encoding="utf-8") as f:
        geo_data = json.load(f)

    to_3826 = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:3826", always_xy=True).transform
    to_4326 = pyproj.Transformer.from_crs("EPSG:3826", "EPSG:4326", always_xy=True).transform

    zone_polys = []
    for feat in geo_data["features"]:
        name = feat["properties"]["name"]
        geom = shape(feat["geometry"])
        # 轉換為公尺座標系計算 500m buffer 再轉回 WGS84
        geom_m = transform(to_3826, geom).buffer(500)
        geom_buf = transform(to_4326, geom_m)
        zone_polys.append((name, geom_buf))

    print(f"    共載入 {len(zone_polys)} 個園區多邊形。")

    print(">>> [2/4] 比對感測器清單 (Point-in-Polygon)...")
    df_info = pl.read_csv(INFO_PATH)

    # sensor_id -> dict
    mapping = {}
    zone_count = {name: 0 for name, _ in zone_polys}

    for row in df_info.iter_rows(named=True):
        did = int(row["裝置ID"])
        p = Point(row["經度"], row["緯度"])
        matched_zones = []
        for name, poly in zone_polys:
            if poly.contains(p):
                matched_zones.append(name)
                zone_count[name] += 1

        if matched_zones:
            mapping[did] = {
                "deviceId": did,
                "name": str(row["裝置名稱"]),
                "lat": float(row["緯度"]),
                "lon": float(row["經度"]),
                "zones": matched_zones
            }

    print(f"    共篩選出 {len(mapping)} 支微型感測器分佈於 20 園區。")
    print("    各園區感測器分佈概況：")
    for name, cnt in sorted(zone_count.items(), key=lambda x: -x[1]):
        print(f"      - {name}: {cnt} 站")

    with open(MAPPING_PATH, "w", encoding="utf-8") as f:
        json.dump(mapping, f, ensure_ascii=False, indent=2)
    print(f"    已存檔快取: {MAPPING_PATH}")

    return mapping

def process_daily_files(mapping):
    """逐日讀取 432 天原始數據，篩選並聚合為每小時統計"""
    target_ids = list(mapping.keys())
    files = sorted(glob.glob(os.path.join(RAW_DATA_DIR, "*.csv.gz")))
    total_files = len(files)
    print(f">>> [3/4] 開始批次處理 {total_files} 天原始 CSV.gz 資料...")

    # 建立查找用 dataframe
    sensor_meta = []
    for did, info in mapping.items():
        for z in info["zones"]:
            sensor_meta.append({
                "deviceId": did,
                "name": info["name"],
                "zone_name": z,
                "lat": info["lat"],
                "lon": info["lon"]
            })
    df_meta = pl.DataFrame(sensor_meta)

    daily_dfs = []
    t0 = time.time()

    for idx, fpath in enumerate(tqdm(files, desc="處理進度", unit="天")):
        try:
            # 1. 讀取並過濾 deviceId
            df_day = pl.read_csv(
                fpath,
                columns=["createTime", "deviceId", "localTime", "sensorId", "value"],
                schema_overrides={"deviceId": pl.Int64, "value": pl.Float64}
            ).filter(pl.col("deviceId").is_in(target_ids))

            if df_day.height == 0:
                continue

            # 2. 截取小時 'YYYY-MM-DD HH:00'
            df_day = df_day.with_columns(
                (pl.col("localTime").str.slice(0, 13) + ":00").alias("hour")
            )

            # 3. 每小時平均值 group by (hour, deviceId, sensorId)
            hourly_agg = df_day.group_by(["hour", "deviceId", "sensorId"]).agg(
                pl.col("value").mean().round(2).alias("mean_val")
            )

            # 4. Pivot 指標至欄位 (pm2_5, voc, tvoc, temperature, humidity, pm10)
            pivoted = hourly_agg.pivot(
                values="mean_val",
                index=["hour", "deviceId"],
                on="sensorId"
            )

            daily_dfs.append(pivoted)

        except Exception as e:
            print(f"\n[警告] 處理檔案失敗 {os.path.basename(fpath)}: {e}")

    print(f">>> [4/4] 正在整併 {len(daily_dfs)} 天資料並關聯園區資訊...")
    all_df = pl.concat(daily_dfs, how="diagonal_relaxed")

    # 確保必要數值欄位存在
    available_cols = set(all_df.columns)
    exprs = []
    for col_name in ["pm2_5", "voc", "tvoc", "temperature", "humidity", "pm10"]:
        if col_name not in available_cols:
            exprs.append(pl.lit(None, dtype=pl.Float64).alias(col_name))
    if exprs:
        all_df = all_df.with_columns(exprs)

    # 關聯園區與感測器元數據 (一站若在多園區會自然展開)
    all_df = all_df.join(df_meta, on="deviceId", how="inner")

    
    # 欄位重新排列整理
    all_df = all_df.select([
        "hour",
        "zone_name",
        "deviceId",
        "name",
        "lat",
        "lon",
        "pm2_5",
        "voc",
        "tvoc",
        "temperature",
        "humidity",
        "pm10"
    ]).sort(["zone_name", "hour", "name"])

    all_df.write_parquet(PARQUET_OUTPUT, compression="zstd")
    elapsed = time.time() - t0
    fsize_mb = os.path.getsize(PARQUET_OUTPUT) / (1024 * 1024)
    print(f"=== 處理完成 ===")
    print(f"輸出路徑: {PARQUET_OUTPUT}")
    print(f"檔案大小: {fsize_mb:.2f} MB")
    print(f"資料筆數: {all_df.height} 筆每小時觀測紀錄")
    print(f"總耗時: {elapsed:.1f} 秒 ({elapsed/60:.2f} 分鐘)")

if __name__ == "__main__":
    mapping = build_sensor_zone_mapping()
    process_daily_files(mapping)
