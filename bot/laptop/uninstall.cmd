@echo off
chcp 65001 >nul
rem يوكّف البرنامج ويشيل التشغيل التلقائي. الإعدادات والملفات تبقى بمكانها.
powershell.exe -NoProfile -Command "Stop-ScheduledTask -TaskName AqsaOffice -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName AqsaOffice -Confirm:$false -ErrorAction SilentlyContinue; Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*AqsaOffice\launcher.ps1*' -or $_.CommandLine -like '*AqsaOffice\agent.ps1*' } | ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null }; Unregister-ScheduledTask -TaskName AqsaOfficeWake -Confirm:$false -ErrorAction SilentlyContinue; Write-Host 'انشال برنامج المكتب'"
pause
