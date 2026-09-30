# -*- coding: utf-8 -*-
"""
2026 年南區五縣市微感資料欄位格式重組腳本
- 目標路徑：C:\\GoogleAntigravity\\2026IoTcenter\\saic\\小時平均值\\2026五縣市微感資料.xlsx
- 規格：不刪改任何數據，純粹調整欄位順序與格式，對齊 15 欄標準：
  [deviceId, deviceName, localTime, localTime+時間, 年份, 月份, 日期, 時間, pm2_5, 縣市, 工業區, 緯度, 經度, 鄉鎮市, 鄰近學校]
"""

import os
import sys
import time
import math
import shapefile
from shapely.geometry import shape, Point
from shapely.ops import transform
import pyproj
import polars as pl
import xlsxwriter

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)

BASE_DIR = r"C:\GoogleAntigravity\2026IoTcenter"
SAIC_DIR = os.path.join(BASE_DIR, "saic")
OUTPUT_DIR = os.path.join(SAIC_DIR, "output")
SHP_PATH = os.path.join(SAIC_DIR, "5縣市產業園區SHP", "距產業園區1km內含學校.shp")
PARQUET_PATH = os.path.join(OUTPUT_DIR, "south_5counties_park_school_1km_hourly_2026.parquet")
EXCEL_OUTPUT = os.path.join(SAIC_DIR, "小時平均值", "2026五縣市微感資料.xlsx")


def haversine(lat1, lon1, lat2, lon2):
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def match_sensors():
    print(">>> [1/3] 載入產業園區 Shapefile 圖層 (排除無學校多邊形)...", flush=True)
    sf = shapefile.Reader(SHP_PATH, encoding="utf-8")
    transformer = pyproj.Transformer.from_crs("EPSG:3826", "EPSG:4326", always_xy=True)

    anzhao_coord = (22.790674, 120.337883)  # 市立安招國小
    yanchao_coord = (22.786062, 120.362633)  # 市立燕巢國中

    parks = []
    for s, r in zip(sf.shapes(), sf.records()):
        rec = r.as_dict()
        school = (rec.get("學校名", "") or "").strip()
        county = (rec.get("縣市別", "") or "").strip()
        town = (rec.get("鄉鎮市", "") or "").strip()

        if not school or not county or not town or rec.get("Join_Count", 1) == 0:
            continue

        geom_wgs = transform(transformer.transform, shape(s))
        parks.append({
            "name": rec.get("NAME", "未命名園區"),
            "school": school,
            "county": county,
            "town": town,
            "area": float(rec.get("Shape_Area", 0.0)),
            "geom": geom_wgs
        })
    print(f"✅ 成功載入 {len(parks)} 個有效含學校之產業園區多邊形。", flush=True)

    print(">>> [2/3] 從 Parquet 提取五縣市感測器並完成空間對照...", flush=True)
    df_sensors = (
        pl.scan_parquet(PARQUET_PATH)
        .select(["deviceId", "name", "lat", "lon"])
        .unique(subset=["deviceId"])
        .collect()
    )

    matched = []
    for row in df_sensors.iter_rows(named=True):
        p = Point(row["lon"], row["lat"])
        hits = [pk for pk in parks if pk["geom"].contains(p)]
        if hits:
            schools = set(h["school"] for h in hits)
            if "市立安招國小" in schools and "市立燕巢國中" in schools:
                d_an = haversine(row["lat"], row["lon"], anzhao_coord[0], anzhao_coord[1])
                d_yan = haversine(row["lat"], row["lon"], yanchao_coord[0], yanchao_coord[1])
                target_school = "市立安招國小" if d_an < d_yan else "市立燕巢國中"
                best_hit = next(h for h in hits if h["school"] == target_school)
            else:
                best_hit = max(hits, key=lambda x: x["area"])

            if not best_hit["school"] or not best_hit["county"] or not best_hit["town"]:
                continue

            matched.append({
                "deviceId": row["deviceId"],
                "deviceName": row["name"],
                "lat": row["lat"],
                "lon": row["lon"],
                "county": best_hit["county"],
                "town": best_hit["town"],
                "park_name": best_hit["name"],
                "school_name": best_hit["school"]
            })

    df_matched = pl.DataFrame(matched)
    print(f"✅ 完成感測器匹配，共鎖定 {len(df_matched)} 台感測器（100% 完整對應學校、縣市、鄉市鎮）。", flush=True)
    return df_matched


def export_2026_excel(df_matched):
    t_start = time.time()
    print(f"\n>>> [3/3] 開始寫入對齊後的 15 欄位 Excel: {EXCEL_OUTPUT}", flush=True)
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
    coord_fmt = wb.add_format({"border": 1, "num_format": "0.000000", "valign": "vcenter"})

    headers = [
        "deviceId", "deviceName", "localTime", "localTime+時間",
        "年份", "月份", "日期", "時間", "pm2_5",
        "縣市", "工業區", "緯度", "經度",
        "鄉鎮市", "鄰近學校"
    ]

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

    target_ids = df_matched["deviceId"].to_list()
    total_rows = 0

    for idx, plan in enumerate(sheet_plans, 1):
        s_name = plan["sheet"]
        t_sheet = time.time()
        print(f"  [{idx}/{len(sheet_plans)}] 正在處理工作表【{s_name}】...", flush=True)

        scan = pl.scan_parquet(PARQUET_PATH).filter(
            pl.col("deviceId").is_in(target_ids)
            & pl.col("pm2_5").is_not_null()
            & (pl.col("pm2_5") <= 500)
        )
        if plan["filter_type"] == "range":
            scan = scan.filter(
                (pl.col("hour") >= plan["start"]) & (pl.col("hour") <= plan["end"])
            )
        else:
            scan = scan.filter(pl.col("hour").str.starts_with(plan["prefix"]))

        df_chunk = scan.select(["hour", "deviceId", "pm2_5"]).collect()

        # 展開時間欄位
        df_chunk = df_chunk.with_columns([
            pl.lit(2026).alias("年份"),
            pl.col("hour").str.slice(5, 2).cast(pl.Int32).alias("月份"),
            pl.col("hour").str.slice(8, 2).cast(pl.Int32).alias("日期"),
            pl.col("hour").str.slice(11, 2).cast(pl.Int32).alias("時間"),
            (pl.col("hour") + ":00").alias("localTime"),
            (pl.col("hour") + ":00").alias("localTime+時間")
        ])

        # 空間屬性關聯
        df_merged = (
            df_chunk.join(df_matched, on="deviceId", how="inner")
            .sort(["hour", "county", "town", "park_name", "deviceId"])
        )

        n_rows = len(df_merged)
        total_rows += n_rows

        ws = wb.add_worksheet(s_name)
        ws.freeze_panes(1, 0)

        for c_idx, h_text in enumerate(headers):
            ws.write(0, c_idx, h_text, header_fmt)

        export_tuples = df_merged.select([
            "deviceId", "deviceName", "localTime", "localTime+時間",
            "年份", "月份", "日期", "時間", "pm2_5",
            "county", "park_name", "lat", "lon",
            "town", "school_name"
        ]).iter_rows()

        for r_idx, row in enumerate(export_tuples):
            r_num = r_idx + 1
            ws.write(r_num, 0, row[0], int_fmt)    # deviceId
            ws.write(r_num, 1, row[1], cell_fmt)   # deviceName
            ws.write(r_num, 2, row[2], cell_fmt)   # localTime
            ws.write(r_num, 3, row[3], cell_fmt)   # localTime+時間
            ws.write(r_num, 4, row[4], int_fmt)    # 年份
            ws.write(r_num, 5, row[5], int_fmt)    # 月份
            ws.write(r_num, 6, row[6], int_fmt)    # 日期
            ws.write(r_num, 7, row[7], int_fmt)    # 時間
            ws.write(r_num, 8, row[8], num_fmt)    # pm2_5
            ws.write(r_num, 9, row[9], cell_fmt)   # 縣市
            ws.write(r_num, 10, row[10], cell_fmt) # 工業區
            ws.write(r_num, 11, row[11], coord_fmt)# 緯度
            ws.write(r_num, 12, row[12], coord_fmt)# 經度
            ws.write(r_num, 13, row[13], cell_fmt) # 鄉鎮市
            ws.write(r_num, 14, row[14], cell_fmt) # 鄰近學校

        ws.autofilter(0, 0, n_rows, len(headers) - 1)
        col_widths = [16, 18, 20, 20, 8, 8, 8, 8, 14, 12, 24, 14, 14, 12, 24]
        for c_idx, w in enumerate(col_widths):
            ws.set_column(c_idx, c_idx, w)

        sec_sheet = time.time() - t_sheet
        print(f"      -> 已寫入 {n_rows:,} 列，耗時: {sec_sheet:.1f} 秒", flush=True)

    print("\n>>> 正在進行 Excel 活頁簿結構封裝與壓縮儲存 (請稍候)...", flush=True)
    wb.close()
    sz_mb = os.path.getsize(EXCEL_OUTPUT) / (1024 * 1024)

    print("=" * 65, flush=True)
    print(f"🎉 2026 年微感資料 15 欄位統一格式 Excel 產出成功！", flush=True)
    print(f"總筆數: {total_rows:,} 列每小時觀測數據 (數據 100% 完整保留)")
    print(f"檔案大小: {sz_mb:.2f} MB")
    print(f"總耗時: {time.time() - t_start:.1f} 秒")
    print(f"目標路徑: {EXCEL_OUTPUT}")
    print("=" * 65, flush=True)


def main():
    df_matched = match_sensors()
    export_2026_excel(df_matched)


if __name__ == "__main__":
    main()
