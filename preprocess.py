# -*- coding: utf-8 -*-
import os
import glob
import sqlite3
import pandas as pd
import numpy as np
from datetime import datetime

# 設定路徑
BASE_DIR = r"C:\GoogleAntigravity\2026IoTcenter"
DB_PATH = os.path.join(BASE_DIR, "dashboard", "iot.db")
INFO_CSV = os.path.join(BASE_DIR, "iotinformation.csv")
DATA_DIR = os.path.join(BASE_DIR, "202604iotdata")

# 歷史資料時間過濾配置 (若為 None 則導入整個 4 月份資料)
# 推薦設為前三天 "2026-04-01" ~ "2026-04-03"，能確保跨日趨勢正常展現，且資料庫大小輕量在 200MB 以內
IMPORT_START_DATE = "2026-04-01"
IMPORT_END_DATE = "2026-04-03"

def init_db():
    """初始化 SQLite 資料庫與資料表"""
    db_dir = os.path.dirname(DB_PATH)
    if not os.path.exists(db_dir):
        os.makedirs(db_dir)
        
    print(f"正在初始化資料庫: {DB_PATH}", flush=True)
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # 1. 建立感測器主檔表
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sensors (
        id TEXT PRIMARY KEY,
        name TEXT,
        lat REAL,
        lon REAL,
        county TEXT,
        status TEXT DEFAULT '正常'
    )
    """)
    
    # 2. 建立觀測資料表 (對齊到 5 分鐘)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS observations (
        sensor_id TEXT,
        time TEXT,
        pm2_5 REAL,
        temperature REAL,
        humidity REAL,
        voc REAL,
        PRIMARY KEY (sensor_id, time)
    )
    """)
    
    # 3. 建立事件主檔表
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        title TEXT,
        description TEXT,
        status TEXT, -- '待確認', '調查中', '已結案'
        created_at TEXT,
        updated_at TEXT,
        bounds TEXT -- 儲存 GeoJSON 或者是圈選的中心座標與半徑
    )
    """)
    
    # 4. 建立事件與感測器關聯表
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS event_sensors (
        event_id TEXT,
        sensor_id TEXT,
        PRIMARY KEY (event_id, sensor_id),
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (sensor_id) REFERENCES sensors(id) ON DELETE CASCADE
    )
    """)
    
    # 5. 建立系統設定表
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )
    """)
    
    # 寫入預設燃燒熱點判定參數
    default_settings = [
        ("pm25_threshold", "54.0"),
        ("temp_increase_threshold", "3.0"),
        ("voc_threshold", "1.5"),
        ("cluster_radius_km", "1.0"),
        ("min_cluster_stations", "2")
    ]
    cursor.executemany("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", default_settings)
    
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_obs_time ON observations(time)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_obs_sensor ON observations(sensor_id)")
    
    conn.commit()
    conn.close()
    print("資料庫初始化完成。", flush=True)

def import_sensors():
    """匯入感測器基本資訊"""
    print("開始匯入感測器基本資訊...", flush=True)
    if not os.path.exists(INFO_CSV):
        print(f"找不到感測器資訊檔: {INFO_CSV}", flush=True)
        return
        
    df = pd.read_csv(INFO_CSV)
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    inserted_count = 0
    for idx, row in df.iterrows():
        try:
            device_id = str(row["裝置ID"]).strip()
            name = str(row["裝置名稱"]).strip()
            lat = float(row["緯度"])
            lon = float(row["經度"])
            county = str(row["行政區"]).strip() if pd.notna(row["行政區"]) else "未知"
            
            cursor.execute("""
            INSERT OR REPLACE INTO sensors (id, name, lat, lon, county)
            VALUES (?, ?, ?, ?, ?)
            """, (device_id, name, lat, lon, county))
            inserted_count += 1
        except Exception as e:
            continue
            
    conn.commit()
    conn.close()
    print(f"成功匯入 {inserted_count} 筆感測器基本資訊。", flush=True)

def process_and_import_observations():
    """處理歷史觀測資料並寫入資料庫 (超高速批次優化版)"""
    print("開始處理觀測資料 CSV 檔案...", flush=True)
    csv_files = glob.glob(os.path.join(DATA_DIR, "deviceId_*.csv"))
    total_files = len(csv_files)
    print(f"共找到 {total_files} 個 CSV 數據檔案。", flush=True)
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # 建立臨時表供批次寫入
    cursor.execute("""
    CREATE TEMP TABLE IF NOT EXISTS temp_obs (
        sensor_id TEXT,
        time TEXT,
        pm2_5 REAL,
        temperature REAL,
        humidity REAL,
        voc REAL
    )
    """)
    
    file_count = 0
    for file_path in csv_files:
        file_count += 1
        try:
            df = pd.read_csv(file_path)
            if df.empty:
                continue
                
            df['dt'] = pd.to_datetime(df['createTime'])
            
            # 時間範圍過濾
            if IMPORT_START_DATE and IMPORT_END_DATE:
                start_dt = pd.to_datetime(IMPORT_START_DATE)
                end_dt = pd.to_datetime(IMPORT_END_DATE + " 23:59:59")
                df = df[(df['dt'] >= start_dt) & (df['dt'] <= end_dt)]
                if df.empty:
                    continue

            df['time_5min'] = df['dt'].dt.floor('5min').dt.strftime('%Y-%m-%d %H:%M:%S')
            
            pivot_df = df.pivot_table(
                index=['deviceId', 'time_5min'],
                columns='sensorId',
                values='value',
                aggfunc='mean'
            ).reset_index()
            
            for col in ['pm2_5', 'temperature', 'humidity', 'voc']:
                if col not in pivot_df.columns:
                    pivot_df[col] = np.nan
            
            insert_data = pivot_df[['deviceId', 'time_5min', 'pm2_5', 'temperature', 'humidity', 'voc']].copy()
            insert_data.columns = ['sensor_id', 'time', 'pm2_5', 'temperature', 'humidity', 'voc']
            
            # 清除全空行
            insert_data = insert_data.dropna(subset=['pm2_5', 'temperature', 'humidity', 'voc'], how='all')
            
            if insert_data.empty:
                continue
                
            # 寫入 TEMP TABLE
            insert_data.to_sql('temp_obs', conn, if_exists='append', index=False)
            
            # 從 TEMP TABLE 批次寫入主表 (INSERT OR REPLACE)
            cursor.execute("INSERT OR REPLACE INTO observations SELECT * FROM temp_obs")
            
            # 清空 TEMP TABLE
            cursor.execute("DELETE FROM temp_obs")
            
            if file_count % 20 == 0:
                conn.commit()
                print(f"已處理 {file_count}/{total_files} 個檔案...", flush=True)
                
        except Exception as e:
            print(f"處理檔案 {os.path.basename(file_path)} 時出錯: {str(e)}", flush=True)
            continue
            
    conn.commit()
    conn.close()
    print("歷史觀測資料匯入完成。", flush=True)

def export_industrial_zones():
    """將臺中產業園區 Shapefile 轉換為 WGS84 GeoJSON"""
    import shapefile
    import json
    import math
    
    shp_dir = os.path.join(BASE_DIR, "產業園區shp")
    shp_path = os.path.join(shp_dir, "臺中產業園區.shp")
    out_geojson = os.path.join(BASE_DIR, "dashboard", "public", "industrial-zones.geojson")
    
    os.makedirs(os.path.dirname(out_geojson), exist_ok=True)
    
    if not os.path.exists(shp_path):
        print(f"找不到產業園區 Shapefile: {shp_path}", flush=True)
        return
        
    print("開始將臺中產業園區 Shapefile 轉換為 GeoJSON 並進行 WGS84 座標轉換...", flush=True)
    
    def twd97_to_wgs84(x, y):
        # 台灣 TWD97 二度分帶經度 121 (EPSG:3826) 轉 WGS84 (EPSG:4326) 純數學投影公式
        a = 6378137.0
        b = 6356752.314245
        long0 = math.radians(121.0)
        k0 = 0.9999
        dx = 250000.0
        
        dy = y
        x = x - dx
        
        e = math.sqrt(1 - (b**2) / (a**2))
        e2 = (e**2) / (1 - e**2)
        
        M = dy / k0
        mu = M / (a * (1 - (e**2)/4 - 3*(e**4)/64 - 5*(e**6)/256))
        e1 = (1 - math.sqrt(1 - e**2)) / (1 + math.sqrt(1 - e**2))
        
        j1 = (3*e1/2 - 27*(e1**3)/32)
        j2 = (21*(e1**2)/16 - 55*(e1**4)/32)
        j3 = (151*(e1**3)/96)
        j4 = (1097*(e1**4)/512)
        
        fp = mu + j1*math.sin(2*mu) + j2*math.sin(4*mu) + j3*math.sin(6*mu) + j4*math.sin(8*mu)
        
        C1 = e2 * math.cos(fp)**2
        T1 = math.tan(fp)**2
        R1 = a * (1 - e**2) / (1 - (e**2)*math.sin(fp)**2)**1.5
        N1 = a / math.sqrt(1 - (e**2)*math.sin(fp)**2)
        D = x / (N1 * k0)
        
        Q1 = D**2 / 2
        Q2 = (5 + 3*T1 + 10*C1 - 4*(C1**2) - 9*e2) * D**4 / 24
        Q3 = (61 + 90*T1 + 298*C1 + 45*(T1**2) - 3*(C1**2) - 252*e2) * D**6 / 720
        lat = fp - (N1 * math.tan(fp) / R1) * (Q1 - Q2 + Q3)
        lat = math.degrees(lat)
        
        Q4 = D
        Q5 = (1 + 2*T1 + C1) * D**3 / 6
        Q6 = (5 - 2*C1 + 28*T1 - 3*(C1**2) + 8*e2 + 24*(T1**2)) * D**5 / 120
        lon = long0 + (Q4 - Q5 + Q6) / math.cos(fp)
        lon = math.degrees(lon)
        
        return lon, lat

    try:
        try:
            reader = shapefile.Reader(shp_path, encoding='utf-8')
            fields = [f[0] for f in reader.fields[1:]]
        except Exception:
            reader = shapefile.Reader(shp_path, encoding='cp950')
            fields = [f[0] for f in reader.fields[1:]]
        
        features = []
        for sr in reader.shapeRecords():
            geom = sr.shape.__geo_interface__
            rec = dict(zip(fields, sr.record))
            
            new_coords = []
            if geom["type"] == "Polygon":
                for ring in geom["coordinates"]:
                    new_ring = []
                    for pt in ring:
                        lon, lat = twd97_to_wgs84(pt[0], pt[1])
                        new_ring.append([lon, lat])
                    new_coords.append(new_ring)
            elif geom["type"] == "MultiPolygon":
                for poly in geom["coordinates"]:
                    new_poly = []
                    for ring in poly:
                        new_ring = []
                        for pt in ring:
                            lon, lat = twd97_to_wgs84(pt[0], pt[1])
                            new_ring.append([lon, lat])
                        new_poly.append(new_ring)
                    new_coords.append(new_poly)
            
            geom["coordinates"] = new_coords
            
            features.append({
                "type": "Feature",
                "properties": {
                    "id": rec.get("OBJECTID", ""),
                    "name": rec.get("園區名稱", rec.get("NAME", "未命名")),
                    "area": rec.get("面積", 0)
                },
                "geometry": geom
            })
            
        geojson = {
            "type": "FeatureCollection",
            "features": features
        }
        
        with open(out_geojson, 'w', encoding='utf-8') as f:
            json.dump(geojson, f, ensure_ascii=False, indent=2)
            
        print(f"轉換成功！GeoJSON 檔案已寫入: {out_geojson}", flush=True)
        
    except Exception as e:
        print(f"Shapefile 轉換 GeoJSON 時發生錯誤: {str(e)}", flush=True)

if __name__ == "__main__":
    start_time = datetime.now()
    init_db()
    import_sensors()
    process_and_import_observations()
    export_industrial_zones()
    end_time = datetime.now()
    print(f"預處理與匯入程序執行結束。總耗時: {end_time - start_time}", flush=True)
