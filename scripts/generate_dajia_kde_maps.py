# -*- coding: utf-8 -*-
"""
產製大甲幼獅工業區 PM2.5 與 VOC 空間核密度圖 (KDE Maps)
及產製報告統計 JSON 數據
"""
import os
import json
import numpy as np
import polars as pl
import shapefile
from shapely.geometry import shape
from shapely.ops import transform
import pyproj
import scipy.stats as stats
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap

# 設定字體支援
plt.rcParams['font.sans-serif'] = ['Microsoft JhengHei', 'Segoe UI', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

BASE_DIR = r"C:\GoogleAntigravity\2026IoTcenter"
PQ_PATH = os.path.join(BASE_DIR, "Dajia", "output", "dajia_buffer500_hourly_202506_202609.parquet")
SHP_PATH = os.path.join(BASE_DIR, "Dajia", "大甲幼獅工業區buffer500", "dajia_buffer500.shp")
FIGURE_DIR = os.path.join(BASE_DIR, "documents", "figures")
os.makedirs(FIGURE_DIR, exist_ok=True)

# 1. 讀取微感數據並聚合
df = pl.read_parquet(PQ_PATH)

sensor_agg = (
    df.group_by(["deviceId", "name", "lat", "lon"])
    .agg([
        pl.col("pm2_5").mean().round(2).alias("pm25_mean"),
        pl.col("pm2_5").quantile(0.95).round(2).alias("pm25_p95"),
        pl.col("voc").mean().round(2).alias("voc_mean"),
        pl.col("voc").quantile(0.95).round(2).alias("voc_p95"),
        pl.col("voc").max().round(2).alias("voc_max"),
        (pl.col("voc") >= 200).sum().alias("voc_gt200"),
        (pl.col("voc") >= 500).sum().alias("voc_gt500"),
        (pl.col("voc") >= 1000).sum().alias("voc_gt1000"),
    ])
    .sort("voc_mean", descending=True)
)

sensors_data = sensor_agg.to_dicts()

# 2. 讀取工業區 SHP 邊界 (TWD97 -> WGS84)
sf = shapefile.Reader(SHP_PATH, encoding="utf-8")
transformer = pyproj.Transformer.from_crs("EPSG:3826", "EPSG:4326", always_xy=True)
polys_wgs = []
for s in sf.shapes():
    polys_wgs.append(transform(transformer.transform, shape(s)))

# 3. 網格範圍設定
lons = [s["lon"] for s in sensors_data]
lats = [s["lat"] for s in sensors_data]
x_min, x_max = min(lons) - 0.005, max(lons) + 0.005
y_min, y_max = min(lats) - 0.005, max(lats) + 0.005

grid_x, grid_y = np.mgrid[x_min:x_max:300j, y_min:y_max:300j]
grid_coords = np.vstack([grid_x.ravel(), grid_y.ravel()])

def plot_kde(val_key, title, out_filename, cmap_name, label_unit, is_log=False):
    fig, ax = plt.subplots(figsize=(10, 8), dpi=300, facecolor="#0f172a")
    ax.set_facecolor("#0f172a")

    # 權重計算
    weights = np.array([s[val_key] for s in sensors_data])
    if is_log:
        weights = np.log1p(weights)
    
    # 空間核密度估計 (帶權重模擬濃度場)
    sample_pts = np.vstack([lons, lats])
    kde = stats.gaussian_kde(sample_pts, weights=weights, bw_method=0.25)
    z = kde(grid_coords).reshape(grid_x.shape)

    # 繪製核密度熱區平滑等高圖
    cf = ax.contourf(grid_x, grid_y, z, levels=60, cmap=cmap_name, alpha=0.85)

    # 繪製工業區邊界
    for poly in polys_wgs:
        if poly.geom_type == 'Polygon':
            x, y = poly.exterior.xy
            ax.plot(x, y, color="#f97316", linewidth=2.0, linestyle="--", label="大甲幼獅 500m Buffer 邊界" if "大甲幼獅" not in [l.get_label() for l in ax.lines] else "")
        elif poly.geom_type == 'MultiPolygon':
            for p in poly.geoms:
                x, y = p.exterior.xy
                ax.plot(x, y, color="#f97316", linewidth=2.0, linestyle="--")

    # 繪製微感測器散佈點
    scatter = ax.scatter(lons, lats, c=[s[val_key] for s in sensors_data], cmap=cmap_name,
                         edgecolors="#ffffff", linewidth=1.2, s=80, zorder=5)

    # 標註重點高值測站名稱
    top_3 = sorted(sensors_data, key=lambda s: s[val_key], reverse=True)[:5]
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

    # 坐標軸美化
    ax.tick_params(colors="#94a3b8", labelsize=9)
    ax.set_xlabel("經度 (Longitude, °E)", color="#cbd5e1", fontsize=11, fontweight="bold", labelpad=8)
    ax.set_ylabel("緯度 (Latitude, °N)", color="#cbd5e1", fontsize=11, fontweight="bold", labelpad=8)
    ax.grid(color="#334155", linestyle=":", alpha=0.6)

    # 色階條 Colorbar
    cbar = fig.colorbar(scatter, ax=ax, fraction=0.035, pad=0.04)
    cbar.set_label(label_unit, color="#cbd5e1", fontsize=10, fontweight="bold", labelpad=10)
    cbar.ax.yaxis.set_tick_params(color="#94a3b8")
    plt.setp(plt.getp(cbar.ax.axes, 'yticklabels'), color='#cbd5e1', size=9)

    # 標題
    plt.title(title, color="#f8fafc", fontsize=14, fontweight="heavy", pad=15)
    
    # 浮水印/註記
    fig.text(0.13, 0.03, "資料來源: 臺中市微型感測器監測網絡 (2025.06 - 2026.09) | PST-AI 科技執法分析系統", color="#64748b", fontsize=8)

    plt.tight_layout()
    out_path = os.path.join(FIGURE_DIR, out_filename)
    plt.savefig(out_path, dpi=300, facecolor=fig.get_facecolor(), edgecolor="none")
    plt.close()
    print(f"✅ 成功產出核密度圖: {out_path}")

# 繪製 PM2.5 空間核密度圖
plot_kde(
    val_key="pm25_mean",
    title="大甲幼獅工業區微感測器【PM2.5】空間濃度核密度估計圖 (KDE)",
    out_filename="dajia_kde_pm25.png",
    cmap_name="YlOrRd",
    label_unit="PM2.5 觀測年均值 (μg/m³)"
)

# 繪製 VOC 空間核密度圖
plot_kde(
    val_key="voc_mean",
    title="大甲幼獅工業區微感測器【VOC 異味污染物】空間核密度估計圖 (KDE)",
    out_filename="dajia_kde_voc.png",
    cmap_name="magma",
    label_unit="VOC 觀測年均濃度 (ppb)",
    is_log=True
)

# 4. 匯出供 Chart.js 繪圖的 JSON 數據檔
# 24 小時時序特徵
top_5_ids = [s["deviceId"] for s in sorted(sensors_data, key=lambda s: s["voc_mean"], reverse=True)[:5]]
df_hourly = (
    df.filter(pl.col("deviceId").is_in(top_5_ids))
    .with_columns(pl.col("hour").str.slice(11, 2).alias("h"))
    .group_by(["deviceId", "name", "h"])
    .agg(pl.col("voc").mean().round(1).alias("voc_mean"))
    .sort(["deviceId", "h"])
)

hourly_chart_data = {}
for sid in top_5_ids:
    sub = df_hourly.filter(pl.col("deviceId") == sid).sort("h")
    sname = sub["name"][0]
    hourly_chart_data[sname] = [float(v) for v in sub["voc_mean"].to_list()]

stats_json = {
    "sensors_ranking": sensors_data,
    "top5_hourly_curve": hourly_chart_data,
    "total_records": len(df),
    "sensor_count": len(sensors_data)
}

json_path = os.path.join(FIGURE_DIR, "dajia_stats_for_report.json")
with open(json_path, "w", encoding="utf-8") as f:
    json.dump(stats_json, f, ensure_ascii=False, indent=2)

print(f"✅ 統計 JSON 產出完成: {json_path}")
