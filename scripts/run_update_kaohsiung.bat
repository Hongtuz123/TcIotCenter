@echo off
chcp 65001 > nul
echo ======================================================================
echo 啟動高雄市微感 PM2.5 數據自動下載與小時平均值更新程序
echo 下載區間：2026-09-01 ~ 2026-10-14 (最新)
echo 輸出目標：C:\GoogleAntigravity\2026IoTcenter\saic\小時平均值\2026高雄市微感資料.xlsx
echo 工作表分頁：2026-08、2026-09、2026-10
echo ======================================================================

cd /d "C:\GoogleAntigravity\2026IoTcenter"
python scripts\update_kaohsiung_hourly_pm25.py

echo.
echo 更新程序已執行完畢！
pause
