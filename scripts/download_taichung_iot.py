# -*- coding: utf-8 -*-
"""
臺中市 IoT 微感測器歷史原始資料批次下載器 (2025/06/27 ~ 2026/09/01)
- 資料來源：環境部物聯網平台 common_api (https://iot.moenv.gov.tw/common_api/iot/)
- 認證方式：CK 碼 Header ('ck': '7a1d3f72-315f-492a-8ee5-409da5e358ce')
- 範圍限定：臺中市 (Project 22, 1,401 支微型感測器)
- 輸出格式：Taichung_YYYY-MM-DD.csv.gz (每日合併全量資料)
- 輸出路徑：C:\\GoogleAntigravity\\2026IoTcenter\\Dajia
- 特色：tqdm 即時進度條、多執行緒平行下載、斷點續傳、優雅中斷處理 (Ctrl+C)
"""

import os
import sys
import io
import gzip
import time
import logging
import argparse
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from tqdm import tqdm

# ── 設定 ──────────────────────────────────────────────────
BASE_DIR = r"C:\GoogleAntigravity\2026IoTcenter"
OUTPUT_DIR = os.path.join(BASE_DIR, "Dajia")
LOG_PATH = os.path.join(OUTPUT_DIR, "download.log")

DEFAULT_START = "2025-06-27"
DEFAULT_END = "2026-09-01"

CK_CODE = "7a1d3f72-315f-492a-8ee5-409da5e358ce"
PROJECT_ID = 22  # 臺中市

COMMON_API = "https://iot.moenv.gov.tw/common_api/iot"
HEADERS = {"ck": CK_CODE, "User-Agent": "Mozilla/5.0"}

# 並發與重試參數
MAX_WORKERS = 24  # 平行下載執行緒數
RETRY_COUNT = 2   # 錯誤重試次數

os.makedirs(OUTPUT_DIR, exist_ok=True)

# 設定日誌
file_handler = logging.FileHandler(LOG_PATH, encoding="utf-8")
file_handler.setFormatter(logging.Formatter("[%(asctime)s] %(levelname)s %(message)s"))

stream_handler = logging.StreamHandler(sys.stdout)
stream_handler.setFormatter(logging.Formatter("[%(asctime)s] %(levelname)s %(message)s"))

log = logging.getLogger("IoTDL")
log.setLevel(logging.INFO)
log.addHandler(file_handler)
log.addHandler(stream_handler)

# ── HTTP Session ──────────────────────────────────────────
def create_session():
    sess = requests.Session()
    retry = Retry(
        total=RETRY_COUNT,
        backoff_factor=0.3,
        status_forcelist=[500, 502, 503, 504],
        raise_on_status=False
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=MAX_WORKERS * 2, pool_maxsize=MAX_WORKERS * 2)
    sess.mount("https://", adapter)
    sess.mount("http://", adapter)
    sess.headers.update(HEADERS)
    return sess

# ── 驗證 Gzip 檔案完整性 ──────────────────────────────────
def is_valid_gz(path):
    if not os.path.exists(path) or os.path.getsize(path) < 50:
        return False
    try:
        with open(path, "rb") as f:
            if f.read(2) != b"\x1f\x8b":
                return False
        with gzip.open(path, "rb") as gz:
            gz.read(64)
        return True
    except Exception:
        return False

def date_range(start_str, end_str):
    cur = datetime.strptime(start_str, "%Y-%m-%d")
    end_dt = datetime.strptime(end_str, "%Y-%m-%d")
    while cur <= end_dt:
        yield cur.strftime("%Y-%m-%d")
        cur += timedelta(days=1)

# ── 取臺中市裝置清單 ──────────────────────────────────────
def get_devices(sess):
    url = f"{COMMON_API}/device/{PROJECT_ID}"
    r = sess.get(url, timeout=15)
    r.raise_for_status()
    devices = r.json()
    log.info(f"臺中市 (Project {PROJECT_ID}) 共取得 {len(devices)} 支感測器裝置")
    return devices

# ── 單一裝置單日下載 ──────────────────────────────────────
def fetch_single_device(device_id, date, sess):
    url = f"{COMMON_API}/device_{device_id}_daily_{date}.csv.gz"
    try:
        r = sess.get(url, timeout=12)
        if r.status_code == 200 and len(r.content) > 50:
            if r.content[:2] == b"\x1f\x8b":
                text = gzip.decompress(r.content).decode("utf-8", errors="ignore")
            else:
                text = r.content.decode("utf-8", errors="ignore")
            
            if "createTime" in text:
                return pd.read_csv(io.StringIO(text))
    except Exception:
        pass
    return None

# ── 合併當日所有裝置資料 ──────────────────────────────────
def process_day(date, devices, sess, output_path):
    frames = []
    n_ok = 0
    n_fail = 0

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_to_dev = {
            executor.submit(fetch_single_device, dev["id"], date, sess): dev["id"]
            for dev in devices
        }
        
        with tqdm(total=len(devices), desc=f"  [{date}] 下載中", unit="站", leave=False, dynamic_ncols=True) as pbar:
            for future in as_completed(future_to_dev):
                df = future.result()
                if df is not None and not df.empty:
                    frames.append(df)
                    n_ok += 1
                else:
                    n_fail += 1
                pbar.update(1)
                pbar.set_postfix({"成功": n_ok, "無資料": n_fail})

    if frames:
        merged = pd.concat(frames, ignore_index=True)
        if "createTime" in merged.columns:
            merged.sort_values(by=["createTime", "deviceId"], inplace=True)

        buf = io.BytesIO()
        with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
            merged.to_csv(gz, index=False, encoding="utf-8")

        with open(output_path, "wb") as f:
            f.write(buf.getvalue())

        size_mb = os.path.getsize(output_path) / (1024 * 1024)
        log.info(f"  ✅ [{date}] 完成: {n_ok} 站成功 / {n_fail} 站無資料 | 共 {len(merged):,} 筆 ({size_mb:.2f} MB) -> {os.path.basename(output_path)}")
        return True
    else:
        log.warning(f"  ⚠️ [{date}] 無可用資料 (全數 {n_fail} 站未回傳)")
        return False

# ── 主執行流程 ────────────────────────────────────────────
def run(start_str=DEFAULT_START, end_str=DEFAULT_END, resume=True):
    log.info("=" * 65)
    log.info(f"🚀 開始執行臺中市 (Project {PROJECT_ID}) 歷史資料批次下載")
    log.info(f"📅 時間區間: {start_str} 至 {end_str}")
    log.info(f"📁 儲存目標: {OUTPUT_DIR}")
    log.info(f"🔑 認證 CK 碼: {CK_CODE[:8]}...{CK_CODE[-4:]}")
    log.info(f"⚡ 平行下載執行緒: {MAX_WORKERS}")
    log.info("=" * 65)

    sess = create_session()

    try:
        devices = get_devices(sess)
    except Exception as e:
        log.error(f"❌ 取得臺中市裝置清單失敗: {e}")
        return

    dates = list(date_range(start_str, end_str))
    total_days = len(dates)
    success_cnt = 0
    skip_cnt = 0
    fail_cnt = 0

    start_time = time.time()

    try:
        for idx, d_str in enumerate(dates, 1):
            target_filename = f"Taichung_{d_str}.csv.gz"
            target_path = os.path.join(OUTPUT_DIR, target_filename)

            if resume and is_valid_gz(target_path):
                log.info(f"[{idx:4d}/{total_days}] ⏩ 跳過已存在檔案: {target_filename}")
                skip_cnt += 1
                continue

            log.info(f"[{idx:4d}/{total_days}] ⬇️ 開始處理 {d_str} ...")
            day_start = time.time()
            ok = process_day(d_str, devices, sess, target_path)
            elapsed = time.time() - day_start

            if ok:
                success_cnt += 1
                log.info(f"      單日耗時: {elapsed:.1f} 秒")
            else:
                fail_cnt += 1
                if os.path.exists(target_path) and not is_valid_gz(target_path):
                    os.remove(target_path)

            time.sleep(0.3)

    except KeyboardInterrupt:
        log.warning("\n⚠️ 收到使用者中斷信號 (Ctrl+C)，安全停止下載任務。")
        log.warning(f"💡 目前已下載完成的檔案已全部安全儲存於 {OUTPUT_DIR}，下次執行會自動斷點續傳。")
    finally:
        total_elapsed = time.time() - start_time
        log.info("=" * 65)
        log.info(f"📊 執行摘要: 總天數 {total_days} 天 | 成功 {success_cnt} | 略過 {skip_cnt} | 失敗 {fail_cnt}")
        log.info(f"⏱️ 累計耗時: {total_elapsed/60:.1f} 分鐘")
        log.info(f"📂 資料存放位置: {OUTPUT_DIR}")
        log.info("=" * 65)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="臺中市微感測器歷史資料 (.csv.gz) 批次下載器")
    parser.add_argument("--start", default=DEFAULT_START, help="起始日期 (格式 YYYY-MM-DD)")
    parser.add_argument("--end", default=DEFAULT_END, help="結束日期 (格式 YYYY-MM-DD)")
    parser.add_argument("--no-resume", action="store_true", help="強制重新下載已有檔案")
    args = parser.parse_args()

    run(start_str=args.start, end_str=args.end, resume=not args.no_resume)
