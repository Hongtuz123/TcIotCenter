# -*- coding: utf-8 -*-
"""
南區五縣市 1km 內有學校之產業園區 Buffer 感測器空間篩選測試腳本
"""
import os
import shapefile
from shapely.geometry import shape, Point
from shapely.ops import transform, unary_union
import pyproj
import requests

SHP_PATH = r"C:\GoogleAntigravity\2026IoTcenter\saic\5縣市產業園區SHP\1km內有學校的產業園區buffer.shp"
CK_CODE = "7a1d3f72-315f-492a-8ee5-409da5e358ce"
COMMON_API = "https://iot.moenv.gov.tw/common_api/iot"
HEADERS = {"ck": CK_CODE, "User-Agent": "Mozilla/5.0"}

PROJECTS = {
    "嘉義市": 8,
    "嘉義縣": 6,
    "台南市": 23,
    "高雄市": 24,
    "屏東縣": 4
}

def main():
    print(">>> 正在讀取 Shapefile 並轉為 WGS84 坐標系...")
    sf = shapefile.Reader(SHP_PATH, encoding="utf-8")
    transformer = pyproj.Transformer.from_crs("EPSG:3826", "EPSG:4326", always_xy=True)

    polys = []
    for s in sf.shapes():
        geom = shape(s)
        geom_wgs = transform(transformer.transform, geom)
        polys.append(geom_wgs)

    union_poly = unary_union(polys)
    print(f"✅ 園區多邊形總數: {len(polys)}, 邊界範圍: {union_poly.bounds}")

    sess = requests.Session()
    sess.headers.update(HEADERS)

    total_matched = 0
    matched_by_county = {}

    for county, pid in PROJECTS.items():
        try:
            r = sess.get(f"{COMMON_API}/device/{pid}", timeout=10)
            devs = r.json()
            matched = []
            for d in devs:
                lat = d.get("lat")
                lon = d.get("lon")
                if lat and lon:
                    p = Point(lon, lat)
                    if union_poly.contains(p):
                        matched.append(d)
            matched_by_county[county] = matched
            total_matched += len(matched)
            print(f"📍 【{county}】: 總設備 {len(devs):4d} 台，落在園區 Buffer 內: {len(matched):3d} 台")
        except Exception as e:
            print(f"⚠️ 讀取 {county} 失敗: {e}")

    print("-" * 50)
    print(f"🎉 五縣市落在「1km內有學校之產業園區 Buffer」內的微感測器總計: {total_matched} 台")

if __name__ == "__main__":
    main()
