# -*- coding: utf-8 -*-
"""
從環境部環境資料開放平臺下載高雄市 12 個標準測站歷史風速風向數據 (2026-08 至 2026-10)
API Key: 37d1e1d0-10b6-4c18-9b57-de2931c69db3
資料集: AQX_P_488
快取路徑: C:\GoogleAntigravity\2026IoTcenter\saic\output\moenv_kaohsiung_wind_hourly_2026.parquet
"""

import os
import time
import requests
import polars as pl
import pandas as pd

API_KEY = "37d1e1d0-10b6-4c18-9b57-de2931c69db3"
OUTPUT_DIR = r"C:\GoogleAntigravity\2026IoTcenter\saic\output"
CACHE_PARQUET = os.path.join(OUTPUT_DIR, "moenv_kaohsiung_wind_hourly_2026.parquet")

os.makedirs(OUTPUT_DIR, exist_ok=True)


def download_moenv_wind():
    print("=" * 65)
    print("🚀 啟動環境部高雄市 12 標準測站歷史風速風向下載程序")
    print(f"資料集: AQX_P_488 (高雄市)")
    print(f"目標快取: {CACHE_PARQUET}")
    print("=" * 65)

    all_records = []
    offset = 0
    limit = 1000
    target_start_date = "2026-08-01 00:00"

    reached_target_start = False

    while True:
        url = f"https://data.moenv.gov.tw/api/v2/aqx_p_488?filters=county,EQ,高雄市&offset={offset}&limit={limit}&api_key={API_KEY}"
        try:
            r = requests.get(url, timeout=20)
            if r.status_code != 200:
                print(f"⚠️ 請求失敗 (offset={offset}): HTTP {r.status_code}")
                time.sleep(2)
                continue

            data = r.json()
            recs = data.get("records", []) if isinstance(data, dict) else data
            if not recs:
                print(f"✅ 已無更多資料 (offset={offset})。")
                break

            # 挑選關鍵欄位
            for item in recs:
                all_records.append({
                    "sitename": item.get("sitename"),
                    "siteid": item.get("siteid"),
                    "datacreationdate": item.get("datacreationdate"),
                    "windspeed": float(item.get("windspeed")) if item.get("windspeed") not in [None, "", "-"] else None,
                    "winddirec": float(item.get("winddirec")) if item.get("winddirec") not in [None, "", "-"] else None,
                    "lat": float(item.get("latitude")) if item.get("latitude") else None,
                    "lon": float(item.get("longitude")) if item.get("longitude") else None,
                })

            min_d = recs[-1].get("datacreationdate")
            print(f"  Offset {offset:5d} -> 取得 {len(recs)} 筆，時間回溯至: {min_d}")

            if min_d and min_d < target_start_date:
                reached_target_start = True
                print("🎯 已完整回溯至 2026-08-01 之前，停止翻頁。")
                break

            offset += limit
            time.sleep(0.3)

        except Exception as e:
            print(f"⚠️ 網路異常: {e}，重試中...")
            time.sleep(2)

    df = pd.DataFrame(all_records)
    # 去重與過濾
    df = df.dropna(subset=["sitename", "datacreationdate"]).drop_duplicates(subset=["sitename", "datacreationdate"])
    df = df.sort_values(by=["datacreationdate", "sitename"])

    # 轉為 Polars 儲存為 Parquet
    df_pl = pl.from_pandas(df)
    df_pl.write_parquet(CACHE_PARQUET, compression="zstd")
    print("=" * 65)
    print(f"🎉 高雄市氣象測站風速風向下載完畢！總筆數: {len(df_pl):,} 筆")
    print(f"時間範圍: {df_pl['datacreationdate'].min()} 至 {df_pl['datacreationdate'].max()}")
    print(f"包含測站: {df_pl['sitename'].unique().to_list()}")
    print(f"快取檔案: {CACHE_PARQUET}")
    print("=" * 65)
    return df_pl


if __name__ == "__main__":
    download_moenv_wind()
