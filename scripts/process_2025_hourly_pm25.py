# -*- coding: utf-8 -*-
"""
2025 年南區五縣市微感資料與產業園區空間交集處理腳本 (增強防護版)
- 來源檔案：C:\\GoogleAntigravity\\2026IoTcenter\\saic\\小時平均值\\2025五縣市微感資料.xlsx
- 空間圖層：C:\\GoogleAntigravity\\2026IoTcenter\\saic\\5縣市產業園區SHP\\距產業園區1km內含學校.shp
- 處理原則：
  1. 欄位填補：將「縣市」填入縣市名，將「工業區」填入產業園區名稱
  2. 交集過濾：僅保留落於產業園區 1km 內之微感觀測資料，非工業區測站整列移除
  3. 重疊歸屬：若同時落於兩工業區範圍內，以距離較近之工業區（園區幾何中心點 Centroid 距離最近）為主
  4. 燕巢防護：排除無學校多邊形，重疊燕巢安招/國中者依距離兩校最近者智能歸屬
  5. 異常值防護：對於經緯度或 PM2.5 為 #N/A 或非數值之字串進行容錯保護，無效經緯度自動過濾
  6. 串流架構：單遍歷快取機制 + 即時 Flush 日誌 + 逐頁 GC 釋放記憶體
"""

import os
import sys
import gc
import time
import math
import datetime
import shapefile
from shapely.geometry import shape, Point
from shapely.ops import transform
import pyproj
import openpyxl
import xlsxwriter

# 確保輸出不被緩衝，即時寫入日誌
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)

BASE_DIR = r"C:\GoogleAntigravity\2026IoTcenter"
SAIC_DIR = os.path.join(BASE_DIR, "saic")
SHP_PATH = os.path.join(SAIC_DIR, "5縣市產業園區SHP", "距產業園區1km內含學校.shp")
EXCEL_INPUT = os.path.join(SAIC_DIR, "小時平均值", "2025五縣市微感資料.xlsx")
EXCEL_OUTPUT = os.path.join(SAIC_DIR, "小時平均值", "2025五縣市微感資料_工業區交集.xlsx")


def haversine(lat1, lon1, lat2, lon2):
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def load_parks():
    print(">>> [1/3] 載入產業園區 Shapefile 圖層 (建立 WGS84 與 TWD97 幾何索引)...", flush=True)
    sf = shapefile.Reader(SHP_PATH, encoding="utf-8")
    twd_to_wgs = pyproj.Transformer.from_crs("EPSG:3826", "EPSG:4326", always_xy=True)

    parks = []
    for s, r in zip(sf.shapes(), sf.records()):
        rec = r.as_dict()
        school = (rec.get("學校名", "") or "").strip()
        county = (rec.get("縣市別", "") or "").strip()
        town = (rec.get("鄉鎮市", "") or "").strip()

        # 排除無學校或屬性缺失之園區 (如 Join_Count == 0 之燕巢工業用地等)
        if not school or not county or not town or rec.get("Join_Count", 1) == 0:
            continue

        geom_twd = shape(s)
        geom_wgs = transform(twd_to_wgs.transform, geom_twd)

        parks.append({
            "name": rec.get("NAME", "未命名園區"),
            "school": school,
            "county": county,
            "town": town,
            "geom_wgs": geom_wgs,
            "geom_twd": geom_twd,
            "centroid_twd": geom_twd.centroid,
            "area": float(rec.get("Shape_Area", 0.0))
        })

    print(f"✅ 成功載入 {len(parks)} 個有效含學校之產業園區 Buffer 多邊形。", flush=True)
    return parks


def build_spatial_matcher(parks):
    wgs_to_twd = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:3826", always_xy=True)
    anzhao_coord = (22.790674, 120.337883)  # 市立安招國小
    yanchao_coord = (22.786062, 120.362633)  # 市立燕巢國中

    def match_point(lat, lon):
        if lat is None or lon is None:
            return None
        # 安全型別轉換，避免 #N/A 或字串報錯
        try:
            lat_f = float(lat)
            lon_f = float(lon)
        except (ValueError, TypeError):
            return None

        p_wgs = Point(lon_f, lat_f)
        hits = [pk for pk in parks if pk["geom_wgs"].contains(p_wgs)]

        if not hits:
            return None

        if len(hits) == 1:
            best = hits[0]
        else:
            # 優先檢查是否同時落在安招國小與燕巢國中重疊區
            schools = set(h["school"] for h in hits)
            if "市立安招國小" in schools and "市立燕巢國中" in schools:
                d_an = haversine(lat_f, lon_f, anzhao_coord[0], anzhao_coord[1])
                d_yan = haversine(lat_f, lon_f, yanchao_coord[0], yanchao_coord[1])
                target_school = "市立安招國小" if d_an < d_yan else "市立燕巢國中"
                best = next(h for h in hits if h["school"] == target_school)
            else:
                # 使用者指示：若同時落於兩工業區範圍內，取「距離較近」的工業區為主
                # 轉至 TWD97 計算點位到各園區幾何中心 (Centroid) 的公尺直線距離
                x_twd, y_twd = wgs_to_twd.transform(lon_f, lat_f)
                p_twd = Point(x_twd, y_twd)
                best = min(hits, key=lambda pk: p_twd.distance(pk["centroid_twd"]))

        # 若缺失屬性則移除
        if not best["county"] or not best["name"]:
            return None

        return (best["county"], best["name"])

    return match_point


def process_2025_excel():
    t_start = time.time()
    parks = load_parks()
    matcher = build_spatial_matcher(parks)

    print(f"\n>>> [2/3] 開啟 2025 來源活頁簿: {EXCEL_INPUT}", flush=True)
    wb_in = openpyxl.load_workbook(EXCEL_INPUT, read_only=True)
    sheet_names = wb_in.sheetnames
    print(f"工作表清單: {sheet_names}", flush=True)

    print(f"\n>>> [3/3] 初始化目標活頁簿: {EXCEL_OUTPUT}", flush=True)
    wb_out = xlsxwriter.Workbook(EXCEL_OUTPUT)

    header_fmt = wb_out.add_format({
        "bold": True,
        "bg_color": "#203764",
        "font_color": "white",
        "border": 1,
        "align": "center",
        "valign": "vcenter"
    })
    cell_fmt = wb_out.add_format({"border": 1, "valign": "vcenter"})
    date_fmt = wb_out.add_format({"border": 1, "num_format": "yyyy-mm-dd hh:mm:ss", "valign": "vcenter"})
    num_fmt = wb_out.add_format({"border": 1, "num_format": "0.00", "valign": "vcenter"})
    int_fmt = wb_out.add_format({"border": 1, "num_format": "0", "align": "center", "valign": "vcenter"})
    coord_fmt = wb_out.add_format({"border": 1, "num_format": "0.000000", "valign": "vcenter"})

    headers = [
        "deviceId", "deviceName", "localTime", "localTime+時間",
        "年份", "月份", "日期", "時間", "pm2_5",
        "縣市", "工業區", "緯度", "經度"
    ]

    sensor_cache = {}  # deviceId -> (county, park_name) or None
    total_in_rows = 0
    total_out_rows = 0

    for s_idx, sname in enumerate(sheet_names, 1):
        t_sheet = time.time()
        print(f"\n  [{s_idx}/{len(sheet_names)}] 正在串流處理工作表【{sname}】...", flush=True)
        ws_in = wb_in[sname]
        ws_out = wb_out.add_worksheet(sname)
        ws_out.freeze_panes(1, 0)

        # 寫入標題
        for c_idx, h_name in enumerate(headers):
            ws_out.write(0, c_idx, h_name, header_fmt)

        sheet_in_cnt = 0
        sheet_out_cnt = 0

        for r_idx, row in enumerate(ws_in.iter_rows(values_only=True)):
            if r_idx == 0:
                continue
            sheet_in_cnt += 1

            did = row[0]
            lat = row[11]
            lon = row[12]

            # 設備空間對照查詢 (帶快取)
            if did not in sensor_cache:
                sensor_cache[did] = matcher(lat, lon)

            match_info = sensor_cache[did]
            # 選項 1：未落於產業園區或經緯度無效者整列過濾移除
            if match_info is None:
                continue

            county_val, park_val = match_info
            sheet_out_cnt += 1
            row_num = sheet_out_cnt

            # 0: deviceId
            if isinstance(row[0], int):
                ws_out.write_number(row_num, 0, row[0], int_fmt)
            else:
                try:
                    ws_out.write_number(row_num, 0, int(row[0]), int_fmt)
                except (ValueError, TypeError):
                    ws_out.write(row_num, 0, str(row[0]), cell_fmt)

            # 1: deviceName
            ws_out.write(row_num, 1, str(row[1]) if row[1] is not None else "", cell_fmt)

            # 2: localTime
            if isinstance(row[2], (datetime.datetime, datetime.date)):
                ws_out.write_datetime(row_num, 2, row[2], date_fmt)
            else:
                ws_out.write(row_num, 2, str(row[2]) if row[2] is not None else "", cell_fmt)

            # 3: localTime+時間
            if isinstance(row[3], (datetime.datetime, datetime.date)):
                ws_out.write_datetime(row_num, 3, row[3], date_fmt)
            else:
                ws_out.write(row_num, 3, str(row[3]) if row[3] is not None else "", cell_fmt)

            # 4: 年份
            try:
                ws_out.write_number(row_num, 4, int(row[4]), int_fmt)
            except (ValueError, TypeError):
                ws_out.write(row_num, 4, str(row[4]) if row[4] is not None else "", cell_fmt)

            # 5: 月份
            try:
                ws_out.write_number(row_num, 5, int(row[5]), int_fmt)
            except (ValueError, TypeError):
                ws_out.write(row_num, 5, str(row[5]) if row[5] is not None else "", cell_fmt)

            # 6: 日期
            try:
                ws_out.write_number(row_num, 6, int(row[6]), int_fmt)
            except (ValueError, TypeError):
                ws_out.write(row_num, 6, str(row[6]) if row[6] is not None else "", cell_fmt)

            # 7: 時間
            try:
                ws_out.write_number(row_num, 7, int(row[7]), int_fmt)
            except (ValueError, TypeError):
                ws_out.write(row_num, 7, str(row[7]) if row[7] is not None else "", cell_fmt)

            # 8: pm2_5
            if row[8] is not None:
                try:
                    ws_out.write_number(row_num, 8, float(row[8]), num_fmt)
                except (ValueError, TypeError):
                    ws_out.write(row_num, 8, str(row[8]), cell_fmt)
            else:
                ws_out.write_blank(row_num, 8, cell_fmt)

            # 9: 縣市 (選項 A: 填入所屬縣市)
            ws_out.write(row_num, 9, county_val, cell_fmt)

            # 10: 工業區 (填入所屬產業園區名稱)
            ws_out.write(row_num, 10, park_val, cell_fmt)

            # 11: 緯度
            try:
                ws_out.write_number(row_num, 11, float(row[11]), coord_fmt)
            except (ValueError, TypeError):
                ws_out.write(row_num, 11, str(row[11]) if row[11] is not None else "", cell_fmt)

            # 12: 經度
            try:
                ws_out.write_number(row_num, 12, float(row[12]), coord_fmt)
            except (ValueError, TypeError):
                ws_out.write(row_num, 12, str(row[12]) if row[12] is not None else "", cell_fmt)

        ws_out.autofilter(0, 0, sheet_out_cnt, len(headers) - 1)
        col_widths = [16, 18, 20, 20, 8, 8, 8, 8, 14, 12, 24, 14, 14]
        for c_idx, w in enumerate(col_widths):
            ws_out.set_column(c_idx, c_idx, w)

        total_in_rows += sheet_in_cnt
        total_out_rows += sheet_out_cnt
        sec_sheet = time.time() - t_sheet
        print(f"    -> 原始: {sheet_in_cnt:,} 列 | 保留工業區: {sheet_out_cnt:,} 列 (過濾移除: {sheet_in_cnt - sheet_out_cnt:,} 列) | 耗時: {sec_sheet:.1f} 秒", flush=True)

        # 釋放記憶體
        gc.collect()

    print("\n>>> 正在進行 Excel 活頁簿封裝壓縮與儲存 (請稍候)...", flush=True)
    wb_out.close()
    sz_mb = os.path.getsize(EXCEL_OUTPUT) / (1024 * 1024)

    total_sensors = len(sensor_cache)
    matched_sensors = sum(1 for v in sensor_cache.values() if v is not None)

    print("=" * 70, flush=True)
    print(f"🎉 2025 年五縣市微感資料產業園區交集 Excel 產出成功！", flush=True)
    print(f"全表感測器總數: {total_sensors} 台 | 命中工業區感測器: {matched_sensors} 台", flush=True)
    print(f"原始總資料列數: {total_in_rows:,} 列", flush=True)
    print(f"交集保留總列數: {total_out_rows:,} 列 (移除非工業區資料: {total_in_rows - total_out_rows:,} 列)", flush=True)
    print(f"檔案大小: {sz_mb:.2f} MB", flush=True)
    print(f"總耗時: {time.time() - t_start:.1f} 秒", flush=True)
    print(f"輸出路徑: {EXCEL_OUTPUT}", flush=True)
    print("=" * 70, flush=True)


if __name__ == "__main__":
    process_2025_excel()
