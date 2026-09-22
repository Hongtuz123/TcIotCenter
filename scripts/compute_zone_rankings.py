# -*- coding: utf-8 -*-
"""
全園區空氣品質統計與排名計算器
- 讀取：output/all_zones_hourly.parquet
- 產出：dashboard/public/zone_rankings.json (供前端 Highcharts 儀表板高速直讀)
"""

import os
import json
from datetime import datetime
import polars as pl
import numpy as np

BASE_DIR = r"C:\GoogleAntigravity\2026IoTcenter"
PARQUET_PATH = os.path.join(BASE_DIR, "output", "all_zones_hourly.parquet")
OUTPUT_JSON = os.path.join(BASE_DIR, "dashboard", "public", "zone_rankings.json")

def compute_rankings():
    print(">>> 正在載入 Parquet 資料集...")
    if not os.path.exists(PARQUET_PATH):
        print(f"[錯誤] 找不到 {PARQUET_PATH}，請先執行 process_all_zones.py")
        return

    df = pl.read_parquet(PARQUET_PATH)
    print(f"    成功載入 {df.height} 筆紀錄。涵蓋園區: {df['zone_name'].n_unique()} 個")

    # 整合 VOC / TVOC 為統一 odor 指標 (優先 tvoc，若無取 voc)
    df = df.with_columns(
        pl.coalesce(["tvoc", "voc"]).alias("odor_val"),
        pl.col("pm2_5").alias("pm25_val")
    )

    # 篩選標準格式時間並轉換為 datetime (過濾格式不全的少數異常值)
    df = df.with_columns(
        pl.col("hour").str.to_datetime("%Y-%m-%d %H:%M", strict=False).alias("dt")
    ).filter(pl.col("dt").is_not_null())

    # 截取月份 'YYYY-MM' 與星期/小時
    df = df.with_columns(
        pl.col("hour").str.slice(0, 7).alias("month"),
        pl.col("dt").dt.weekday().alias("weekday"), # 1=Mon, 7=Sun
        pl.col("dt").dt.hour().alias("hour_num")
    )

    # ── 超標門檻常數定義 ─────────────────────────────────────────────
    PM25_THRESHOLD = 50.4   # μg/m³ (AQI 敏感不健康上限 / 紅燈警戒)
    VOC_THRESHOLD = 500.0   # ppb (TVOC 異味警戒門檻)

    # ── 1. 園區整體摘要 (Zone Summary) ───────────────────────────────────
    print(f">>> 計算園區整體排名指標 (門檻: PM2.5>={PM25_THRESHOLD}, VOC>={VOC_THRESHOLD})...")
    zone_agg = df.group_by("zone_name").agg([
        pl.col("name").n_unique().alias("sensor_count"),
        pl.col("pm25_val").mean().round(2).alias("pm25_mean"),
        pl.col("pm25_val").quantile(0.95).round(2).alias("pm25_p95"),
        pl.col("pm25_val").max().round(2).alias("pm25_max"),
        (pl.col("pm25_val") >= PM25_THRESHOLD).sum().alias("exceed_pm25_count"),
        pl.col("odor_val").mean().round(2).alias("voc_mean"),
        pl.col("odor_val").quantile(0.95).round(2).alias("voc_p95"),
        pl.col("odor_val").max().round(2).alias("voc_max"),
        (pl.col("odor_val") >= VOC_THRESHOLD).sum().alias("exceed_voc_count"),
        pl.len().alias("total_observations")
    ])

    zone_summary_list = []
    for r in zone_agg.iter_rows(named=True):
        # 潛勢評分 (0 ~ 100)：結合超標率、P95 與均值
        tot = max(r["total_observations"], 1)
        pm25_exceed_rate = (r["exceed_pm25_count"] or 0) / tot
        voc_exceed_rate = (r["exceed_voc_count"] or 0) / tot
        
        # 簡易正規化綜合潛勢指數
        pm25_score = min(100.0, (r["pm25_mean"] or 0) * 2.5 + pm25_exceed_rate * 200)
        voc_score = min(100.0, ((r["voc_mean"] or 0) / 2.0) + voc_exceed_rate * 150)
        potency = round(pm25_score * 0.5 + voc_score * 0.5, 1)

        zone_summary_list.append({
            "zone": r["zone_name"],
            "sensor_count": r["sensor_count"],
            "pm25_mean": r["pm25_mean"],
            "pm25_p95": r["pm25_p95"],
            "pm25_max": r["pm25_max"],
            "exceed_pm25_count": r["exceed_pm25_count"],
            "voc_mean": r["voc_mean"],
            "voc_p95": r["voc_p95"],
            "voc_max": r["voc_max"],
            "exceed_voc_count": r["exceed_voc_count"],
            "potency_score": potency
        })

    # 預設按 PM2.5 均值排序
    zone_summary_list.sort(key=lambda x: (x["pm25_mean"] or 0), reverse=True)

    # ── 2. 各園區內微感器排名 (Sensor Summary) ─────────────────────────
    print(">>> 計算園區內部微感器排名...")
    sensor_agg = df.group_by(["zone_name", "deviceId", "name", "lat", "lon"]).agg([
        pl.col("pm25_val").mean().round(2).alias("pm25_mean"),
        pl.col("pm25_val").quantile(0.95).round(2).alias("pm25_p95"),
        pl.col("pm25_val").max().round(2).alias("pm25_max"),
        (pl.col("pm25_val") >= PM25_THRESHOLD).sum().alias("exceed_pm25_count"),
        pl.col("odor_val").mean().round(2).alias("voc_mean"),
        pl.col("odor_val").quantile(0.95).round(2).alias("voc_p95"),
        pl.col("odor_val").max().round(2).alias("voc_max"),
        (pl.col("odor_val") >= VOC_THRESHOLD).sum().alias("exceed_voc_count"),
        pl.len().alias("count")
    ])

    sensor_summary = {}
    for r in sensor_agg.iter_rows(named=True):
        zname = r["zone_name"]
        if zname not in sensor_summary:
            sensor_summary[zname] = []
        sensor_summary[zname].append({
            "deviceId": r["deviceId"],
            "name": r["name"],
            "lat": r["lat"],
            "lon": r["lon"],
            "pm25_mean": r["pm25_mean"],
            "pm25_p95": r["pm25_p95"],
            "pm25_max": r["pm25_max"],
            "exceed_pm25_count": r["exceed_pm25_count"],
            "voc_mean": r["voc_mean"],
            "voc_p95": r["voc_p95"],
            "voc_max": r["voc_max"],
            "exceed_voc_count": r["exceed_voc_count"],
            "count": r["count"]
        })

    # 各園區感測器依 PM2.5 均值排序
    for zname in sensor_summary:
        sensor_summary[zname].sort(key=lambda x: (x["pm25_mean"] or 0), reverse=True)

    # ── 3. 各園區月份趨勢 (Monthly Summary) ───────────────────────────
    print(">>> 計算月份趨勢與月排名...")
    month_agg = df.group_by(["zone_name", "month"]).agg([
        pl.col("pm25_val").mean().round(2).alias("pm25_mean"),
        pl.col("pm25_val").quantile(0.95).round(2).alias("pm25_p95"),
        (pl.col("pm25_val") >= PM25_THRESHOLD).sum().alias("exceed_pm25_count"),
        pl.col("odor_val").mean().round(2).alias("voc_mean"),
        pl.col("odor_val").quantile(0.95).round(2).alias("voc_p95"),
        (pl.col("odor_val") >= VOC_THRESHOLD).sum().alias("exceed_voc_count")
    ]).sort(["zone_name", "month"])

    monthly_summary = {}
    for r in month_agg.iter_rows(named=True):
        zname = r["zone_name"]
        if zname not in monthly_summary:
            monthly_summary[zname] = []
        monthly_summary[zname].append({
            "month": r["month"],
            "pm25_mean": r["pm25_mean"],
            "pm25_p95": r["pm25_p95"],
            "exceed_pm25_count": r["exceed_pm25_count"],
            "voc_mean": r["voc_mean"],
            "voc_p95": r["voc_p95"],
            "exceed_voc_count": r["exceed_voc_count"]
        })

    # ── 4. 星期 × 時段熱力矩陣 (Weekday-Hour Heatmap) ──────────────────
    print(">>> 計算星期 × 時段熱力圖 (7 × 24)...")
    heat_agg = df.group_by(["zone_name", "weekday", "hour_num"]).agg([
        pl.col("pm25_val").mean().round(2).alias("pm25_mean"),
        pl.col("odor_val").mean().round(2).alias("voc_mean")
    ])

    weekday_hour_heatmap = {}
    zones = df["zone_name"].unique().to_list()
    for z in zones:
        z_data = heat_agg.filter(pl.col("zone_name") == z)
        # 建立 7 (週一=0 到 週日=6) x 24 陣列
        pm25_matrix = [[0.0 for _ in range(24)] for _ in range(7)]
        voc_matrix = [[0.0 for _ in range(24)] for _ in range(7)]
        for r in z_data.iter_rows(named=True):
            w_idx = r["weekday"] - 1 # 1~7 -> 0~6
            h_idx = r["hour_num"]
            if 0 <= w_idx < 7 and 0 <= h_idx < 24:
                pm25_matrix[w_idx][h_idx] = r["pm25_mean"] or 0.0
                voc_matrix[w_idx][h_idx] = r["voc_mean"] or 0.0

        weekday_hour_heatmap[z] = {
            "pm25": pm25_matrix,
            "voc": voc_matrix
        }

    # ── 5. 全臺中月份排名列表 (供前端切換月份即時查看所有園區) ───────
    months = sorted(df["month"].unique().to_list())
    all_months_rankings = {}
    for m in months:
        m_df = df.filter(pl.col("month") == m).group_by("zone_name").agg([
            pl.col("pm25_val").mean().round(2).alias("pm25_mean"),
            pl.col("pm25_val").quantile(0.95).round(2).alias("pm25_p95"),
            pl.col("odor_val").mean().round(2).alias("voc_mean"),
            pl.col("odor_val").quantile(0.95).round(2).alias("voc_p95"),
            (pl.col("pm25_val") >= PM25_THRESHOLD).sum().alias("exceed_pm25_count"),
            (pl.col("odor_val") >= VOC_THRESHOLD).sum().alias("exceed_voc_count")
        ])
        m_list = []
        for r in m_df.iter_rows(named=True):
            m_list.append({
                "zone": r["zone_name"],
                "pm25_mean": r["pm25_mean"],
                "pm25_p95": r["pm25_p95"],
                "voc_mean": r["voc_mean"],
                "voc_p95": r["voc_p95"],
                "exceed_pm25_count": r["exceed_pm25_count"],
                "exceed_voc_count": r["exceed_voc_count"]
            })
        all_months_rankings[m] = m_list

    # ── 5.5 計算各園區每日指標 (Zone Daily Metrics - 供自訂日期區間使用) ──
    print(">>> 計算各園區每日數據 (Zone Daily Metrics)...")
    df_daily = df.with_columns(
        pl.col("hour").str.slice(0, 10).alias("date")
    ).filter(
        pl.col("date").str.contains(r"^\d{4}-\d{2}-\d{2}$")
    ).group_by(["zone_name", "date"]).agg([
        pl.col("pm25_val").mean().round(2).alias("pm25_mean"),
        pl.col("pm25_val").quantile(0.95).round(2).alias("pm25_p95"),
        (pl.col("pm25_val") >= PM25_THRESHOLD).sum().alias("exceed_pm25"),
        pl.col("odor_val").mean().round(2).alias("voc_mean"),
        pl.col("odor_val").quantile(0.95).round(2).alias("voc_p95"),
        (pl.col("odor_val") >= VOC_THRESHOLD).sum().alias("exceed_voc"),
        pl.len().alias("count")
    ]).sort(["zone_name", "date"])

    available_dates = sorted(df_daily["date"].unique().to_list())
    zone_daily = {}
    for r in df_daily.iter_rows(named=True):
        zname = r["zone_name"]
        if zname not in zone_daily:
            zone_daily[zname] = []
        zone_daily[zname].append({
            "d": r["date"],
            "pm": r["pm25_mean"],
            "p95": r["pm25_p95"],
            "epm": r["exceed_pm25"],
            "vm": r["voc_mean"],
            "vp95": r["voc_p95"],
            "evoc": r["exceed_voc"],
            "cnt": r["count"]
        })

    # ── 6. 整合並輸出 JSON ─────────────────────────────────────────────
    time_min = df["hour"].min()
    time_max = df["hour"].max()

    result = {
        "generated_at": datetime.now().isoformat(),
        "thresholds": {
            "pm25": PM25_THRESHOLD,
            "voc": VOC_THRESHOLD
        },
        "date_limits": {
            "min": available_dates[0],
            "max": available_dates[-1],
            "total_days": len(available_dates)
        },
        "available_dates": available_dates,
        "available_months": months,
        "zone_summary": zone_summary_list,
        "all_months_rankings": all_months_rankings,
        "zone_daily": zone_daily,
        "sensor_summary": sensor_summary,
        "monthly_summary": monthly_summary,
        "weekday_hour_heatmap": weekday_hour_heatmap
    }

    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    json_size_mb = os.path.getsize(OUTPUT_JSON) / (1024 * 1024)
    print(f"=== 計算完成 ===")
    print(f"輸出路徑: {OUTPUT_JSON}")
    print(f"檔案大小: {json_size_mb:.2f} MB")
    print(f"涵蓋日期: {len(available_dates)} 天 ({available_dates[0]} ~ {available_dates[-1]})")

if __name__ == "__main__":
    compute_rankings()
