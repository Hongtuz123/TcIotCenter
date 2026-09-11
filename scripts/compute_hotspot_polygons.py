import json
from shapely.geometry import MultiPoint, Point
from shapely.ops import unary_union

# 測站坐標查找
with open(r"C:\GoogleAntigravity\2026IoTcenter\documents\figures\dajia_stats_for_report.json", "r", encoding="utf-8") as f:
    data = json.load(f)

sensors = {s["name"]: s for s in data["sensors_ranking"]}

# 定義三大熱區包含的測站
hotzones = {
    "zone1": {
        "id": "zone1",
        "name": "熱區一：東南側生活圈交界熱區 (日南車站/幸福里)",
        "priority": "最高 (常態震央)",
        "color": "#ef4444",
        "sensors": ["TC1043", "TC0697", "TC0676", "TC0875", "TC0913"],
        "desc": "以中山路二段 (TC1043) 與黎明路 (TC0697) 為核心，直貼日南車站商圈與幸福里住宅圈。"
    },
    "zone2": {
        "id": "zone2",
        "name": "熱區二：幼四路／幼五路核心製程區",
        "priority": "最高 (清晨偷排嫌疑)",
        "color": "#f97316",
        "sensors": ["TC0940", "TC0905", "TC0891", "TC0941", "TC0746"],
        "desc": "位於園區幾何中心，聚集重工廠、化學原材料與橡膠金屬加工，TC0905 清晨曾衝破 14,000 ppb。"
    },
    "zone3": {
        "id": "zone3",
        "name": "熱區三：西北側順帆路／長壽路界址",
        "priority": "中高 (西北邊界受體)",
        "color": "#facc15",
        "sensors": ["TC1278", "TC8097", "TC1148", "TC0935", "TC0206"],
        "desc": "順帆路 (TC1278) 與長壽東西六路 (TC8097)，機械表面切削脫脂與無照小型工廠聚集。"
    }
}

for zid, zinfo in hotzones.items():
    pts = []
    for sname in zinfo["sensors"]:
        if sname in sensors:
            s = sensors[sname]
            pts.append(Point(s["lon"], s["lat"]))
    mp = MultiPoint(pts)
    # 做一個 300m 的緩衝多邊形 (約 0.003 度)
    poly = mp.convex_hull.buffer(0.0025)
    
    # 轉為 Leaflet latlngs [[lat, lon], ...]
    if poly.geom_type == "Polygon":
        latlngs = [[round(y, 6), round(x, 6)] for x, y in poly.exterior.coords]
    else:
        latlngs = [[round(y, 6), round(x, 6)] for x, y in poly.geoms[0].exterior.coords]
    zinfo["polygon"] = latlngs
    zinfo["center"] = [round(poly.centroid.y, 6), round(poly.centroid.x, 6)]

print(json.dumps(hotzones, ensure_ascii=False, indent=2))

with open(r"C:\GoogleAntigravity\2026IoTcenter\documents\figures\dajia_hotspots_zones.json", "w", encoding="utf-8") as f:
    json.dump(hotzones, f, ensure_ascii=False, indent=2)

print("✅ 成功產出三大熱區多邊形空間坐標！")
