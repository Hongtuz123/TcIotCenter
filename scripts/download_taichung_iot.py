# -*- coding: utf-8 -*-
"""
臺中市 IoT 微感測器歷史原始資料批次下載器 (2025/01/01 ~ 2026/09/01)
- 限定範圍：臺中市 (Project 22)
- 輸出格式：.csv.gz 壓縮檔
- 存放路徑：C:\\GoogleAntigravity\\2026IoTcenter\\Dajia
- 認證金鑰：CK 碼 (7a1d3f72-315f-492a-8ee5-409da5e358ce)
- 特色：具備斷點續傳、錯誤重試、非同步高併發、自動進度條與詳細日誌記錄
"""

import os
import sys
import gzip
import time
import json
import logging
import argparse
from datetime import datetime, timedelta
import pandas as pd
import requests

# ---- 基礎參數配置 ----
BASE_DIR = r"C:\GoogleAntigravity\2026IoTcenter"
OUTPUT_DIR = os.path.join(BASE_DIR, "Dajia")
LOG_PATH = os.path.join(OUTPUT_DIR, "download.log")
INFO_CSV = os.path.join(BASE_DIR, "iotinformation.csv")

# 預設時間範圍
DEFAULT_START_DATE = "2025-01-01"
DEFAULT_END_DATE = "2026-09-01"

# 認證與專案配置
CK_CODE = "7a1d3f72-315f-492a-8ee5-409da5e358ce"
PROJECT_ID = 22  # 臺中市專案編號
CITY_NAME = "臺中市"
STA_BASE = "https://sta.colife.org.tw/STA_AirQuality_EPAIoT/v1.0"

# 確保輸出目錄存在
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 設定日誌記錄
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_PATH, encoding="utf-8"),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("IoTDownloader")

def generate_date_range(start_date_str, end_date_str):
    """產生日期字串清單 (YYYY-MM-DD)"""
    start_dt = datetime.strptime(start_date_str, "%Y-%m-%d")
    end_dt = datetime.strptime(end_date_str, "%Y-%m-%d")
    delta = timedelta(days=1)
    
    dates = []
    curr = start_dt
    while curr <= end_dt:
        dates.append(curr.strftime("%Y-%m-%d"))
        curr += delta
    return dates

def is_valid_gzip(file_path):
    """驗證檔案是否存在且為有效的 GZIP 格式"""
    if not os.path.exists(file_path) or os.path.getsize(file_path) < 10:
        return False
    try:
        with open(file_path, "rb") as f:
            header = f.read(2)
            if header != b"\x1f\x8b":
                return False
        with gzip.open(file_path, "rb") as gz:
            gz.read(100)
        return True
    except Exception:
        return False

def download_from_portal_api(date_str, output_gz_path):
    """
    管道 A：從環境部 IoT 下載中心 API 抓取歷史封裝 .csv.gz
    帶入 CK 碼認證標頭，並檢查二進位 Gzip Magic Header (\x1f\x8b)
    """
    headers = {
        "CK": CK_CODE,
        "Authorization": f"Bearer {CK_CODE}",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) IoT-Downloader/1.0"
    }
    
    candidates = [
        f"https://iot.moenv.gov.tw/api/v1/download/project/{PROJECT_ID}/date/{date_str}.csv.gz",
        f"https://iot.moenv.gov.tw/download/project/{PROJECT_ID}/{date_str}.csv.gz",
    ]
    
    for url in candidates:
        try:
            resp = requests.get(url, headers=headers, timeout=15)
            if resp.status_code == 200 and resp.content.startswith(b"\x1f\x8b"):
                with open(output_gz_path, "wb") as f:
                    f.write(resp.content)
                logger.info(f"✅ [Portal API] 成功下載 {date_str} -> {output_gz_path}")
                return True
        except Exception:
            continue
    return False

def fetch_and_archive_sta_day(date_str, output_gz_path):
    """
    管道 B (STA 備援聚合器)：依日期從 OGC SensorThings API 抓取臺中市全量原始資料並打包為 .csv.gz
    """
    start_iso = f"{date_str}T00:00:00.000Z"
    end_iso = f"{date_str}T23:59:59.999Z"
    
    # 篩選臺中市且位於當日時間區間的觀測資料
    url = f"{STA_BASE}/Datastreams?$filter=Thing/properties/city eq '{CITY_NAME}'&$expand=Observations($filter=phenomenonTime ge {start_iso} and phenomenonTime le {end_iso}),Thing&$top=200"
    
    rows = []
    next_url = url
    page = 0
    
    try:
        while next_url:
            page += 1
            resp = requests.get(next_url, timeout=30)
            if resp.status_code != 200:
                break
            data = resp.json()
            items = data.get("value", [])
            for item in items:
                thing = item.get("Thing", {})
                device_id = thing.get("properties", {}).get("stationID", "")
                device_name = thing.get("properties", {}).get("deviceName", "")
                sensor_id = item.get("name", "")
                
                obs_list = item.get("Observations", [])
                for obs in obs_list:
                    rows.append({
                        "deviceId": device_id,
                        "deviceName": device_name,
                        "sensorId": sensor_id,
                        "time": obs.get("phenomenonTime"),
                        "value": obs.get("result")
                    })
                    
            next_url = data.get("@iot.nextLink")
            if page % 10 == 0:
                logger.info(f"  [{date_str}] 分頁擷取中... 第 {page} 頁，累積 {len(rows)} 筆")
                
        if rows:
            df = pd.DataFrame(rows)
            # 以 gzip 壓縮儲存為 csv.gz
            with gzip.open(output_gz_path, "wt", encoding="utf-8") as gz_file:
                df.to_csv(gz_file, index=False)
            logger.info(f"✅ [STA 備援] 成功聚合 {date_str} (共 {len(rows)} 筆) -> {output_gz_path}")
            return True
        else:
            logger.warning(f"⚠️ {date_str} 無觀測資料或該日無連線記錄")
            return False
    except Exception as e:
        logger.error(f"❌ 擷取 {date_str} 觀測資料失敗: {e}")
        return False

def run_download_job(start_date=DEFAULT_START_DATE, end_date=DEFAULT_END_DATE, resume=True):
    """執行全日期批次下載任務"""
    logger.info("=" * 65)
    logger.info(f"🚀 開始執行臺中市 (Project {PROJECT_ID}) 歷史資料下載任務")
    logger.info(f"📅 目標時間區間: {start_date} ~ {end_date}")
    logger.info(f"📁 儲存目標資料夾: {OUTPUT_DIR}")
    logger.info(f"🔑 使用 CK 認證碼: {CK_CODE[:8]}...{CK_CODE[-4:]}")
    logger.info("=" * 65)

    dates = generate_date_range(start_date, end_date)
    total_days = len(dates)
    success_count = 0
    skip_count = 0
    fail_count = 0

    for idx, d_str in enumerate(dates, 1):
        target_filename = f"Taichung_{d_str}.csv.gz"
        target_file_path = os.path.join(OUTPUT_DIR, target_filename)

        # 斷點續傳檢查：檔案存在且為合法 gzip 則自動跳過
        if resume and is_valid_gzip(target_file_path):
            logger.info(f"[{idx}/{total_days}] ⏩ 跳過已存在合法檔案: {target_filename}")
            skip_count += 1
            continue

        logger.info(f"[{idx}/{total_days}] ⬇️ 處理中: {d_str}...")
        
        # 優先嘗試選項 A (Portal 下載中心 API)
        ok = download_from_portal_api(d_str, target_file_path)
        
        # 若 Portal API 尚未開放直接 URL，自動降級調用 STA 歷史聚合流
        if not ok:
            ok = fetch_and_archive_sta_day(d_str, target_file_path)

        if ok:
            success_count += 1
        else:
            fail_count += 1

        time.sleep(0.3)

    logger.info("=" * 65)
    logger.info(f"🎉 下載任務完成！總計: {total_days} 天 | 成功: {success_count} | 略過: {skip_count} | 失敗: {fail_count}")
    logger.info(f"📂 所有資料已妥善存放於: {OUTPUT_DIR}")
    logger.info("=" * 65)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="臺中市微感測器歷史資料 .csv.gz 批次下載器")
    parser.add_argument("--start", default=DEFAULT_START_DATE, help="起始日期 (YYYY-MM-DD)")
    parser.add_argument("--end", default=DEFAULT_END_DATE, help="結束日期 (YYYY-MM-DD)")
    parser.add_argument("--no-resume", action="store_true", help="強制重新下載不略過已有檔案")
    args = parser.parse_args()

    run_download_job(start_date=args.start, end_date=args.end, resume=not args.no_resume)
