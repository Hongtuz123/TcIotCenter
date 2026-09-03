# -*- coding: utf-8 -*-
"""
南臺灣五縣市 IoT 微型感測器批次下載器
- 區域：高雄市、台南市、嘉義市、嘉義縣、屏東縣
- 時間區間：2026-01-01 ~ 2026-08-31 (共 243 天)
- 輸出路徑：C:\\GoogleAntigravity\\2026IoTcenter\\saic
- 特色：斷點續傳、多執行緒 24 Workers、依縣市獨立資料夾歸檔
"""

import os
import sys
import io
import gzip
import time
import logging
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from tqdm import tqdm

BASE_DIR = r"C:\GoogleAntigravity\2026IoTcenter"
OUTPUT_ROOT = os.path.join(BASE_DIR, "saic")
LOG_PATH = os.path.join(OUTPUT_ROOT, "download_saic.log")

CK_CODE = "7a1d3f72-315f-492a-8ee5-409da5e358ce"
COMMON_API = "https://iot.moenv.gov.tw/common_api/iot"
HEADERS = {"ck": CK_CODE, "User-Agent": "Mozilla/5.0"}

MAX_WORKERS = 24
RETRY_COUNT = 2

# 縣市專案清單 (依專屬資料夾歸類)
PROJECTS = {
    "Kaohsiung": {"name": "高雄市", "id": 24},
    "Tainan": {"name": "台南市", "id": 23},
    "ChiayiCity": {"name": "嘉義市", "id": 8},
    "ChiayiCounty": {"name": "嘉義縣", "id": 6},
    "Pingtung": {"name": "屏東縣", "id": 4}
}

# 更新為指定的 2026 年度區間
DEFAULT_START = "2026-01-01"
DEFAULT_END = "2026-08-31"

os.makedirs(OUTPUT_ROOT, exist_ok=True)

# 設定日誌
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(message)s",
    handlers=[
        logging.FileHandler(LOG_PATH, encoding="utf-8"),
        logging.StreamHandler(sys.stdout)
    ]
)
log = logging.getLogger("SaicDL")

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

def get_devices(project_id, sess):
    url = f"{COMMON_API}/device/{project_id}"
    r = sess.get(url, timeout=15)
    r.raise_for_status()
    return r.json()

def fetch_single_device(device_id, date, sess):
    url = f"{COMMON_API}/device_{device_id}_daily_{date}.csv.gz"
    try:
        r = sess.get(url, timeout=10)
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

def process_day(date, devices, sess, output_path, desc_name):
    frames = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_to_dev = {
            executor.submit(fetch_single_device, dev["id"], date, sess): dev["id"]
            for dev in devices
        }
        for future in as_completed(future_to_dev):
            df = future.result()
            if df is not None and not df.empty:
                frames.append(df)

    if frames:
        merged = pd.concat(frames, ignore_index=True)
        if "createTime" in merged.columns:
            merged.sort_values(by=["createTime", "deviceId"], inplace=True)

        buf = io.BytesIO()
        with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
            merged.to_csv(gz, index=False, encoding="utf-8")

        with open(output_path, "wb") as f:
            f.write(buf.getvalue())
        return len(frames), len(merged), os.path.getsize(output_path) / (1024 * 1024)
    return 0, 0, 0

def run_download(start_str=DEFAULT_START, end_str=DEFAULT_END, selected_counties=None):
    sess = create_session()
    targets = PROJECTS
    if selected_counties:
        targets = {k: v for k, v in PROJECTS.items() if k in selected_counties or v["name"] in selected_counties}

    log.info("=" * 65)
    log.info("🚀 啟動南臺灣五縣市微感資料批次下載器")
    log.info(f"📅 下載區間: {start_str} 至 {end_str}")
    log.info(f"📁 儲存目標: {OUTPUT_ROOT}")
    log.info(f"📍 下載縣市: {', '.join([v['name'] for v in targets.values()])}")
    log.info("=" * 65)

    for c_key, c_info in targets.items():
        c_name = c_info["name"]
        c_id = c_info["id"]
        c_dir = os.path.join(OUTPUT_ROOT, c_name)
        os.makedirs(c_dir, exist_ok=True)

        log.info(f"\n>>> 正在取得【{c_name}】(Project {c_id}) 測站清單...")
        devices = get_devices(c_id, sess)
        log.info(f"✅ {c_name} 共有 {len(devices)} 支測站設備。")

        dates = list(date_range(start_str, end_str))
        pbar = tqdm(dates, desc=f"下載 {c_name}", dynamic_ncols=True)

        for d in pbar:
            out_file = os.path.join(c_dir, f"{c_name}_{d}.csv.gz")
            if is_valid_gz(out_file):
                continue

            n_stations, n_rows, sz_mb = process_day(d, devices, sess, out_file, c_name)
            pbar.set_postfix({"日期": d, "成功站數": n_stations, "大小MB": f"{sz_mb:.1f}"})

    log.info("\n🎉 所有指定縣市資料下載完成！")

if __name__ == "__main__":
    run_download()
