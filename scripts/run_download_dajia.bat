@echo off
chcp 65001 >nul
echo ========================================================
echo   臺中市 IoT 歷史原始資料批次下載器 (.csv.gz)
echo   專案編號: 22 (臺中市 1,401 支感測站)
echo   時間範圍: 2025-06-27 至 2026-09-01
echo   目標目錄: C:\GoogleAntigravity\2026IoTcenter\Dajia
echo ========================================================
cd /d "C:\GoogleAntigravity\2026IoTcenter"
python scripts\download_taichung_iot.py --start 2025-06-27 --end 2026-09-01
pause
