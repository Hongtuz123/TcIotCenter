# -*- coding: utf-8 -*-
"""
將整併後的 Parquet 數據轉換為呈報長官的專業級 Excel (.xlsx)
- 來源：dajia_buffer500_hourly_202506_202609.parquet (304,772 列)
- 目標：大甲幼獅500m微感測器_每小時觀測數據_202506_202609.xlsx
- 特色：雙工作表、凍結首列、自動篩選、小數格式化
"""

import os
import time
import pandas as pd
import polars as pl

OUTPUT_DIR = r"C:\GoogleAntigravity\2026IoTcenter\Dajia\output"
PARQUET_PATH = os.path.join(OUTPUT_DIR, "dajia_buffer500_hourly_202506_202609.parquet")
EXCEL_OUTPUT = os.path.join(OUTPUT_DIR, "大甲幼獅500m微感測器_每小時觀測數據_202506_202609.xlsx")

def export_excel():
    print(f">>> 讀取 Parquet: {PARQUET_PATH}")
    t0 = time.time()
    df_pl = pl.read_parquet(PARQUET_PATH)
    print(f"✅ 成功讀取 {len(df_pl)} 列資料，耗時: {time.time() - t0:.2f} 秒")

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

    df_export = df_pl.rename(rename_map).to_pandas()

    print(">>> 正在計算感測器統計概況 (Sheet 1)...")
    sensor_stats = df_export.groupby(["設備ID", "設備名稱", "緯度", "經度"]).agg(
        總觀測小時數=("觀測時間(整點)", "count"),
        起始時間=("觀測時間(整點)", "min"),
        結束時間=("觀測時間(整點)", "max"),
        PM25平均值=("PM2.5(μg/m³)", "mean"),
        PM10平均值=("PM10(μg/m³)", "mean"),
        溫度平均值=("溫度(°C)", "mean"),
        濕度平均值=("濕度(%)", "mean"),
        VOC平均值=("VOC(ppb)", "mean"),
        TVOC平均值=("TVOC(ppb)", "mean")
    ).reset_index()

    for col in ["PM25平均值", "PM10平均值", "溫度平均值", "濕度平均值", "VOC平均值", "TVOC平均值"]:
        sensor_stats[col] = sensor_stats[col].round(2)

    print(f">>> 正在寫入 Excel 檔案: {EXCEL_OUTPUT} (總共 {len(df_export)} 列，請稍候)...")
    t1 = time.time()

    with pd.ExcelWriter(EXCEL_OUTPUT, engine="xlsxwriter", engine_kwargs={"options": {"constant_memory": True}}) as writer:
        # Sheet 1: 感測器概況
        sensor_stats.to_excel(writer, sheet_name="感測器清單與概況", index=False)
        # Sheet 2: 小時明細
        df_export.to_excel(writer, sheet_name="每小時觀測數據明細", index=False)

        sheet1 = writer.sheets["感測器清單與概況"]
        sheet2 = writer.sheets["每小時觀測數據明細"]

        # 凍結首列與設定自動篩選
        sheet1.freeze_panes(1, 0)
        sheet1.autofilter(0, 0, len(sensor_stats), len(sensor_stats.columns) - 1)

        sheet2.freeze_panes(1, 0)
        sheet2.autofilter(0, 0, len(df_export), len(df_export.columns) - 1)

        # 設定欄寬
        for i, col in enumerate(sensor_stats.columns):
            sheet1.set_column(i, i, max(len(str(col)) * 2, 12))
        for i, col in enumerate(df_export.columns):
            sheet2.set_column(i, i, max(len(str(col)) * 2, 14))

    t2 = time.time()
    size_mb = os.path.getsize(EXCEL_OUTPUT) / (1024 * 1024)
    print(f"🎉 Excel 產出完畢！耗時: {t2 - t1:.1f} 秒，檔案大小: {size_mb:.2f} MB")
    print(f"檔案路徑: {EXCEL_OUTPUT}")

if __name__ == "__main__":
    export_excel()
