# تنصيب برنامج مكتب أقصى الفرات على اللابتوب (مرة وحدة).
# يشتغل من install.cmd. يسأل عن رابط الوسيط والرمز ومجلد الطباعة ووقت التشغيل اليومي.

$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:APPDATA 'AqsaOffice'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

Write-Host ''
Write-Host '=== تنصيب برنامج مكتب أقصى الفرات ===' -ForegroundColor Yellow
$worker = Read-Host 'رابط الوسيط (Enter = https://aqsa-bot.companyaqsaalfurat.workers.dev)'
if (-not $worker) { $worker = 'https://aqsa-bot.companyaqsaalfurat.workers.dev' }
$worker = $worker -replace '/office/?$', ''
$pin = Read-Host 'رمز المكتب (نفس OFFICE_PIN)'

$drive = @('G:\My Drive', 'G:\محرك Drive الخاص بي', "$env:USERPROFILE\Google Drive") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($drive) { $defaultFolder = Join-Path $drive 'للطباعة' } else { $defaultFolder = Join-Path ([Environment]::GetFolderPath('Desktop')) 'للطباعة' }
$folder = Read-Host "مجلد الطباعة (Enter = $defaultFolder)"
if (-not $folder) { $folder = $defaultFolder }

$wake = Read-Host 'وقت يگعد بيه اللابتوب كل يوم إذا نايم (مثل 07:45، Enter = بلا)'

@{ worker = $worker.Trim(); pin = $pin.Trim(); printFolder = $folder } | ConvertTo-Json |
  Set-Content -Path (Join-Path $dir 'config.json') -Encoding UTF8
Copy-Item -Path (Join-Path $PSScriptRoot 'agent.ps1') -Destination (Join-Path $dir 'agent.ps1') -Force
New-Item -ItemType Directory -Force -Path $folder | Out-Null

# يشتغل وحده كل ما تدخل للويندوز، مخفي، ويرجع يشتغل إذا وكف
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $dir 'agent.ps1') + '"')
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'AqsaOffice' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

if ($wake) {
  # يصحّي اللابتوب من النوم (Sleep) بهذا الوقت كل يوم. من الإطفاء الكامل ما يصير.
  $wa = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c exit'
  $wt = New-ScheduledTaskTrigger -Daily -At $wake
  $ws = New-ScheduledTaskSettingsSet -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName 'AqsaOfficeWake' -Action $wa -Trigger $wt -Settings $ws -Force | Out-Null
  powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_SLEEP RTCWAKE 1 | Out-Null
  powercfg /SETDCVALUEINDEX SCHEME_CURRENT SUB_SLEEP RTCWAKE 1 | Out-Null
  powercfg /SETACTIVE SCHEME_CURRENT | Out-Null
}

Start-ScheduledTask -TaskName 'AqsaOffice'
Write-Host ''
Write-Host 'خلص التنصيب. لازم توصلك رسالة بتلغرام: «اللابتوب اشتغل وبرنامج المكتب متصل».' -ForegroundColor Green
Write-Host "أي ملف تحطه بـ $folder ينطبع وحده."
Read-Host 'دوس Enter حتى تسد'
