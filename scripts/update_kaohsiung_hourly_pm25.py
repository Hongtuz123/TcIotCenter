# -*- coding: utf-8 -*-
"""
高雄市 1km 內有學校之產業園區微感每小時 PM2.5 與氣象風場數據整併腳本
- 目標輸出：C:\\GoogleAntigravity\\2026IoTcenter\\saic\\小時平均值\\2026高雄市微感資料.xlsx
- 規格：
  * 工作表分頁（方案 A）：
    - 2026-08: 8 月份數據 (498,127 列)
    - 2026-09: 9 月份數據 (453,837 列)
    - 2026-10: 10 月份數據 (217,848 列)
  * 嚴格對齊 18 欄位標準格式：
    [deviceId, deviceName, localdate, localTime, 年份, 月份, 日期, 時間, pm2_5,
     縣市, 工業區, 緯度, 經度, 鄉鎮市, 鄰近學校, 氣象測站, 風速, 風向]
  * 氣象測站來源：環境部國家空氣品質監測站 (AQI 標準站 12 站)
  * 風速 (m/s)、風向 (度)：以經緯度自動計算最近鄰測站，並依小時精確關聯
"""

import os
import sys
import io
import gzip
import time
import math
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import shapefile
import pyproj
from shapely.geometry import shape, Point
from shapely.ops import transform
import pandas as pd
import polars as pl
import xlsxwriter
from tqdm import tqdm

# 路徑常數
BASE_DIR = r"C:\GoogleAntigravity\2026IoTcenter"
SAIC_DIR = os.path.join(BASE_DIR, "saic")
OUTPUT_DIR = os.path.join(SAIC_DIR, "output")
SHP_PATH = os.path.join(SAIC_DIR, "5縣市產業園區SHP", "距產業園區1km內含學校.shp")
KH_RAW_DIR = os.path.join(SAIC_DIR, "高雄市")
OUTPUT_EXCEL = os.path.join(SAIC_DIR, "小時平均值", "2026高雄市微感資料.xlsx")
PARQUET_PATH = os.path.join(OUTPUT_DIR, "south_5counties_park_school_1km_hourly_2026.parquet")
WIND_CACHE_PARQUET = os.path.join(OUTPUT_DIR, "moenv_kaohsiung_wind_hourly_2026.parquet")

# API 參數
CK_CODE = "7a1d3f72-315f-492a-8ee5-409da5e358ce"
COMMON_API = "https://iot.moenv.gov.tw/common_api/iot"
MOENV_API_KEY = "37d1e1d0-10b6-4c18-9b57-de2931c69db3"
HEADERS = {"ck": CK_CODE, "User-Agent": "Mozilla/5.0"}
MAX_WORKERS = 32

DOWNLOAD_START = "2026-09-01"
DOWNLOAD_END = "2026-10-14"

# 環境部高雄市 12 個法定標準測站精確座標 (WGS84)
MOENV_STATIONS = {
    "美濃": (22.883583, 120.530542),
    "橋頭": (22.757506, 120.305689),
    "仁武": (22.689056, 120.332631),
    "鳳山": (22.628126, 120.357422),
    "大寮": (22.564136, 120.425311),
    "林園": (22.479500, 120.411750),
    "楠梓": (22.733667, 120.328289),
    "左營": (22.674861, 120.292917),
    "前金": (22.633903, 120.286761),
    "前鎮": (22.604451, 120.308334),
    "小港": (22.565833, 120.337736),
    "復興": (22.608711, 120.312017),
}


def haversine(lat1, lon1, lat2, lon2):
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def find_nearest_station(lat, lon):
    best_st = None
    min_dist = float("inf")
    for st_name, (st_lat, st_lon) in MOENV_STATIONS.items():
        d = haversine(lat, lon, st_lat, st_lon)
        if d < min_dist:
            min_dist = d
            best_st = st_name
    return best_st


# ── 1. 空間比對：鎖定高雄市微感測器與最近氣象測站 ──────────────────────────
def get_matched_kh_sensors():
    print(">>> [1/5] 載入產業園區圖層，並以經緯度計算最近之環境部官方氣象測站...", flush=True)
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

    sess = requests.Session()
    sess.headers.update(HEADERS)
    r = sess.get(f"{COMMON_API}/device/24", timeout=15)
    r.raise_for_status()
    all_devices = r.json()

    matched = []
    for d in all_devices:
        lat, lon = d.get("lat"), d.get("lon")
        if not lat or not lon:
            continue
        p = Point(float(lon), float(lat))
        hits = [pk for pk in parks if pk["geom"].contains(p)]
        if hits:
            schools = set(h["school"] for h in hits)
            if "市立安招國小" in schools and "市立燕巢國中" in schools:
                d_an = haversine(float(lat), float(lon), anzhao_coord[0], anzhao_coord[1])
                d_yan = haversine(float(lat), float(lon), yanchao_coord[0], yanchao_coord[1])
                target_school = "市立安招國小" if d_an < d_yan else "市立燕巢國中"
                best_hit = next(h for h in hits if h["school"] == target_school)
            else:
                best_hit = max(hits, key=lambda x: x["area"])

            # 以座標計算最近的環境部官方測站
            nearest_station = find_nearest_station(float(lat), float(lon))

            matched.append({
                "deviceId": int(d["id"]),
                "deviceName": d.get("name", str(d["id"])),
                "lat": float(lat),
                "lon": float(lon),
                "county": best_hit["county"],
                "town": best_hit["town"],
                "park_name": best_hit["name"],
                "school_name": best_hit["school"],
                "氣象測站": nearest_station
            })

    print(f"✅ 成功鎖定園區微感測器: {len(matched)} 台，已全數精準對應至最近氣象測站。", flush=True)
    return matched, all_devices


# ── 2. 載入或自動下載環境部風速風向時序資料庫 ─────────────────────────────
def load_moenv_wind_dataset():
    print(">>> [2/5] 載入環境部 12 測站歷史每小時風速風向資料庫...", flush=True)
    if not os.path.exists(WIND_CACHE_PARQUET):
        from scripts.fetch_moenv_wind_data import download_moenv_wind
        download_moenv_wind()

    df_wind = pl.read_parquet(WIND_CACHE_PARQUET)
    # 將缺失值平滑補齊 (forward/backward fill)
    df_wind = (
        df_wind.sort(["sitename", "datacreationdate"])
        .with_columns([
            pl.col("windspeed").forward_fill().backward_fill().over("sitename"),
            pl.col("winddirec").forward_fill().backward_fill().over("sitename")
        ])
        .rename({
            "sitename": "氣象測站",
            "datacreationdate": "hour",
            "windspeed": "風速",
            "winddirec": "風向"
        })
        .select(["氣象測站", "hour", "風速", "風向"])
    )
    print(f"✅ 氣象風場載入完成！筆數: {len(df_wind):,} 筆 (時間範圍: {df_wind['hour'].min()} ~ {df_wind['hour'].max()})", flush=True)
    return df_wind


# ── 3. 計算小時平均值並關聯氣象站風速風向 ────────────────────────────────
def compute_hourly_pm25_for_month(month_prefix, matched_sensors, df_wind):
    print(f"\n>>> [3/5] 正在處理月份【{month_prefix}】之 PM2.5 小時平均與風場關聯...", flush=True)
    matched_df = pl.DataFrame(matched_sensors)
    target_ids = set(s["deviceId"] for s in matched_sensors)

    gz_files = sorted([
        os.path.join(KH_RAW_DIR, f)
        for f in os.listdir(KH_RAW_DIR)
        if f.startswith(f"高雄市_{month_prefix}") and f.endswith(".csv.gz")
    ])

    if not gz_files:
        print(f"⚠️ 找不到【{month_prefix}】之下載檔案！", flush=True)
        return None

    hourly_dfs = []
    for fpath in tqdm(gz_files, desc=f"計算 {month_prefix} 小時平均", dynamic_ncols=True):
        try:
            lazy = (
                pl.scan_csv(fpath)
                .filter(
                    (pl.col("sensorId") == "pm2_5")
                    & pl.col("deviceId").is_in(list(target_ids))
                    & pl.col("localTime").str.contains(r"^\d{4}-\d{2}-\d{2} \d{2}:")
                    & (pl.col("value") >= 0)
                    & (pl.col("value") <= 500)
                )
                .with_columns(
                    (pl.col("localTime").str.slice(0, 13) + ":00").alias("hour")
                )
                .group_by(["hour", "deviceId"])
                .agg(
                    pl.col("value").mean().round(2).alias("pm2_5")
                )
            )
            df_day = lazy.collect()
            if not df_day.is_empty():
                hourly_dfs.append(df_day)
        except Exception as e:
            print(f"⚠️ 解析檔案出錯 {os.path.basename(fpath)}: {e}")

    df_all_month = pl.concat(hourly_dfs, how="vertical")

    df_all_month = df_all_month.with_columns([
        pl.col("hour").str.slice(0, 10).alias("localdate"),
        (pl.col("hour").str.slice(11, 2) + ":00:00").alias("localTime"),
        pl.col("hour").str.slice(0, 4).cast(pl.Int32).alias("年份"),
        pl.col("hour").str.slice(5, 2).cast(pl.Int32).alias("月份"),
        pl.col("hour").str.slice(8, 2).cast(pl.Int32).alias("日期"),
        pl.col("hour").str.slice(11, 2).cast(pl.Int32).alias("時間"),
    ])

    # 關聯微感測器空間屬性 (含最近氣象測站名稱)
    df_merged = df_all_month.join(matched_df, on="deviceId", how="inner")

    # 關聯氣象測站當下小時之風速與風向 (Left Join on 氣象測站 + hour)
    df_with_wind = df_merged.join(df_wind, on=["氣象測站", "hour"], how="left")

    df_ordered = df_with_wind.sort(["hour", "park_name", "deviceId"]).select([
        "deviceId", "deviceName", "localdate", "localTime",
        "年份", "月份", "日期", "時間", "pm2_5",
        "county", "park_name", "lat", "lon", "town", "school_name",
        "氣象測站", "風速", "風向"
    ]).rename({
        "county": "縣市",
        "park_name": "工業區",
        "lat": "緯度",
        "lon": "經度",
        "town": "鄉鎮市",
        "school_name": "鄰近學校"
    })

    print(f"✅ 【{month_prefix}】完成！共 {len(df_ordered):,} 列 (已補齊氣象測站、風速、風向)。", flush=True)
    return df_ordered


def get_august_data_with_wind(matched_sensors, df_wind):
    """取得 8 月份數據並關聯氣象測站風速風向"""
    print(">>> [4/5] 載入 8 月份高雄微感小時數據並關聯風場...", flush=True)
    matched_df = pl.DataFrame(matched_sensors)
    target_ids = set(s["deviceId"] for s in matched_sensors)

    df_aug = (
        pl.scan_parquet(PARQUET_PATH)
        .filter(
            (pl.col("county") == "高雄市")
            & pl.col("hour").str.starts_with("2026-08")
            & pl.col("deviceId").is_in(list(target_ids))
            & pl.col("pm2_5").is_not_null()
        )
        .select(["hour", "deviceId", "pm2_5"])
        .collect()
    )

    df_aug = df_aug.with_columns([
        pl.col("hour").str.slice(0, 10).alias("localdate"),
        (pl.col("hour").str.slice(11, 2) + ":00:00").alias("localTime"),
        pl.lit(2026).cast(pl.Int32).alias("年份"),
        pl.lit(8).cast(pl.Int32).alias("月份"),
        pl.col("hour").str.slice(8, 2).cast(pl.Int32).alias("日期"),
        pl.col("hour").str.slice(11, 2).cast(pl.Int32).alias("時間"),
    ])

    df_merged = df_aug.join(matched_df, on="deviceId", how="inner")
    df_with_wind = df_merged.join(df_wind, on=["氣象測站", "hour"], how="left")

    df_ordered = df_with_wind.sort(["hour", "park_name", "deviceId"]).select([
        "deviceId", "deviceName", "localdate", "localTime",
        "年份", "月份", "日期", "時間", "pm2_5",
        "county", "park_name", "lat", "lon", "town", "school_name",
        "氣象測站", "風速", "風向"
    ]).rename({
        "county": "縣市",
        "park_name": "工業區",
        "lat": "緯度",
        "lon": "經度",
        "town": "鄉鎮市",
        "school_name": "鄰近學校"
    })
    print(f"✅ 8 月份完成！共 {len(df_ordered):,} 列 (已補齊氣象測站、風速、風向)。", flush=True)
    return df_ordered


# ── 4. 串流寫入分頁 Excel (xlsxwriter 18 欄) ─────────────────────────────
def export_multi_sheet_excel(df_aug, df_sep, df_oct):
    print(f"\n>>> [5/5] 開始封裝含 18 欄位之多工作表 Excel: {OUTPUT_EXCEL}", flush=True)
    t_start = time.time()

    wb = xlsxwriter.Workbook(OUTPUT_EXCEL, {"constant_memory": True})

    # 樣式定義
    header_fmt = wb.add_format({
        "bold": True,
        "bg_color": "#203764",
        "font_color": "white",
        "border": 1,
        "align": "center",
        "valign": "vcenter"
    })
    cell_fmt = wb.add_format({"border": 1, "valign": "vcenter"})
    center_fmt = wb.add_format({"border": 1, "align": "center", "valign": "vcenter"})
    num_fmt = wb.add_format({"border": 1, "num_format": "0.00", "valign": "vcenter"})
    wind_spd_fmt = wb.add_format({"border": 1, "num_format": "0.0", "align": "right", "valign": "vcenter"})
    wind_dir_fmt = wb.add_format({"border": 1, "num_format": "0.0", "align": "right", "valign": "vcenter"})
    int_fmt = wb.add_format({"border": 1, "num_format": "0", "align": "center", "valign": "vcenter"})
    coord_fmt = wb.add_format({"border": 1, "num_format": "0.000000", "valign": "vcenter"})
    date_fmt = wb.add_format({"border": 1, "num_format": "yyyy-mm-dd", "align": "center", "valign": "vcenter"})
    time_fmt = wb.add_format({"border": 1, "num_format": "hh:mm:ss", "align": "center", "valign": "vcenter"})

    headers = [
        "deviceId", "deviceName", "localdate", "localTime",
        "年份", "月份", "日期", "時間", "pm2_5",
        "縣市", "工業區", "緯度", "經度", "鄉鎮市", "鄰近學校",
        "氣象測站", "風速", "風向"
    ]

    sheets_to_write = [
        ("2026-08", df_aug),
        ("2026-09", df_sep),
        ("2026-10", df_oct)
    ]

    for s_name, df_data in sheets_to_write:
        if df_data is None or len(df_data) == 0:
            print(f"⏩ 工作表【{s_name}】無資料，跳過。")
            continue

        print(f"  正在寫入工作表【{s_name}】({len(df_data):,} 列)...", flush=True)
        t_ws = time.time()
        ws = wb.add_worksheet(s_name)
        ws.freeze_panes(1, 0)

        # 寫入表頭
        for c_idx, h_text in enumerate(headers):
            ws.write(0, c_idx, h_text, header_fmt)

        # 串流寫入列資料
        rows_iter = df_data.iter_rows()
        for r_idx, row in enumerate(rows_iter):
            r_num = r_idx + 1
            ws.write(r_num, 0, row[0], int_fmt)     # deviceId
            ws.write(r_num, 1, str(row[1]), cell_fmt) # deviceName
            ws.write(r_num, 2, str(row[2]), date_fmt) # localdate
            ws.write(r_num, 3, str(row[3]), time_fmt) # localTime
            ws.write(r_num, 4, int(row[4]), int_fmt)  # 年份
            ws.write(r_num, 5, int(row[5]), int_fmt)  # 月份
            ws.write(r_num, 6, int(row[6]), int_fmt)  # 日期
            ws.write(r_num, 7, int(row[7]), int_fmt)  # 時間
            ws.write(r_num, 8, float(row[8]) if row[8] is not None else 0.0, num_fmt) # pm2_5
            ws.write(r_num, 9, str(row[9]), cell_fmt)  # 縣市
            ws.write(r_num, 10, str(row[10]), cell_fmt)# 工業區
            ws.write(r_num, 11, float(row[11]), coord_fmt) # 緯度
            ws.write(r_num, 12, float(row[12]), coord_fmt) # 經度
            ws.write(r_num, 13, str(row[13]), cell_fmt)# 鄉鎮市
            ws.write(r_num, 14, str(row[14]), cell_fmt)# 鄰近學校
            ws.write(r_num, 15, str(row[15]) if row[15] is not None else "", center_fmt) # 氣象測站
            ws.write(r_num, 16, float(row[16]) if row[16] is not None else "", wind_spd_fmt) # 風速
            ws.write(r_num, 17, float(row[17]) if row[17] is not None else "", wind_dir_fmt) # 風向

        ws.autofilter(0, 0, len(df_data), len(headers) - 1)
        # 設定各欄合適寬度
        col_widths = [16, 18, 14, 12, 8, 8, 8, 8, 12, 12, 22, 14, 14, 12, 22, 14, 10, 10]
        for c_idx, w in enumerate(col_widths):
            ws.set_column(c_idx, c_idx, w)

        print(f"      -> 【{s_name}】寫入完畢，耗時: {time.time() - t_ws:.1f} 秒", flush=True)

    wb.close()
    sz_mb = os.path.getsize(OUTPUT_EXCEL) / (1024 * 1024)
    print("=" * 65, flush=True)
    print(f"🎉 高雄市每小時微感+氣象風場 Excel 更新完成！")
    print(f"檔案路徑: {OUTPUT_EXCEL}")
    print(f"檔案大小: {sz_mb:.2f} MB")
    print(f"總耗時: {time.time() - t_start:.1f} 秒")
    print("=" * 65, flush=True)


# ── 主流程 ────────────────────────────────────────────────────────────
def main():
    # 1. 取得高雄市有效感測器並計算最近氣象測站
    matched_sensors, all_devices = get_matched_kh_sensors()

    # 2. 載入環境部風速風向歷史時序
    df_wind = load_moenv_wind_dataset()

    # 3. 計算 9 月與 10 月小時平均值並關聯風場
    df_sep = compute_hourly_pm25_for_month("2026-09", matched_sensors, df_wind)
    df_oct = compute_hourly_pm25_for_month("2026-10", matched_sensors, df_wind)

    # 4. 取得 8 月份數據並關聯風場
    df_aug = get_august_data_with_wind(matched_sensors, df_wind)

    # 5. 輸出 Excel 活頁簿 (含 2026-08, 2026-09, 2026-10 三個分頁)
    export_multi_sheet_excel(df_aug, df_sep, df_oct)


if __name__ == "__main__":
    main()
