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
        tvoc REAL,
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
        voc REAL,
        tvoc REAL
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
            df['time_5min'] = df['dt'].dt.floor('5min').dt.strftime('%Y-%m-%d %H:%M:%S')
            
            pivot_df = df.pivot_table(
                index=['deviceId', 'time_5min'],
                columns='sensorId',
                values='value',
                aggfunc='mean'
            ).reset_index()
            
            for col in ['pm2_5', 'temperature', 'humidity', 'voc', 'tvoc']:
                if col not in pivot_df.columns:
                    pivot_df[col] = np.nan
            
            insert_data = pivot_df[['deviceId', 'time_5min', 'pm2_5', 'temperature', 'humidity', 'voc', 'tvoc']].copy()
            insert_data.columns = ['sensor_id', 'time', 'pm2_5', 'temperature', 'humidity', 'voc', 'tvoc']
            
            # 清除全空行
            insert_data = insert_data.dropna(subset=['pm2_5', 'temperature', 'humidity', 'voc', 'tvoc'], how='all')
            
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

if __name__ == "__main__":
    start_time = datetime.now()
    init_db()
    import_sensors()
    process_and_import_observations()
    end_time = datetime.now()
    print(f"預處理與匯入程序執行結束。總耗時: {end_time - start_time}", flush=True)
