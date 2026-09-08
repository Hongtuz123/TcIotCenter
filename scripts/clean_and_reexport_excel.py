# -*- coding: utf-8 -*-
"""
精確清洗與重新匯出五縣市 Excel 與 Parquet
- 移除缺少時分秒 (如 YYYY-MM-DD:00) 的異常日統計髒數據
- 重新寫入五縣市各別 Excel 與合併 Parquet
- 驗證單日單設備小時數絕對 <= 24
"""
import os
import time
import polars as pl
import xlsxwriter

OUTPUT_DIR = r"C:\GoogleAntigravity\2026IoTcenter\saic\output"
PQ_5_PATH = os.path.join(OUTPUT_DIR, "south_5counties_park_school_1km_hourly_2026.parquet")
PQ_4_PATH = os.path.join(OUTPUT_DIR, "south_4counties_park_school_1km_hourly_2026.parquet")

def export_county_excel(county, df_county):
    excel_path = os.path.join(OUTPUT_DIR, f"{county}_1km有學校產業園區_每小時微感數據_2026.xlsx")
    print(f"\n>>> 正在重新產製【{county}】精確版 Excel: {os.path.basename(excel_path)} ...")

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
    wb = xlsxwriter.Workbook(excel_path, {'constant_memory': True})
    header_fmt = wb.add_format({"bold": True, "bg_color": "#203764", "font_color": "white", "border": 1})

    # Sheet 0: 概況表
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

    # Sheet 1+: 明細表
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

def main():
    print(">>> 載入南區五縣市 Parquet 數據...")
    df_raw = pl.read_parquet(PQ_5_PATH)
    print(f"原始總列數: {len(df_raw):,}")

    # 嚴格過濾：只保留符合標準 YYYY-MM-DD HH:00 格式之每小時觀測數據
    df_clean = df_raw.filter(pl.col("hour").str.contains(r"^\d{4}-\d{2}-\d{2} \d{2}:00$"))
    dropped = len(df_raw) - len(df_clean)
    print(f"✅ 過濾剔除異常格式髒資料: {dropped:,} 筆 (例如 YYYY-MM-DD:00)")
    print(f"清洗後有效每小時總列數: {len(df_clean):,}")

    # 驗證單日單設備最大小時數
    df_chk = df_clean.with_columns(pl.col("hour").str.slice(0, 10).alias("date"))
    max_h_per_day = df_chk.group_by(["county", "date", "deviceId"]).len()["len"].max()
    print(f"🔍 驗證：單日單設備小時數最大值 = {max_h_per_day} (若為 24 則完全正確！)")

    # 重新寫回 Parquet
    print("\n>>> 正在更新存檔五縣市 Parquet...")
    df_clean.write_parquet(PQ_5_PATH, compression="zstd")
    sz_5 = os.path.getsize(PQ_5_PATH) / (1024 * 1024)
    print(f"✅ 五縣市 Parquet 更新完成: {sz_5:.2f} MB")

    df_4 = df_clean.filter(pl.col("county") != "台南市")
    df_4.write_parquet(PQ_4_PATH, compression="zstd")
    sz_4 = os.path.getsize(PQ_4_PATH) / (1024 * 1024)
    print(f"✅ 四縣市 Parquet 更新完成: {sz_4:.2f} MB")

    # 依縣市重新匯出 Excel
    for county in ["嘉義市", "嘉義縣", "台南市", "屏東縣", "高雄市"]:
        df_county = df_clean.filter(pl.col("county") == county)
        export_county_excel(county, df_county)

    print("\n🎊 五縣市 Excel 與 Parquet 精確清洗重新產出已全部大功告成！")

if __name__ == "__main__":
    main()
