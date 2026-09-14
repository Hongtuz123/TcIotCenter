"""
產製大甲幼獅 31 台微感測器空間分佈與三大劃設警戒熱區「白色系、無浮水印、高清路名比對圖」
使用內政部國土測繪中心 (NLSC) 臺灣通用電子地圖官方白底圖磚拼接，標示完整繁體中文路名與門牌地標，
疊加三大警戒熱區多邊形、500m 緩衝邊界與重點測站標籤。
"""
import os
import math
import json
import urllib.request
import numpy as np
import matplotlib
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.patches import Polygon
import matplotlib.patheffects as pe
from PIL import Image

matplotlib.rcParams['font.sans-serif'] = ['Microsoft JhengHei', 'SimHei', 'sans-serif']
matplotlib.rcParams['axes.unicode_minus'] = False

def deg2num(lat_deg, lon_deg, zoom):
    lat_rad = math.radians(lat_deg)
    n = 2.0 ** zoom
    xtile = int((lon_deg + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return xtile, ytile

def num2deg(xtile, ytile, zoom):
    n = 2.0 ** zoom
    lon_deg = xtile / n * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1 - 2 * ytile / n)))
    lat_deg = math.degrees(lat_rad)
    return lat_deg, lon_deg

def generate_white_hotspot_map():
    base_dir = r"C:\GoogleAntigravity\2026IoTcenter"
    figures_dir = os.path.join(base_dir, "documents", "figures")
    stats_path = os.path.join(figures_dir, "dajia_stats_for_report.json")
    boundary_path = os.path.join(figures_dir, "dajia_boundary_leaflet.json")
    hotspots_path = os.path.join(figures_dir, "dajia_hotspots_zones.json")
    output_png = os.path.join(figures_dir, "dajia_hotspots_white_map.png")

    with open(stats_path, "r", encoding="utf-8") as f:
        stats_data = json.load(f)
    with open(boundary_path, "r", encoding="utf-8") as f:
        boundary_latlngs = json.load(f)
    with open(hotspots_path, "r", encoding="utf-8") as f:
        hotzones = json.load(f)

    # 涵蓋大甲幼獅的經緯度範圍 (精準對焦於幼獅工業區與周邊道路，南側延伸以容納東南震央)
    min_lat, max_lat = 24.388, 24.422
    min_lon, max_lon = 120.630, 120.666
    zoom = 15

    x_min, y_min = deg2num(max_lat, min_lon, zoom)
    x_max, y_max = deg2num(min_lat, max_lon, zoom)

    x_start = min(x_min, x_max)
    x_end = max(x_min, x_max)
    y_start = min(y_min, y_max)
    y_end = max(y_min, y_max)

    tiles_x = x_end - x_start + 1
    tiles_y = y_end - y_start + 1
    tile_size = 256
    merged_img = Image.new('RGB', (tiles_x * tile_size, tiles_y * tile_size), (255, 255, 255))

    cache_dir = os.path.join(figures_dir, "tiles_cache")
    os.makedirs(cache_dir, exist_ok=True)

    print(f"下載內政部國土測繪中心 (NLSC) 臺灣通用電子地圖：Zoom={zoom}, X:{x_start}~{x_end}, Y:{y_start}~{y_end} (共 {tiles_x * tiles_y} 張)...")
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0'}

    for xi, x in enumerate(range(x_start, x_end + 1)):
        for yi, y in enumerate(range(y_start, y_end + 1)):
            tile_file = os.path.join(cache_dir, f"nlsc_{zoom}_{x}_{y}.png")
            if not os.path.exists(tile_file):
                url = f"https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{zoom}/{y}/{x}"
                try:
                    req = urllib.request.Request(url, headers=headers)
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        with open(tile_file, "wb") as tf:
                            tf.write(resp.read())
                except Exception as e:
                    print(f"下載失敗 {url}: {e}")

            if os.path.exists(tile_file):
                try:
                    t_img = Image.open(tile_file).convert('RGB')
                    merged_img.paste(t_img, (xi * tile_size, yi * tile_size))
                except Exception as e:
                    print(f"貼圖失敗 {tile_file}: {e}")

    # 計算整體拼接地圖的經緯度範圍 (Extent)
    top_lat, left_lon = num2deg(x_start, y_start, zoom)
    bot_lat, right_lon = num2deg(x_end + 1, y_end + 1, zoom)

    # 建立 Matplotlib 高清繪圖 (300 DPI)
    fig, ax = plt.subplots(figsize=(15, 11), dpi=300)
    ax.imshow(merged_img, extent=[left_lon, right_lon, bot_lat, top_lat], aspect='equal')

    # 1. 繪製 500m 緩衝區邊界 (橘色虛線)
    if boundary_latlngs:
        b_lons = [pt[1] for pt in boundary_latlngs]
        b_lats = [pt[0] for pt in boundary_latlngs]
        ax.plot(b_lons, b_lats, color='#ea580c', linestyle='--', linewidth=2.4, label='工業區 500m 緩衝邊界')
        boundary_poly = Polygon(list(zip(b_lons, b_lats)), closed=True, facecolor='#ea580c', alpha=0.03, edgecolor=None)
        ax.add_patch(boundary_poly)

    # 2. 繪製三大可疑劃設熱區多邊形
    zone_colors = {
        'zone1': {'border': '#dc2626', 'fill': '#ef4444', 'name': '熱區一：東南側生活圈交界 (日南車站/幸福里 · 第一優先)'},
        'zone2': {'border': '#ea580c', 'fill': '#f97316', 'name': '熱區二：核心製程群聚區 (幼四路/幼五路)'},
        'zone3': {'border': '#ca8a04', 'fill': '#eab308', 'name': '熱區三：西北順帆路／長壽路界址'}
    }

    for zid, z in hotzones.items():
        z_poly_coords = z['polygon']
        p_lons = [pt[1] for pt in z_poly_coords]
        p_lats = [pt[0] for pt in z_poly_coords]
        
        cfg = zone_colors.get(zid, {'border': z['color'], 'fill': z['color'], 'name': z['name']})
        poly_patch = Polygon(
            list(zip(p_lons, p_lats)), closed=True, 
            facecolor=cfg['fill'], alpha=0.20, 
            edgecolor=cfg['border'], linewidth=2.8, 
            linestyle='-' if zid == 'zone1' else '--'
        )
        ax.add_patch(poly_patch)
        
        # 標註熱區中心文字 (白底膠囊標籤)
        c_lat, c_lon = z['center']
        ax.text(c_lon, c_lat, f"【{cfg['name'].split('：')[1].split('(')[0].strip()}】", 
                ha='center', va='center', fontsize=10, fontweight='bold', color='#0f172a',
                bbox=dict(boxstyle='round,pad=0.35', facecolor='#ffffff', edgecolor=cfg['border'], alpha=0.95, linewidth=1.4))

    # 3. 繪製 31 台微感測器 Marker
    sensors = stats_data['sensors_ranking']
    for s in sensors:
        lat = s['lat']
        lon = s['lon']
        voc = s['voc_mean']
        is_short = s.get('is_short_term', False)
        name = s['name']
        
        # 依濃度分色
        if is_short:
            m_color = '#eab308' # 短期突發
        elif voc >= 1000:
            m_color = '#dc2626' # 極高度常態 (TC1043, TC0697)
        elif voc >= 500:
            m_color = '#ea580c' # 高度疑慮
        else:
            m_color = '#0284c7' # 常態背景
            
        size = 120 if voc >= 1000 else (85 if voc >= 500 else 60)
        ax.scatter(lon, lat, s=size, color=m_color, edgecolors='#ffffff', linewidth=1.8, zorder=5)
        
        # 前 10 名重點測站加上測站編號標籤 (白色描邊光暈)
        if voc >= 450 or name in ['TC1043', 'TC0697', 'TC1278', 'TC0913', 'TC0875', 'TC0676']:
            offset_y = -0.0007 if name in ['TC1043', 'TC0697'] else 0.0003
            ax.text(lon + 0.0008, lat + offset_y, f"{name}\n({int(voc)} ppb)", 
                    fontsize=8.5, fontweight='bold', color='#0f172a', zorder=6,
                    path_effects=[pe.withStroke(linewidth=3, foreground="white")])

    # 設定經緯度顯示範圍 (鎖定在大甲幼獅主要工作面)
    ax.set_xlim(min_lon, max_lon)
    ax.set_ylim(min_lat, max_lat)
    
    # 隱藏外圍刻度軸，保持地圖版面純淨專業
    ax.set_xticks([])
    ax.set_yticks([])

    # 圖名與說明
    ax.set_title("大甲幼獅工業區 31 臺微型感測器空間分佈與三大稽查警戒熱區定位圖\n(底圖來源：內政部國土測繪中心 NLSC 臺灣通用電子地圖 · 白色系零浮水印 · 完整標示各路段路名與生活圈)", 
                 fontsize=12.5, fontweight='bold', pad=14, color='#1e3a8a')

    # 自訂圖例
    from matplotlib.lines import Line2D
    from matplotlib.patches import Patch
    legend_elements = [
        Line2D([0], [0], color='#ea580c', linestyle='--', linewidth=2.2, label='工業區 500m 緩衝邊界'),
        Patch(facecolor='#ef4444', edgecolor='#dc2626', alpha=0.3, label='熱區一：東南生活圈 (日南車站/幸福里 · 第一優先)'),
        Patch(facecolor='#f97316', edgecolor='#ea580c', alpha=0.3, label='熱區二：核心製程群聚區 (幼四路/幼五路)'),
        Patch(facecolor='#eab308', edgecolor='#ca8a04', alpha=0.3, label='熱區三：西北順帆路／長壽路界址'),
        Line2D([0], [0], marker='o', color='w', markerfacecolor='#dc2626', markersize=9, label='極高濃度熱點測站 (>=1,000 ppb)'),
        Line2D([0], [0], marker='o', color='w', markerfacecolor='#ea580c', markersize=8, label='重度警戒測站 (500~1,000 ppb)'),
        Line2D([0], [0], marker='o', color='w', markerfacecolor='#0284c7', markersize=7, label='常態監測測站 (<500 ppb)')
    ]
    ax.legend(handles=legend_elements, loc='lower left', frameon=True, facecolor='#ffffff', edgecolor='#cbd5e1', framealpha=0.96, fontsize=9)

    plt.tight_layout()
    plt.savefig(output_png, bbox_inches='tight')
    plt.close()
    print(f"✅ 白色系無浮水印熱區路名地圖生成成功：{output_png}")
    return output_png

if __name__ == '__main__':
    generate_white_hotspot_map()
