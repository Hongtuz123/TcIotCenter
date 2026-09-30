# -*- coding: utf-8 -*-
"""
南區五縣市 (嘉義市、嘉義縣、台南市、高雄市、屏東縣)
「1km 內有學校之產業園區」微感 PM2.5 每日指標整併與單一 Excel 產出腳本
- 空間交集：比對 5 縣市產業園區 SHP (距產業園區1km內含學校.shp)
- 歸屬判定：若測站落在重疊區，以 Shape_Area 面積最大者為主
- 測項保留：僅保留 PM2.5 相關指標 (日平均、日最高、日最低、有效小時數)
- 輸出架構：單一 Excel 活頁簿，每個月一個 Sheet (2026-01 ~ 2026-08)
"""

import os
import time
import shapefile
from shapely.geometry import shape, Point
from shapely.ops import transform
import pyproj
import polars as pl
import xlsxwriter

BASE_DIR = r"C:\GoogleAntigravity\2026IoTcenter"
SAIC_DIR = os.path.join(BASE_DIR, "saic")
OUTPUT_DIR = os.path.join(SAIC_DIR, "output")
SHP_PATH = os.path.join(SAIC_DIR, "5縣市產業園區SHP", "距產業園區1km內含學校.shp")
PARQUET_PATH = os.path.join(OUTPUT_DIR, "south_5counties_park_school_1km_hourly_2026.parquet")
EXCEL_OUTPUT = os.path.join(OUTPUT_DIR, "南區五縣市_1km有學校產業園區_微感PM2.5每日觀測數據_2026.xlsx")


def match_sensors_spatial_attributes():
    print(">>> [1/4] 載入產業園區 Shapefile 空間圖層 (TWD97 -> WGS84)...")
    sf = shapefile.Reader(SHP_PATH, encoding="utf-8")
    transformer = pyproj.Transformer.from_crs("EPSG:3826", "EPSG:4326", always_xy=True)

    parks = []
    for s, r in zip(sf.shapes(), sf.records()):
        geom_wgs = transform(transformer.transform, shape(s))
        rec = r.as_dict()
        parks.append({
            "park_name": rec.get("NAME", "未命名園區"),
            "school_name": rec.get("學校名", ""),
            "county": rec.get("縣市別", ""),
            "town": rec.get("鄉鎮市", ""),
            "area": float(rec.get("Shape_Area", 0.0)),
            "geom": geom_wgs
        })
    print(f"✅ 成功載入 {len(parks)} 個產業園區 Buffer 多邊形。")

    print(">>> [2/4] 從 Parquet 提取五縣市感測器並進行空間交集比對...")
    df_sensors = (
        pl.scan_parquet(PARQUET_PATH)
        .select(["deviceId", "name", "lat", "lon"])
        .unique(subset=["deviceId"])
        .collect()
    )

    matched_records = []
    for row in df_sensors.iter_rows(named=True):
        p = Point(row["lon"], row["lat"])
        hits = [pk for pk in parks if pk["geom"].contains(p)]

        if hits:
            # 若落在多個園區交疊處，以面積 (Shape_Area) 最大者為主
            best_hit = max(hits, key=lambda x: x["area"])
            matched_records.append({
                "deviceId": row["deviceId"],
                "name": row["name"],
                "lat": row["lat"],
                "lon": row["lon"],
                "county": best_hit["county"],
                "town": best_hit["town"],
                "park_name": best_hit["park_name"],
                "school_name": best_hit["school_name"]
            })

    df_matched = pl.DataFrame(matched_records)
    print(f"✅ 完成空間匹配！共鎖定 {len(df_matched)} 台感測器，重疊區域已全數依最大面積園區判定唯一歸屬。")
    return df_matched


def aggregate_daily_pm25(df_matched_sensors):
    print(">>> [3/4] 讀取全量 Parquet 數據並計算每日 PM2.5 指標...")
    t0 = time.time()

    target_ids = df_matched_sensors["deviceId"].to_list()

    # 讀取並過濾小時數據，僅保留 PM2.5 有效值
    lazy_daily = (
        pl.scan_parquet(PARQUET_PATH)
        .filter(pl.col("deviceId").is_in(target_ids) & pl.col("pm2_5").is_not_null())
        .with_columns(
            pl.col("hour").str.slice(0, 10).alias("date")
        )
        .group_by(["date", "deviceId"])
        .agg([
            pl.col("pm2_5").mean().round(2).alias("pm2_5_mean"),
            pl.col("pm2_5").max().round(2).alias("pm2_5_max"),
            pl.col("pm2_5").min().round(2).alias("pm2_5_min"),
            pl.col("pm2_5").count().alias("sample_hours")
        ])
    )

    df_daily = lazy_daily.collect()
    print(f"✅ 每日指標計算完畢，耗時: {time.time() - t0:.1f} 秒，共 {len(df_daily):,} 筆設備日數據。")

    # 關聯感測器基本資料與 GIS 空間屬性
    df_joined = df_daily.join(df_matched_sensors, on="deviceId", how="inner")

    # 排序與重新命名
    df_joined = df_joined.sort(["date", "county", "town", "park_name", "deviceId"])

    rename_map = {
        "date": "日期",
        "county": "縣市",
        "town": "鄉鎮市",
        "park_name": "所屬產業園區",
        "school_name": "鄰近學校",
        "deviceId": "設備ID",
        "name": "設備名稱",
        "lat": "緯度",
        "lon": "經度",
        "pm2_5_mean": "PM2.5日平均值(μg/m³)",
        "pm2_5_max": "PM2.5日最高值(μg/m³)",
        "pm2_5_min": "PM2.5日最低值(μg/m³)",
        "sample_hours": "當日有效取樣小時數"
    }

    df_final = df_joined.select(list(rename_map.keys())).rename(rename_map)
    return df_final


def export_monthly_sheets_excel(df_final):
    print(f">>> [4/4] 產製單一 Excel 活頁簿 (按月分頁)...")
    print(f"目標路徑: {EXCEL_OUTPUT}")
    t0 = time.time()

    months = sorted(list(set([d[:7] for d in df_final["日期"].to_list()])))
    print(f"包含月份清單: {months}")

    wb = xlsxwriter.Workbook(EXCEL_OUTPUT)
    header_fmt = wb.add_format({
        "bold": True,
        "bg_color": "#203764",
        "font_color": "white",
        "border": 1,
        "align": "center",
        "valign": "vcenter"
    })
    cell_fmt = wb.add_format({"border": 1, "valign": "vcenter"})
    num_fmt = wb.add_format({"border": 1, "num_format": "0.00", "valign": "vcenter"})
    int_fmt = wb.add_format({"border": 1, "num_format": "0", "align": "center", "valign": "vcenter"})

    cols = df_final.columns
    total_written = 0

    for m_str in months:
        df_month = df_final.filter(pl.col("日期").str.starts_with(m_str))
        sheet_rows = len(df_month)
        total_written += sheet_rows
        print(f"  -> 寫入工作表【{m_str}】：共 {sheet_rows:,} 列...")

        ws = wb.add_worksheet(m_str)
        ws.freeze_panes(1, 0)

        # 寫入標題
        for c_idx, col_name in enumerate(cols):
            ws.write(0, c_idx, col_name, header_fmt)

        # 寫入資料列
        for r_idx, row in enumerate(df_month.iter_rows()):
            r_num = r_idx + 1
            for c_idx, val in enumerate(row):
                col_name = cols[c_idx]
                if col_name in ["PM2.5日平均值(μg/m³)", "PM2.5日最高值(μg/m³)", "PM2.5日最低值(μg/m³)"]:
                    ws.write(r_num, c_idx, val, num_fmt)
                elif col_name in ["當日有效取樣小時數", "設備ID"]:
                    ws.write(r_num, c_idx, val, int_fmt)
                elif col_name in ["緯度", "經度"]:
                    ws.write(r_num, c_idx, val, num_fmt)
                else:
                    ws.write(r_num, c_idx, val, cell_fmt)

        ws.autofilter(0, 0, sheet_rows, len(cols) - 1)

        # 設定欄寬
        for c_idx, col_name in enumerate(cols):
            max_w = max(len(str(col_name)) * 2, 12)
            ws.set_column(c_idx, c_idx, max_w)

    wb.close()
    sz_mb = os.path.getsize(EXCEL_OUTPUT) / (1024 * 1024)
    print("=" * 65)
    print(f"🎉 成功匯出單一整合 Excel！")
    print(f"總筆數: {total_written:,} 列")
    print(f"檔案大小: {sz_mb:.2f} MB")
    print(f"耗時: {time.time() - t0:.1f} 秒")
    print(f"完整路徑: {EXCEL_OUTPUT}")
    print("=" * 65)


def main():
    df_sensors = match_sensors_spatial_attributes()
    df_final = aggregate_daily_pm25(df_sensors)
    export_monthly_sheets_excel(df_final)


if __name__ == "__main__":
    main()
