# -*- coding: utf-8 -*-
"""
為 2025 年五縣市微感資料工業區交集檔案補齊「鄉鎮市」與「鄰近學校」欄位 (共 15 欄)
- 輸入檔案：C:\\GoogleAntigravity\\2026IoTcenter\\saic\\小時平均值\\2025五縣市微感資料_工業區交集.xlsx
- 輸出檔案：覆蓋為完整 15 欄位標準格式
  [deviceId, deviceName, localTime, localTime+時間, 年份, 月份, 日期, 時間, pm2_5, 縣市, 工業區, 緯度, 經度, 鄉鎮市, 鄰近學校]
"""

import os
import sys
import time
import gc
import datetime
import shapefile
import openpyxl
import xlsxwriter

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)

BASE_DIR = r"C:\GoogleAntigravity\2026IoTcenter"
SAIC_DIR = os.path.join(BASE_DIR, "saic")
SHP_PATH = os.path.join(SAIC_DIR, "5縣市產業園區SHP", "距產業園區1km內含學校.shp")
EXCEL_INPUT = os.path.join(SAIC_DIR, "小時平均值", "2025五縣市微感資料_工業區交集.xlsx")
EXCEL_TEMP_OUT = os.path.join(SAIC_DIR, "小時平均值", "2025五縣市微感資料_工業區交集_temp.xlsx")


def load_park_meta():
    print(">>> [1/3] 載入產業園區 Shapefile 圖層建立 (工業區 -> 鄉鎮市, 鄰近學校) 映射字典...", flush=True)
    sf = shapefile.Reader(SHP_PATH, encoding="utf-8")
    park_map = {}
    for s, r in zip(sf.shapes(), sf.records()):
        rec = r.as_dict()
        school = (rec.get("學校名", "") or "").strip()
        county = (rec.get("縣市別", "") or "").strip()
        town = (rec.get("鄉鎮市", "") or "").strip()
        name = (rec.get("NAME", "") or "").strip()

        if school and county and town and rec.get("Join_Count", 1) > 0:
            if name not in park_map:
                park_map[name] = (town, school)

    print(f"✅ 成功載入 {len(park_map)} 個產業園區行政區與學校對照關係。", flush=True)
    return park_map


def append_columns():
    t_start = time.time()
    park_map = load_park_meta()

    print(f"\n>>> [2/3] 開啟 2025 交集活頁簿: {EXCEL_INPUT}", flush=True)
    wb_in = openpyxl.load_workbook(EXCEL_INPUT, read_only=True)
    sheet_names = wb_in.sheetnames
    print(f"工作表清單: {sheet_names}", flush=True)

    print(f"\n>>> [3/3] 初始化 15 欄位新版活頁簿: {EXCEL_TEMP_OUT}", flush=True)
    wb_out = xlsxwriter.Workbook(EXCEL_TEMP_OUT)

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
        "縣市", "工業區", "緯度", "經度",
        "鄉鎮市", "鄰近學校"
    ]

    total_rows = 0

    for s_idx, sname in enumerate(sheet_names, 1):
        t_sheet = time.time()
        print(f"\n  [{s_idx}/{len(sheet_names)}] 正在擴充工作表【{sname}】...", flush=True)
        ws_in = wb_in[sname]
        ws_out = wb_out.add_worksheet(sname)
        ws_out.freeze_panes(1, 0)

        for c_idx, h_name in enumerate(headers):
            ws_out.write(0, c_idx, h_name, header_fmt)

        sheet_cnt = 0
        for r_idx, row in enumerate(ws_in.iter_rows(values_only=True)):
            if r_idx == 0:
                continue
            sheet_cnt += 1
            row_num = sheet_cnt

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

            # 9: 縣市
            ws_out.write(row_num, 9, str(row[9]) if row[9] is not None else "", cell_fmt)

            # 10: 工業區
            park_name = str(row[10]) if row[10] is not None else ""
            ws_out.write(row_num, 10, park_name, cell_fmt)

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

            # 13: 鄉鎮市 (新增)
            meta = park_map.get(park_name, ("", ""))
            ws_out.write(row_num, 13, meta[0], cell_fmt)

            # 14: 鄰近學校 (新增)
            ws_out.write(row_num, 14, meta[1], cell_fmt)

        ws_out.autofilter(0, 0, sheet_cnt, len(headers) - 1)
        col_widths = [16, 18, 20, 20, 8, 8, 8, 8, 14, 12, 24, 14, 14, 12, 24]
        for c_idx, w in enumerate(col_widths):
            ws_out.set_column(c_idx, c_idx, w)

        total_rows += sheet_cnt
        sec_sheet = time.time() - t_sheet
        print(f"    -> 工作表【{sname}】已成功寫入 {sheet_cnt:,} 列，耗時: {sec_sheet:.1f} 秒", flush=True)
        gc.collect()

    print("\n>>> 正在進行 2025 活頁簿封裝壓縮與儲存 (請稍候)...", flush=True)
    wb_out.close()
    wb_in.close()

    # 替換原檔
    if os.path.exists(EXCEL_INPUT):
        os.remove(EXCEL_INPUT)
    os.rename(EXCEL_TEMP_OUT, EXCEL_INPUT)

    sz_mb = os.path.getsize(EXCEL_INPUT) / (1024 * 1024)
    print("=" * 70, flush=True)
    print(f"🎉 2025 年微感資料 15 欄位統一格式更新完成！", flush=True)
    print(f"總列數: {total_rows:,} 列每小時數據 (完全保留)")
    print(f"檔案大小: {sz_mb:.2f} MB")
    print(f"總耗時: {time.time() - t_start:.1f} 秒")
    print(f"完整檔案路徑: {EXCEL_INPUT}")
    print("=" * 70, flush=True)


if __name__ == "__main__":
    append_columns()
