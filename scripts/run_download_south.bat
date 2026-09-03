@echo off
chcp 65001 > nul
echo ======================================================================
echo 啟動南臺灣五縣市 (高雄、台南、屏東、嘉義縣、嘉義市) IoT 批次下載程序
echo 時間區間：2026-01-01 ~ 2026-08-31
echo 儲存目錄：C:\GoogleAntigravity\2026IoTcenter\saic
echo ======================================================================

cd /d "C:\GoogleAntigravity\2026IoTcenter"
python scripts\download_south_iot.py

echo.
echo 下載程序執行完畢或已中斷。如需繼續，隨時可再次執行此批次檔 (支援斷點續傳)。
pause
