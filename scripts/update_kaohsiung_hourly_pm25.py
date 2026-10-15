# -*- coding: utf-8 -*-
"""
高雄市 1km 內有學校之產業園區微感每小時 PM2.5 數據下載與更新腳本
- 目標輸出：C:\\GoogleAntigravity\\2026IoTcenter\\saic\\小時平均值\\2026高雄市微感資料.xlsx
- 規格：
  * 工作表分頁（方案 A）：
    - 2026-08: 既有 8 月份資料 (498,127 列)
    - 2026-09: 2026-09-01 ~ 2026-09-30 (完整 30 天)
    - 2026-10: 2026-10-01 ~ 2026-10-14 (14 天最新數據)
  * 嚴格對齊 15 欄位標準格式：
    [deviceId, deviceName, localdate, localTime, 年份, 月份, 日期, 時間, pm2_5, 縣市, 工業區, 緯度, 經度, 鄉鎮市, 鄰近學校]
  * 多執行緒 24 Workers 平行下載，支援斷點續傳
  * 採用 xlsxwriter constant_memory 串流寫入，保證記憶體穩定
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
SHP_PATH = os.path.join(SAIC_DIR, "5縣市產業園區SHP", "距產業園區1km內含學校.shp")
KH_RAW_DIR = os.path.join(SAIC_DIR, "高雄市")
OUTPUT_EXCEL = os.path.join(SAIC_DIR, "小時平均值", "2026高雄市微感資料.xlsx")
BACKUP_EXCEL = os.path.join(SAIC_DIR, "小時平均值", "2026高雄市微感資料_202608備份.xlsx")
PARQUET_PATH = os.path.join(SAIC_DIR, "output", "south_5counties_park_school_1km_hourly_2026.parquet")

# API 參數
CK_CODE = "7a1d3f72-315f-492a-8ee5-409da5e358ce"
COMMON_API = "https://iot.moenv.gov.tw/common_api/iot"
HEADERS = {"ck": CK_CODE, "User-Agent": "Mozilla/5.0"}
MAX_WORKERS = 32

# 更新區間：2026-09-01 至 2026-10-14
DOWNLOAD_START = "2026-09-01"
DOWNLOAD_END = "2026-10-14"

os.makedirs(KH_RAW_DIR, exist_ok=True)
os.makedirs(os.path.dirname(OUTPUT_EXCEL), exist_ok=True)


def haversine(lat1, lon1, lat2, lon2):
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def create_session():
    sess = requests.Session()
    retry = Retry(
        total=1,
        backoff_factor=0.2,
        status_forcelist=[500, 502, 503, 504],
        raise_on_status=False
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=MAX_WORKERS * 2, pool_maxsize=MAX_WORKERS * 2)
    sess.mount("https://", adapter)
    sess.mount("http://", adapter)
    sess.headers.update(HEADERS)
    return sess


def date_range(start_str, end_str):
    cur = datetime.strptime(start_str, "%Y-%m-%d")
    end_dt = datetime.strptime(end_str, "%Y-%m-%d")
    while cur <= end_dt:
        yield cur.strftime("%Y-%m-%d")
        cur += timedelta(days=1)


def is_valid_gz(path):
    if not os.path.exists(path) or os.path.getsize(path) < 100:
        return False
    try:
        with gzip.open(path, "rb") as gz:
            gz.read(64)
        return True
    except Exception:
        return False


# ── 1. 空間比對：鎖定高雄市 1km 內有學校產業園區微感測器 ──────────────────────────
def get_matched_kh_sensors():
    print(">>> [1/4] 載入產業園區 Shapefile 圖層並比對高雄市感測器...", flush=True)
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

    sess = create_session()
    r = sess.get(f"{COMMON_API}/device/24", timeout=15)
    r.raise_for_status()
    all_devices = r.json()
    print(f"    API 取得高雄市測站總數: {len(all_devices)} 台", flush=True)

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

            matched.append({
                "deviceId": int(d["id"]),
                "deviceName": d.get("name", str(d["id"])),
                "lat": float(lat),
                "lon": float(lon),
                "county": best_hit["county"],
                "town": best_hit["town"],
                "park_name": best_hit["name"],
                "school_name": best_hit["school"]
            })

    print(f"✅ 成功鎖定園區+學校微感測器: {len(matched)} 台", flush=True)
    return matched, all_devices


# ── 2. 批次下載高雄市原始資料 ─────────────────────────────────────────
def fetch_device_data(device_id, date, sess):
    url = f"{COMMON_API}/device_{device_id}_daily_{date}.csv.gz"
    try:
        r = sess.get(url, timeout=6)
        if r.status_code == 200 and len(r.content) > 50:
            if r.content[:2] == b"\x1f\x8b":
                text = gzip.decompress(r.content).decode("utf-8", errors="ignore")
            else:
                text = r.content.decode("utf-8", errors="ignore")
            if "createTime" in text:
                return pd.read_csv(io.StringIO(text))
    except Exception:
        pass
    return None


def download_single_day(date_str, devices, sess, out_gz):
    frames = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        f_to_dev = {
            executor.submit(fetch_device_data, dev.get("deviceId", dev.get("id")), date_str, sess): dev.get("deviceId", dev.get("id"))
            for dev in devices
        }
        for f in as_completed(f_to_dev):
            df = f.result()
            if df is not None and not df.empty:
                frames.append(df)

    if frames:
        merged = pd.concat(frames, ignore_index=True)
        if "createTime" in merged.columns:
            merged.sort_values(by=["createTime", "deviceId"], inplace=True)
        buf = io.BytesIO()
        with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
            merged.to_csv(gz, index=False, encoding="utf-8")
        with open(out_gz, "wb") as f:
            f.write(buf.getvalue())
        sz_mb = os.path.getsize(out_gz) / (1024 * 1024)
        return len(frames), len(merged), sz_mb
    return 0, 0, 0


def download_kaohsiung_range(start_str, end_str, devices):
    print(f"\n>>> [2/4] 開始下載高雄市原始資料 ({start_str} 至 {end_str})...", flush=True)
    sess = create_session()
    dates = list(date_range(start_str, end_str))
    pbar = tqdm(dates, desc="下載進度", dynamic_ncols=True)

    for d in pbar:
        out_file = os.path.join(KH_RAW_DIR, f"高雄市_{d}.csv.gz")
        if is_valid_gz(out_file):
            pbar.set_postfix({"日期": d, "狀態": "已存在跳過"})
            continue

        n_devs, n_rows, sz_mb = download_single_day(d, devices, sess, out_file)
        pbar.set_postfix({"日期": d, "成功設備": n_devs, "筆數": n_rows, "MB": f"{sz_mb:.1f}"})

    print("✅ 原始資料下載程序完成！", flush=True)


# ── 3. 計算小時平均值並整理成 DataFrame ──────────────────────────────────
def compute_hourly_pm25_for_month(month_prefix, matched_sensors):
    print(f"\n>>> [3/4] 正在處理月份【{month_prefix}】之每小時平均值...", flush=True)
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

    if not hourly_dfs:
        print(f"⚠️ 【{month_prefix}】無有效資料。")
        return None

    df_all_month = pl.concat(hourly_dfs, how="vertical")

    # 展開日期與時間欄位
    df_all_month = df_all_month.with_columns([
        pl.col("hour").str.slice(0, 10).alias("localdate"),
        (pl.col("hour").str.slice(11, 2) + ":00:00").alias("localTime"),
        pl.col("hour").str.slice(0, 4).cast(pl.Int32).alias("年份"),
        pl.col("hour").str.slice(5, 2).cast(pl.Int32).alias("月份"),
        pl.col("hour").str.slice(8, 2).cast(pl.Int32).alias("日期"),
        pl.col("hour").str.slice(11, 2).cast(pl.Int32).alias("時間"),
    ])

    # 空間屬性關聯
    df_merged = (
        df_all_month.join(matched_df, on="deviceId", how="inner")
        .sort(["hour", "park_name", "deviceId"])
    )

    # 欄位順序對齊標準 15 欄
    df_ordered = df_merged.select([
        "deviceId", "deviceName", "localdate", "localTime",
        "年份", "月份", "日期", "時間", "pm2_5",
        "county", "park_name", "lat", "lon", "town", "school_name"
    ]).rename({
        "county": "縣市",
        "park_name": "工業區",
        "lat": "緯度",
        "lon": "經度",
        "town": "鄉鎮市",
        "school_name": "鄰近學校"
    })

    print(f"✅ 【{month_prefix}】小時平均值計算完成！共 {len(df_ordered):,} 列觀測數據。", flush=True)
    return df_ordered


def get_august_data(matched_sensors):
    """取得 8 月份數據：優先自南區五縣市 Parquet 高速讀取，保證 100% 原始數據對齊"""
    if os.path.exists(PARQUET_PATH):
        print(">>> [4/4 準備] 從南區五縣市 Parquet 高速載入 8 月高雄市微感小時數據...", flush=True)
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

        df_merged = (
            df_aug.join(matched_df, on="deviceId", how="inner")
            .sort(["hour", "park_name", "deviceId"])
        )

        df_ordered = df_merged.select([
            "deviceId", "deviceName", "localdate", "localTime",
            "年份", "月份", "日期", "時間", "pm2_5",
            "county", "park_name", "lat", "lon", "town", "school_name"
        ]).rename({
            "county": "縣市",
            "park_name": "工業區",
            "lat": "緯度",
            "lon": "經度",
            "town": "鄉鎮市",
            "school_name": "鄰近學校"
        })
        print(f"✅ 8 月份載入成功: {len(df_ordered):,} 列", flush=True)
        return df_ordered
    else:
        print(">>> 載入 8 月份備份 Excel...", flush=True)
        df_ex = pd.read_excel(BACKUP_EXCEL)
        return pl.from_pandas(df_ex)


# ── 4. 串流寫入分頁 Excel (xlsxwriter) ───────────────────────────────────
def export_multi_sheet_excel(df_aug, df_sep, df_oct):
    print(f"\n>>> [4/4] 開始封裝多工作表 Excel: {OUTPUT_EXCEL}", flush=True)
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
    num_fmt = wb.add_format({"border": 1, "num_format": "0.00", "valign": "vcenter"})
    int_fmt = wb.add_format({"border": 1, "num_format": "0", "align": "center", "valign": "vcenter"})
    coord_fmt = wb.add_format({"border": 1, "num_format": "0.000000", "valign": "vcenter"})
    date_fmt = wb.add_format({"border": 1, "num_format": "yyyy-mm-dd", "align": "center", "valign": "vcenter"})
    time_fmt = wb.add_format({"border": 1, "num_format": "hh:mm:ss", "align": "center", "valign": "vcenter"})

    headers = [
        "deviceId", "deviceName", "localdate", "localTime",
        "年份", "月份", "日期", "時間", "pm2_5",
        "縣市", "工業區", "緯度", "經度", "鄉鎮市", "鄰近學校"
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

        ws.autofilter(0, 0, len(df_data), len(headers) - 1)
        col_widths = [16, 18, 14, 12, 8, 8, 8, 8, 12, 12, 22, 14, 14, 12, 22]
        for c_idx, w in enumerate(col_widths):
            ws.set_column(c_idx, c_idx, w)

        print(f"      -> 【{s_name}】寫入完畢，耗時: {time.time() - t_ws:.1f} 秒", flush=True)

    wb.close()
    sz_mb = os.path.getsize(OUTPUT_EXCEL) / (1024 * 1024)
    print("=" * 65, flush=True)
    print(f"🎉 高雄市每小時微感資料 Excel 更新完成！")
    print(f"檔案路徑: {OUTPUT_EXCEL}")
    print(f"檔案大小: {sz_mb:.2f} MB")
    print(f"總耗時: {time.time() - t_start:.1f} 秒")
    print("=" * 65, flush=True)


# ── 主流程 ────────────────────────────────────────────────────────────
def main():
    # 1. 取得高雄市有效感測器
    matched_sensors, all_devices = get_matched_kh_sensors()

    # 2. 下載 2026-09-01 至 2026-10-14 數據 (精準下載 692 台園區學校目標設備)
    download_kaohsiung_range(DOWNLOAD_START, DOWNLOAD_END, matched_sensors)

    # 3. 計算 9 月與 10 月小時平均值
    df_sep = compute_hourly_pm25_for_month("2026-09", matched_sensors)
    df_oct = compute_hourly_pm25_for_month("2026-10", matched_sensors)

    # 4. 讀取現有 8 月份資料
    df_aug = get_august_data(matched_sensors)

    # 5. 輸出 Excel 活頁簿 (含 2026-08, 2026-09, 2026-10 三個分頁)
    export_multi_sheet_excel(df_aug, df_sep, df_oct)


if __name__ == "__main__":
    main()
