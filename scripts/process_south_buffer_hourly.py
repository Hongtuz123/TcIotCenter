# -*- coding: utf-8 -*-
"""
南區四縣市 (嘉義市、嘉義縣、屏東縣、高雄市)
「1km 內有學校之產業園區 Buffer」微型感測器數據整併與 Excel 產製器
- 時間區間：2026-01-01 ~ 2026-08-31 (243 天)
- 輸出路徑：C:\\GoogleAntigravity\\2026IoTcenter\\saic\\output\\
- 產出：
  1. 各縣市獨立呈報 Excel (.xlsx)：內含園區名稱、首列凍結、AutoFilter、按月分頁防卡頓
  2. 四縣市全量自用分析 Parquet (.parquet)
"""

import os
import glob
import re
import time
import shapefile
from shapely.geometry import shape, Point
from shapely.ops import transform
import pyproj
import requests
import polars as pl
import xlsxwriter
from tqdm import tqdm

BASE_DIR = r"C:\GoogleAntigravity\2026IoTcenter"
SAIC_DIR = os.path.join(BASE_DIR, "saic")
SHP_PATH = os.path.join(SAIC_DIR, "5縣市產業園區SHP", "1km內有學校的產業園區buffer.shp")
OUTPUT_DIR = os.path.join(SAIC_DIR, "output")

CK_CODE = "7a1d3f72-315f-492a-8ee5-409da5e358ce"
COMMON_API = "https://iot.moenv.gov.tw/common_api/iot"
HEADERS = {"ck": CK_CODE, "User-Agent": "Mozilla/5.0"}

# 目標縣市 (南區五縣市)
TARGET_COUNTIES = {
    "嘉義市": {"id": 8, "dir_name": "嘉義市"},
    "嘉義縣": {"id": 6, "dir_name": "嘉義縣"},
    "台南市": {"id": 23, "dir_name": "台南市"},
    "高雄市": {"id": 24, "dir_name": "高雄市"},
    "屏東縣": {"id": 4, "dir_name": "屏東縣"}
}

os.makedirs(OUTPUT_DIR, exist_ok=True)

# ── 1. 空間幾何比對：鎖定園區 Buffer 內微感設備與所屬園區名稱 ─────────────
def match_sensors_in_parks():
    print(">>> 正在載入產業園區 Shapefile (TWD97 -> WGS84)...")
    sf = shapefile.Reader(SHP_PATH, encoding="utf-8")
    transformer = pyproj.Transformer.from_crs("EPSG:3826", "EPSG:4326", always_xy=True)

    parks = []
    for s, rec in zip(sf.shapes(), sf.records()):
        geom_wgs = transform(transformer.transform, shape(s))
        park_name = rec.as_dict().get("NAME", "未命名園區")
        parks.append({"name": park_name, "geom": geom_wgs})

    print(f"✅ 成功載入 {len(parks)} 個產業園區 1km Buffer 多邊形。")

    sess = requests.Session()
    sess.headers.update(HEADERS)

    county_sensors = {}
    for county, info in TARGET_COUNTIES.items():
        print(f">>> 正在比對【{county}】(Project {info['id']}) 測站空間座標...")
        try:
            r = sess.get(f"{COMMON_API}/device/{info['id']}", timeout=15)
            devs = r.json()
        except Exception as e:
            print(f"⚠️ 讀取 API 失敗: {e}，改由本地檔案取設備清單...")
            devs = []

        matched = []
        for d in devs:
            lat = d.get("lat")
            lon = d.get("lon")
            if lat and lon:
                p = Point(lon, lat)
                # 檢查是否落在任一園區多邊形內
                hit_parks = []
                for pk in parks:
                    if pk["geom"].contains(p):
                        hit_parks.append(pk["name"])
                if hit_parks:
                    matched.append({
                        "deviceId": int(d["id"]),
                        "name": str(d.get("name", d["id"])),
                        "lat": float(lat),
                        "lon": float(lon),
                        "county": county,
                        "park_name": "、".join(list(dict.fromkeys(hit_parks)))
                    })

        county_sensors[county] = matched
        print(f"✅ 【{county}】共 {len(devs)} 台設備，鎖定園區 Buffer 內微感測器: {len(matched)} 台。")

    return county_sensors

# ── 2. 獲取該縣市去重後的 243 天檔案清單 ─────────────────────────────
def get_county_daily_files(county_dir_name):
    c_dir = os.path.join(SAIC_DIR, county_dir_name)
    all_files = glob.glob(os.path.join(c_dir, "*.*"))

    # 以日期 YYYY-MM-DD 去重，若同一天有 .csv 與 .csv.gz，優先使用 .csv
    date_map = {}
    date_pattern = re.compile(r"(\d{4}-\d{2}-\d{2})")

    for fpath in all_files:
        m = date_pattern.search(os.path.basename(fpath))
        if m:
            d_str = m.group(1)
            if d_str.startswith("2026-"):  # 鎖定 2026 年
                if d_str not in date_map:
                    date_map[d_str] = fpath
                elif fpath.endswith(".csv") and date_map[d_str].endswith(".gz"):
                    date_map[d_str] = fpath  # 優先使用已解壓的 csv

    sorted_dates = sorted(date_map.keys())
    sorted_files = [date_map[d] for d in sorted_dates]
    return sorted_dates, sorted_files

# ── 3. 逐縣市進行高速串流整併 ──────────────────────────────────────────
def process_single_county(county, sensors_list):
    if not sensors_list:
        print(f"⚠️ 【{county}】無符合感測器，跳過。")
        return None

    target_ids = [s["deviceId"] for s in sensors_list]
    dir_name = TARGET_COUNTIES[county]["dir_name"]
    dates, files = get_county_daily_files(dir_name)
    print(f"\n==================================================")
    print(f"🚀 開始整併【{county}】：共 {len(target_ids)} 台測站，{len(files)} 天歷史資料")
    print(f"==================================================")

    daily_dfs = []
    t0 = time.time()

    for d_str, fpath in tqdm(zip(dates, files), total=len(files), desc=f"處理 {county}", dynamic_ncols=True):
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
            continue

    if not daily_dfs:
        print(f"⚠️ 【{county}】未能解析出有效數據。")
        return None

    df_county_all = pl.concat(daily_dfs, how="diagonal_relaxed")
    print(f"✅ 【{county}】整併完成！耗時: {time.time() - t0:.1f} 秒，取得 {len(df_county_all)} 列小時數據。")

    # 關聯感測器基本檔案與園區名稱
    df_sensors_pl = pl.DataFrame(sensors_list)
    df_merged = df_county_all.join(df_sensors_pl, on="deviceId", how="left")

    # 補齊必要欄位
    for col in ["pm2_5", "pm10", "temperature", "humidity", "voc", "tvoc", "sample_count"]:
        if col not in df_merged.columns:
            df_merged = df_merged.with_columns(pl.lit(None).cast(pl.Float64).alias(col))

    df_sorted = df_merged.sort(["hour", "deviceId"])

    # 欄位順序排列
    ordered_cols = [
        "hour", "county", "park_name", "deviceId", "name", "lat", "lon",
        "pm2_5", "pm10", "temperature", "humidity", "voc", "tvoc", "sample_count"
    ]
    df_final = df_sorted.select(ordered_cols)
    return df_final

# ── 4. 輸出該縣市的專屬 Excel 活頁簿 ──────────────────────────────────────
def export_county_excel(county, df_county, sensors_list):
    excel_path = os.path.join(OUTPUT_DIR, f"{county}_1km有學校產業園區_每小時微感數據_2026.xlsx")
    print(f">>> 正在產製【{county}】專屬 Excel: {os.path.basename(excel_path)} ...")

    rename_map = {
        "hour": "觀測時間(整點)",
        "county": "縣市",
        "park_name": "所屬產業園區(1km緩衝區)",
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
    df_export = df_county.rename(rename_map)

    # 1. 計算該縣市園區感測器統計概況 (Sheet 0)
    sensor_stats = (
        df_export.group_by(["縣市", "所屬產業園區(1km緩衝區)", "設備ID", "設備名稱", "緯度", "經度"])
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
        .sort(["所屬產業園區(1km緩衝區)", "設備ID"])
    )

    t0 = time.time()
    wb = xlsxwriter.Workbook(excel_path)
    header_fmt = wb.add_format({"bold": True, "bg_color": "#203764", "font_color": "white", "border": 1})

    # 寫入 Sheet 0: 概況表
    ws0 = wb.add_worksheet("園區感測器清單與概況")
    ws0.freeze_panes(1, 0)
    cols0 = sensor_stats.columns
    for c_idx, col_name in enumerate(cols0):
        ws0.write(0, c_idx, col_name, header_fmt)
    for r_idx, row in enumerate(sensor_stats.iter_rows()):
        ws0.write_row(r_idx + 1, 0, row)
    ws0.autofilter(0, 0, len(sensor_stats), len(cols0) - 1)
    for i, col in enumerate(cols0):
        ws0.set_column(i, i, max(len(str(col)) * 2, 14))

    # 2. 寫入明細表：
    # 若為嘉義市 (約 11 萬列)，直接放在一個工作表；若是其他縣市 (> 50 萬列)，按月份拆成工作表防當機
    if county == "嘉義市":
        ws_detail = wb.add_worksheet("每小時觀測明細")
        ws_detail.freeze_panes(1, 0)
        cols_det = df_export.columns
        for c_idx, col_name in enumerate(cols_det):
            ws_detail.write(0, c_idx, col_name, header_fmt)
        for r_idx, row in enumerate(df_export.iter_rows()):
            ws_detail.write_row(r_idx + 1, 0, row)
        ws_detail.autofilter(0, 0, len(df_export), len(cols_det) - 1)
        for i, col in enumerate(cols_det):
            ws_detail.set_column(i, i, max(len(str(col)) * 2, 14))
    else:
        # 按月份拆分工作表 (例如 2026-01 ~ 2026-08)
        months = sorted(list(set([h[:7] for h in df_county["hour"] if len(h) >= 7])))
        cols_det = df_export.columns

        for m_str in months:
            df_month = df_export.filter(pl.col("觀測時間(整點)").str.starts_with(m_str))
            ws_m = wb.add_worksheet(m_str)
            ws_m.freeze_panes(1, 0)
            for c_idx, col_name in enumerate(cols_det):
                ws_m.write(0, c_idx, col_name, header_fmt)
            for r_idx, row in enumerate(df_month.iter_rows()):
                ws_m.write_row(r_idx + 1, 0, row)
            ws_m.autofilter(0, 0, len(df_month), len(cols_det) - 1)
            for i, col in enumerate(cols_det):
                ws_m.set_column(i, i, max(len(str(col)) * 2, 14))

    wb.close()
    sz_mb = os.path.getsize(excel_path) / (1024 * 1024)
    print(f"🎉 【{county}】Excel 產出成功！大小: {sz_mb:.2f} MB, 耗時: {time.time() - t0:.1f} 秒")

# ── 主執行入口 ────────────────────────────────────────────────────────
def main():
    print("=" * 65)
    print("南臺灣五縣市：1km 內有學校產業園區微感數據批次整併與產出")
    print("範圍：嘉義市、嘉義縣、台南市、高雄市、屏東縣")
    print(f"輸出目標：{OUTPUT_DIR}")
    print("=" * 65)

    county_sensors = match_sensors_in_parks()

    newly_processed_dfs = []

    for county, sensors in county_sensors.items():
        excel_path = os.path.join(OUTPUT_DIR, f"{county}_1km有學校產業園區_每小時微感數據_2026.xlsx")
        if os.path.exists(excel_path):
            print(f"⏩ 【{county}】專屬 Excel 已存在 ({os.path.basename(excel_path)})，跳過重複運算。")
            continue

        print(f"\n🚀 開始處理【{county}】數據...")
        df_county = process_single_county(county, sensors)
        if df_county is not None:
            newly_processed_dfs.append(df_county)
            export_county_excel(county, df_county, sensors)

    # 合併產出五縣市全量自用分析 Parquet
    pq_4_path = os.path.join(OUTPUT_DIR, "south_4counties_park_school_1km_hourly_2026.parquet")
    pq_5_path = os.path.join(OUTPUT_DIR, "south_5counties_park_school_1km_hourly_2026.parquet")

    dfs_to_combine = []
    if os.path.exists(pq_4_path):
        print(f"\n>>> 載入既有四縣市 Parquet: {os.path.basename(pq_4_path)}...")
        dfs_to_combine.append(pl.read_parquet(pq_4_path))

    dfs_to_combine.extend(newly_processed_dfs)

    if dfs_to_combine:
        print("\n>>> 正在產製南區五縣市全量自用分析 Parquet...")
        df_total = pl.concat(dfs_to_combine, how="diagonal_relaxed")
        df_total.write_parquet(pq_5_path, compression="zstd")
        sz_mb = os.path.getsize(pq_5_path) / (1024 * 1024)
        print(f"🎉 五縣市全量 Parquet 產出完畢！總列數: {len(df_total):,} 列, 大小: {sz_mb:.2f} MB")
        print(f"Parquet 路徑: {pq_5_path}")

    print("\n🎊 本階段所有工作已全數圓滿完成！")

if __name__ == "__main__":
    main()

