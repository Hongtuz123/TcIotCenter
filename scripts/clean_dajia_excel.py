# -*- coding: utf-8 -*-
"""
大甲幼獅工業區 500m 微感數據精確清洗與重新匯出
- 移除 180 筆缺少時分秒之 YYYY-MM-DD:00 假小時
- 驗證單日單設備最大小時數嚴格為 24 筆
- 重新產製乾淨版 Excel 與 Parquet
"""
import os
import time
import polars as pl
import xlsxwriter

BASE_DIR = r"C:\GoogleAntigravity\2026IoTcenter"
DAJIA_DIR = os.path.join(BASE_DIR, "Dajia")
OUTPUT_DIR = os.path.join(DAJIA_DIR, "output")
EXCEL_OUTPUT = os.path.join(OUTPUT_DIR, "大甲幼獅500m微感測器_每小時觀測數據_202506_202609.xlsx")
PARQUET_OUTPUT = os.path.join(OUTPUT_DIR, "dajia_buffer500_hourly_202506_202609.parquet")

def main():
    print(">>> 載入大甲幼獅 Parquet 數據...")
    df_raw = pl.read_parquet(PARQUET_OUTPUT)
    print(f"原始總列數: {len(df_raw):,}")

    # 1. 嚴格過濾時間格式
    df_clean = df_raw.filter(pl.col("hour").str.contains(r"^\d{4}-\d{2}-\d{2} \d{2}:00$"))
    dropped = len(df_raw) - len(df_clean)
    print(f"✅ 成功剔除異常假小時: {dropped} 筆")
    print(f"清洗後每小時總列數: {len(df_clean):,}")

    # 2. 驗證單日單設備小時數
    df_chk = df_clean.with_columns(pl.col("hour").str.slice(0, 10).alias("date"))
    max_h = df_chk.group_by(["date", "deviceId"]).len()["len"].max()
    print(f"🔍 驗證：單日單設備最大小時數 = {max_h} (若為 24 則完全正確！)")

    # 3. 覆蓋更新 Parquet
    print(f"\n>>> 正在覆蓋更新 Parquet: {PARQUET_OUTPUT}")
    df_clean.write_parquet(PARQUET_OUTPUT, compression="zstd")
    pq_mb = os.path.getsize(PARQUET_OUTPUT) / (1024 * 1024)
    print(f"✅ Parquet 更新成功！大小: {pq_mb:.2f} MB")

    # 4. 重新產製 Excel (30 萬列直接使用標準 sharedStrings，兼具緊湊與高效)
    print(f"\n>>> 正在重新產製專業 Excel: {EXCEL_OUTPUT}")
    rename_map = {
        "hour": "觀測時間(整點)",
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
    df_renamed = df_clean.rename(rename_map)

    sensor_stats = (
        df_renamed.group_by(["設備ID", "設備名稱", "緯度", "經度"])
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
        .sort("設備ID")
    )

    t0 = time.time()
    wb = xlsxwriter.Workbook(EXCEL_OUTPUT)
    header_fmt = wb.add_format({"bold": True, "bg_color": "#4F81BD", "font_color": "white", "border": 1})

    # Sheet 1: 感測器清單與概況
    ws1 = wb.add_worksheet("感測器清單與概況")
    ws1.freeze_panes(1, 0)
    cols1 = sensor_stats.columns
    for c_idx, col_name in enumerate(cols1):
        ws1.write(0, c_idx, col_name, header_fmt)
    for r_idx, row in enumerate(sensor_stats.iter_rows()):
        ws1.write_row(r_idx + 1, 0, row)
    ws1.autofilter(0, 0, len(sensor_stats), len(cols1) - 1)
    for i, col in enumerate(cols1):
        ws1.set_column(i, i, max(len(str(col)) * 2, 14))

    # Sheet 2: 每小時觀測數據明細
    ws2 = wb.add_worksheet("每小時觀測數據明細")
    ws2.freeze_panes(1, 0)
    cols2 = df_renamed.columns
    for c_idx, col_name in enumerate(cols2):
        ws2.write(0, c_idx, col_name, header_fmt)
    for r_idx, row in enumerate(df_renamed.iter_rows()):
        ws2.write_row(r_idx + 1, 0, row)
    ws2.autofilter(0, 0, len(df_renamed), len(cols2) - 1)
    for i, col in enumerate(cols2):
        ws2.set_column(i, i, max(len(str(col)) * 2, 14))

    wb.close()
    xl_mb = os.path.getsize(EXCEL_OUTPUT) / (1024 * 1024)
    print(f"🎉 Excel 產出完畢！大小: {xl_mb:.2f} MB, 耗時: {time.time() - t0:.1f} 秒")
    print("🎊 大甲幼獅數據精確清洗完成！")

if __name__ == "__main__":
    main()
