# -*- coding: utf-8 -*-
"""
南區五縣市 (嘉義市、嘉義縣、台南市、高雄市、屏東縣)
「1km 內有學校之產業園區」微感 PM2.5 每小時觀測數據整併與單一 Excel 產出腳本
- 時間顆粒度：維持每小時一筆流水帳 (共 7,944,817 列)
- 空間交集：比對 5 縣市產業園區 SHP (距產業園區1km內含學校.shp)
- 歸屬判定：若測站落在重疊區，以 Shape_Area 面積最大者唯一歸屬
- 測項篩選：僅保留 PM2.5 每小時平均值，移除 PM10、溫濕度、VOC、TVOC 等
- 工作表分頁：
  * 因 2026-01 達 1,071,949 列突破 Excel 單表上限 (1,048,576 列)，
    1月份拆為【2026-01(01-15日)】與【2026-01(16-31日)】
  * 2026-02 ~ 2026-08 各為獨立月份 Sheet
  * 採用 constant_memory 串流寫入，確保穩定高效產出
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
EXCEL_OUTPUT = os.path.join(OUTPUT_DIR, "南區五縣市_1km有學校產業園區_每小時微感PM2.5數據_2026_cleaned.xlsx")


def match_sensors_spatial_attributes():
    print(">>> [1/3] 載入產業園區 Shapefile 空間圖層 (TWD97 -> WGS84)...")
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

    print(">>> [2/3] 從 Parquet 提取五縣市感測器並進行空間交集比對...")
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


def export_hourly_pm25_excel(df_matched_sensors):
    print(">>> [3/3] 串流寫入單一 Excel 活頁簿 (每小時 PM2.5 平均值)...")
    print(f"目標路徑: {EXCEL_OUTPUT}")
    t_start = time.time()

    # 定義工作表劃分計畫 (1月因突破百萬列限制拆分為 01-15日與 16-31日)
    sheet_plans = [
        {"sheet": "2026-01(01-15日)", "filter_type": "range", "start": "2026-01-01", "end": "2026-01-15 23:59"},
        {"sheet": "2026-01(16-31日)", "filter_type": "range", "start": "2026-01-16", "end": "2026-01-31 23:59"},
        {"sheet": "2026-02", "filter_type": "prefix", "prefix": "2026-02"},
        {"sheet": "2026-03", "filter_type": "prefix", "prefix": "2026-03"},
        {"sheet": "2026-04", "filter_type": "prefix", "prefix": "2026-04"},
        {"sheet": "2026-05", "filter_type": "prefix", "prefix": "2026-05"},
        {"sheet": "2026-06", "filter_type": "prefix", "prefix": "2026-06"},
        {"sheet": "2026-07", "filter_type": "prefix", "prefix": "2026-07"},
        {"sheet": "2026-08", "filter_type": "prefix", "prefix": "2026-08"},
    ]

    target_ids = df_matched_sensors["deviceId"].to_list()

    # 注意：不使用 constant_memory 模式，避免末尾列 flush 遺失問題
    # xlsxwriter 標準模式可穩定寫入所有資料列
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

    headers = [
        "觀測時間(整點)",
        "縣市",
        "鄉鎮市",
        "所屬產業園區",
        "鄰近學校",
        "設備ID",
        "設備名稱",
        "緯度",
        "經度",
        "PM2.5(μg/m³)"
    ]

    total_rows_all = 0

    for idx, plan in enumerate(sheet_plans, 1):
        s_name = plan["sheet"]
        t_sheet = time.time()
        print(f"  [{idx}/{len(sheet_plans)}] 正在處理工作表【{s_name}】...")

        # 讀取該區間數據
        scan = pl.scan_parquet(PARQUET_PATH).filter(
            pl.col("deviceId").is_in(target_ids)
            & pl.col("pm2_5").is_not_null()
            & (pl.col("pm2_5") <= 500)  # 移除感測器硬體故障值 (>500 μg/m³ 不合理)
        )
        if plan["filter_type"] == "range":
            scan = scan.filter(
                (pl.col("hour") >= plan["start"]) & (pl.col("hour") <= plan["end"])
            )
        else:
            scan = scan.filter(pl.col("hour").str.starts_with(plan["prefix"]))

        df_chunk = scan.select(["hour", "deviceId", "pm2_5"]).collect()

        # 關聯感測器空間資訊
        df_merged = (
            df_chunk.join(df_matched_sensors, on="deviceId", how="inner")
            .sort(["hour", "county", "town", "park_name", "deviceId"])
        )

        n_rows = len(df_merged)
        total_rows_all += n_rows
        print(f"      -> 篩選得 {n_rows:,} 列每小時數據，開始寫入 Excel...")

        ws = wb.add_worksheet(s_name)
        ws.freeze_panes(1, 0)

        # 寫入標題
        for c_idx, h_text in enumerate(headers):
            ws.write(0, c_idx, h_text, header_fmt)

        # 串流寫入資料
        # 欄位順序: hour, county, town, park_name, school_name, deviceId, name, lat, lon, pm2_5
        export_tuples = df_merged.select([
            "hour", "county", "town", "park_name", "school_name",
            "deviceId", "name", "lat", "lon", "pm2_5"
        ]).iter_rows()

        for r_idx, row in enumerate(export_tuples):
            r_num = r_idx + 1
            ws.write(r_num, 0, row[0], cell_fmt)  # hour
            ws.write(r_num, 1, row[1], cell_fmt)  # county
            ws.write(r_num, 2, row[2], cell_fmt)  # town
            ws.write(r_num, 3, row[3], cell_fmt)  # park_name
            ws.write(r_num, 4, row[4], cell_fmt)  # school_name
            ws.write(r_num, 5, row[5], int_fmt)   # deviceId
            ws.write(r_num, 6, row[6], cell_fmt)  # name
            ws.write(r_num, 7, row[7], num_fmt)   # lat
            ws.write(r_num, 8, row[8], num_fmt)   # lon
            ws.write(r_num, 9, row[9], num_fmt)   # pm2_5

        ws.autofilter(0, 0, n_rows, len(headers) - 1)

        # 設定欄寬
        col_widths = [16, 10, 10, 22, 22, 14, 18, 12, 12, 14]
        for c_idx, w in enumerate(col_widths):
            ws.set_column(c_idx, c_idx, w)

        print(f"      ✅ 工作表【{s_name}】寫入完畢，耗時: {time.time() - t_sheet:.1f} 秒")

    print(">>> 正在進行 Excel 活頁簿結構封裝與壓縮儲存 (請稍候)...")
    wb.close()
    sz_mb = os.path.getsize(EXCEL_OUTPUT) / (1024 * 1024)
    print("=" * 65)
    print(f"🎉 每小時微感 PM2.5 整合 Excel 產出成功！")
    print(f"總筆數: {total_rows_all:,} 列每小時觀測數據")
    print(f"檔案大小: {sz_mb:.2f} MB")
    print(f"總耗時: {time.time() - t_start:.1f} 秒")
    print(f"完整路徑: {EXCEL_OUTPUT}")
    print("=" * 65)


def main():
    df_sensors = match_sensors_spatial_attributes()
    export_hourly_pm25_excel(df_sensors)


if __name__ == "__main__":
    main()
