# -*- coding: utf-8 -*-
"""
重新產製大甲幼獅工業區 PM2.5 與 VOC 空間核密度圖 (KDE Maps)
及產製符合嚴格品管 (QC) 規則的報告統計 JSON 數據
"""
import os
import json
import numpy as np
import polars as pl
import pandas as pd
import shapefile
from shapely.geometry import shape
from shapely.ops import transform
import pyproj
import scipy.stats as stats
import matplotlib.pyplot as plt

plt.rcParams['font.sans-serif'] = ['Microsoft JhengHei', 'Segoe UI', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

BASE_DIR = r"C:\GoogleAntigravity\2026IoTcenter"
PQ_PATH = os.path.join(BASE_DIR, "Dajia", "output", "dajia_buffer500_hourly_202506_202609.parquet")
SHP_PATH = os.path.join(BASE_DIR, "Dajia", "大甲幼獅工業區buffer500", "dajia_buffer500.shp")
FIGURE_DIR = os.path.join(BASE_DIR, "documents", "figures")
INFO_PATH = os.path.join(BASE_DIR, "iotinformation.csv")
os.makedirs(FIGURE_DIR, exist_ok=True)

# 1. 載入原始數據
df = pl.read_parquet(PQ_PATH)
try:
    from sensor_locations import SENSOR_LOCATION_MAP
except ImportError:
    import sys
    sys.path.append(os.path.dirname(__file__))
    from sensor_locations import SENSOR_LOCATION_MAP

# 2. 品管過濾 (QC Filtering)
# 設備層級剔除：0值比例 >= 80% 或 std == 0 (死線)
excluded_sensors = ["TC0179", "TC0915", "TC0221", "TC0414"]

# 數值層級異常值剔除：
# - VOC: 剔除 == 65535, == 29206, > 15000
# - PM2.5: 剔除 null, > 500
df_clean = (
    df.filter(~pl.col("name").is_in(excluded_sensors))
    .with_columns([
        pl.when(
            (pl.col("voc") == 65535) | 
            (pl.col("voc") == 29206) | 
            (pl.col("voc") > 15000)
        ).then(None).otherwise(pl.col("voc")).alias("voc_clean"),
        
        pl.when(
            pl.col("pm2_5") > 500
        ).then(None).otherwise(pl.col("pm2_5")).alias("pm25_clean")
    ])
)

# 3. 聚合統計 (31 台有效分析設備)
sensor_agg = (
    df_clean.group_by(["deviceId", "name", "lat", "lon"])
    .agg([
        pl.col("hour").count().alias("total_hours"),
        pl.col("voc_clean").drop_nulls().count().alias("valid_voc_hours"),
        pl.col("voc_clean").mean().round(2).alias("voc_mean"),
        pl.col("voc_clean").median().round(2).alias("voc_median"),
        pl.col("voc_clean").quantile(0.95).round(2).alias("voc_p95"),
        pl.col("voc_clean").max().round(2).alias("voc_max"),
        (pl.col("voc_clean") >= 200).sum().alias("voc_gt200"),
        (pl.col("voc_clean") >= 500).sum().alias("voc_gt500"),
        (pl.col("voc_clean") >= 1000).sum().alias("voc_gt1000"),
        pl.col("pm25_clean").drop_nulls().count().alias("valid_pm25_hours"),
        pl.col("pm25_clean").mean().round(2).alias("pm25_mean"),
        pl.col("pm25_clean").quantile(0.95).round(2).alias("pm25_p95"),
        pl.col("hour").min().alias("start_time"),
        pl.col("hour").max().alias("end_time")
    ])
    .sort("voc_mean", descending=True)
)

sensors_data = sensor_agg.to_dicts()

# 加入地址資訊與長期代表性標註
for s in sensors_data:
    s["location"] = SENSOR_LOCATION_MAP.get(s["name"], "大甲幼獅周邊")
    # 修正 TC0905 之定位標記
    if s["name"] == "TC0905":
        s["is_short_term"] = True
        s["status_note"] = "⚠️ 僅監測 135 小時 (2025/06/27~07/02)，為歷史短期突發事件"
    else:
        s["is_short_term"] = False
        s["status_note"] = "常態長期監測"

# 4. 讀取工業區 SHP 邊界 (TWD97 -> WGS84)
sf = shapefile.Reader(SHP_PATH, encoding="utf-8")
transformer = pyproj.Transformer.from_crs("EPSG:3826", "EPSG:4326", always_xy=True)
polys_wgs = []
for s in sf.shapes():
    polys_wgs.append(transform(transformer.transform, shape(s)))

# 5. 繪製 KDE 空間核密度圖
# 注意：全時序年均空間核密度應使用長期測站 (排除僅在線 135 小時的 TC0905 以免扭曲年均場)
kde_sensors = [s for s in sensors_data if s["name"] != "TC0905"]
lons = [s["lon"] for s in kde_sensors]
lats = [s["lat"] for s in kde_sensors]
x_min, x_max = min(lons) - 0.005, max(lons) + 0.005
y_min, y_max = min(lats) - 0.005, max(lats) + 0.005

grid_x, grid_y = np.mgrid[x_min:x_max:300j, y_min:y_max:300j]
grid_coords = np.vstack([grid_x.ravel(), grid_y.ravel()])

def plot_kde(val_key, title, out_filename, cmap_name, label_unit, is_log=False):
    fig, ax = plt.subplots(figsize=(10, 8), dpi=300, facecolor="#0f172a")
    ax.set_facecolor("#0f172a")

    weights = np.array([s[val_key] for s in kde_sensors])
    if is_log:
        weights = np.log1p(weights)
    
    sample_pts = np.vstack([lons, lats])
    kde = stats.gaussian_kde(sample_pts, weights=weights, bw_method=0.25)
    z = kde(grid_coords).reshape(grid_x.shape)

    cf = ax.contourf(grid_x, grid_y, z, levels=60, cmap=cmap_name, alpha=0.85)

    for poly in polys_wgs:
        if poly.geom_type == 'Polygon':
            x, y = poly.exterior.xy
            ax.plot(x, y, color="#f97316", linewidth=2.0, linestyle="--", label="大甲幼獅 500m Buffer 邊界" if "大甲幼獅" not in [l.get_label() for l in ax.lines] else "")
        elif poly.geom_type == 'MultiPolygon':
            for p in poly.geoms:
                x, y = p.exterior.xy
                ax.plot(x, y, color="#f97316", linewidth=2.0, linestyle="--")

    scatter = ax.scatter(lons, lats, c=[s[val_key] for s in kde_sensors], cmap=cmap_name,
                         edgecolors="#ffffff", linewidth=1.2, s=80, zorder=5)

    top_3 = sorted(kde_sensors, key=lambda s: s[val_key], reverse=True)[:5]
    for top in top_3:
        ax.annotate(
            f"{top['name']}\n({top[val_key]:.1f})",
            xy=(top['lon'], top['lat']),
            xytext=(top['lon'] + 0.0012, top['lat'] + 0.0008),
            color="#ffffff",
            fontsize=9,
            fontweight="bold",
            bbox=dict(boxstyle="round,pad=0.3", fc="#1e293b", ec="#f97316", lw=1.2, alpha=0.9),
            arrowprops=dict(arrowstyle="->", connectionstyle="arc3,rad=.15", color="#f97316", lw=1.5),
            zorder=10
        )

    ax.tick_params(colors="#94a3b8", labelsize=9)
    ax.set_xlabel("經度 (Longitude, °E)", color="#cbd5e1", fontsize=11, fontweight="bold", labelpad=8)
    ax.set_ylabel("緯度 (Latitude, °N)", color="#cbd5e1", fontsize=11, fontweight="bold", labelpad=8)
    ax.grid(color="#334155", linestyle=":", alpha=0.6)

    cbar = fig.colorbar(scatter, ax=ax, fraction=0.035, pad=0.04)
    cbar.set_label(label_unit, color="#cbd5e1", fontsize=10, fontweight="bold", labelpad=10)
    cbar.ax.yaxis.set_tick_params(color="#94a3b8")
    plt.setp(plt.getp(cbar.ax.axes, 'yticklabels'), color='#cbd5e1', size=9)

    plt.title(title, color="#f8fafc", fontsize=13, fontweight="heavy", pad=15)
    fig.text(0.13, 0.03, "資料來源: 臺中市微型感測器監測網 (2025.06.27 - 2026.09.01) | 品管過濾後 30 台長期有效測站", color="#64748b", fontsize=8)

    plt.tight_layout()
    out_path = os.path.join(FIGURE_DIR, out_filename)
    plt.savefig(out_path, dpi=300, facecolor=fig.get_facecolor(), edgecolor="none")
    plt.close()
    print(f"✅ 成功產出高品質品管核密度圖: {out_path}")

plot_kde(
    val_key="pm25_mean",
    title="大甲幼獅工業區微感測器【PM2.5】空間濃度核密度估計圖 (KDE · 品管後)",
    out_filename="dajia_kde_pm25.png",
    cmap_name="YlOrRd",
    label_unit="PM2.5 觀測年均值 (μg/m³)"
)

plot_kde(
    val_key="voc_mean",
    title="大甲幼獅工業區微感測器【VOC 異味污染物】空間核密度估計圖 (KDE · 品管後)",
    out_filename="dajia_kde_voc.png",
    cmap_name="magma",
    label_unit="VOC 觀測年均濃度 (ppb)",
    is_log=True
)

# 6. 計算 24 小時時序曲線 (Top 5 常態測站 + TC0905 歷史對照)
curve_sensors = ["TC1043", "TC0697", "TC1278", "TC0676", "TC0913", "TC0905"]
df_hourly = (
    df_clean.filter(pl.col("name").is_in(curve_sensors))
    .with_columns(pl.col("hour").str.slice(11, 2).alias("h"))
    .group_by(["name", "h"])
    .agg(pl.col("voc_clean").mean().round(1).alias("voc_mean"))
    .sort(["name", "h"])
)

hourly_chart_data = {}
for sname in curve_sensors:
    sub = df_hourly.filter(pl.col("name") == sname).sort("h")
    hourly_chart_data[sname] = [float(v) for v in sub["voc_mean"].to_list()]

# 7. 匯出供 Chart.js 繪圖的 JSON 數據檔
# 包含被剔除的設備清單與原因
excluded_details = [
    {"name": "TC0179", "deviceId": 11816167581, "total_hours": 146, "reason": "100.0% 讀值為 0.0，且僅在線 6 天，屬無效未連線設備"},
    {"name": "TC0915", "deviceId": 12201470934, "total_hours": 10327, "reason": "100.0% 讀值恆為 0.0 (超過 80% 門檻)，VOC 感測頭未接或損壞"},
    {"name": "TC0221", "deviceId": 11849005043, "total_hours": 10359, "reason": "94.1% 讀值為 0.0 (超過 80% 門檻)，感測器大部分時段失效"},
    {"name": "TC0414", "deviceId": 12203929073, "total_hours": 10360, "reason": "全程讀值恆定 8.0 ppb (標準差為 0.0)，屬死線異常設備"}
]

stats_json = {
    "sensors_ranking": sensors_data,
    "top5_hourly_curve": hourly_chart_data,
    "total_records": len(df),
    "total_cleaned_records": len(df_clean),
    "valid_sensor_count": len(sensors_data),
    "excluded_sensors": excluded_details,
    "date_range": "2025-06-27 00:00 至 2026-09-01 23:00 (共 432 天全時序)"
}

json_path = os.path.join(FIGURE_DIR, "dajia_stats_for_report.json")
with open(json_path, "w", encoding="utf-8") as f:
    json.dump(stats_json, f, ensure_ascii=False, indent=2)

print(f"✅ 品管統計 JSON 產出完成: {json_path}")
