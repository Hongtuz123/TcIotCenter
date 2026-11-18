@echo off
cd /d C:\GoogleAntigravity\2026IoTcenter\scripts
for %%A in (run_poller.log) do if %%~zA GTR 2097152 break > run_poller.log
echo ========================================== >> run_poller.log
echo IoT Poller Auto Run - %date% %time% >> run_poller.log
npx tsx pollIoT.ts >> run_poller.log 2>&1
echo Done. >> run_poller.log
