@echo off
chcp 65001 >nul
rem يوكّف البرنامج ويشيل التشغيل التلقائي. الإعدادات والملفات تبقى بمكانها.
powershell.exe -NoProfile -Command "Stop-ScheduledTask -TaskName AqsaOffice -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName AqsaOffice -Confirm:$false -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName AqsaOfficeWake -Confirm:$false -ErrorAction SilentlyContinue; Write-Host 'انشال برنامج المكتب'"
pause
