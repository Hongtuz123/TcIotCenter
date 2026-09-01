@echo off
chcp 65001 >nul
echo ========================================================
echo   臺中市 IoT 歷史原始資料批次下載器 (.csv.gz)
echo   時間範圍: 2025-01-01 至 2026-09-01
echo   目標目錄: C:\GoogleAntigravity\2026IoTcenter\Dajia
echo ========================================================
cd /d "C:\GoogleAntigravity\2026IoTcenter"
python scripts\download_taichung_iot.py --start 2025-01-01 --end 2026-09-01
pause
