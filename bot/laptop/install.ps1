# تنصيب برنامج مكتب أقصى الفرات على اللابتوب (مرة وحدة، ونفسه للتحديث).
# يشتغل من install.cmd. يسأل عن رابط الوسيط والرمز ومجلد الطباعة ووقت التشغيل اليومي،
# وينصّب مصنع المناقصات (Python ومكتباته) ويسوي مجلد «مصنع المناقصات» بالدرايف.

$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:APPDATA 'AqsaOffice'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$cfgPath = Join-Path $dir 'config.json'
$old = $null
if (Test-Path $cfgPath) { $old = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json }

function Ask($q, $default) {
  if ($default) { $q = "$q (Enter = $default)" }
  $a = Read-Host $q
  if (-not $a) { $a = $default }
  return "$a".Trim()
}

Write-Host ''
Write-Host '=== تنصيب برنامج مكتب أقصى الفرات ===' -ForegroundColor Yellow
if ($old) { Write-Host 'لكيت تنصيب سابق: دوس Enter بكل سؤال حتى تبقى القيم نفسها.' -ForegroundColor Cyan }

$defWorker = 'https://aqsa-bot.companyaqsaalfurat.workers.dev'
if ($old -and $old.worker) { $defWorker = $old.worker }
$worker = (Ask 'رابط الوسيط' $defWorker) -replace '/office/?$', ''
$pin = ''
if ($old -and $old.pin) { $pin = Read-Host 'رمز المكتب (Enter = نفس الرمز السابق)' } else { $pin = Read-Host 'رمز المكتب (نفس OFFICE_PIN)' }
if (-not $pin -and $old) { $pin = $old.pin }
# رمز التحديث: نفس UPDATE_KEY ببيئة جلسة Claude. اللابتوب ما يقبل أي تحديث عن بعد إلا موقّع بيه
if ($old -and $old.updateKey) { $ukey = Read-Host 'رمز التحديث (Enter = نفس الرمز السابق)' } else { $ukey = Read-Host 'رمز التحديث (نفس UPDATE_KEY، فارغ = بلا تحديث عن بعد)' }
if (-not $ukey -and $old) { $ukey = $old.updateKey }

$drive = @('G:\My Drive', 'G:\محرك Drive الخاص بي', "$env:USERPROFILE\Google Drive", "$env:USERPROFILE\My Drive") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($drive) { Write-Host "✓ لكيت Google Drive: $drive" -ForegroundColor Green }
else { Write-Host '⚠️ ما لكيت Google Drive للكمبيوتر. المصنع يشتغل، بس الحزم تنحفظ على اللابتوب وما ترتفع للدرايف وحدها.' -ForegroundColor Yellow }

if ($drive) { $defPrint = Join-Path $drive 'للطباعة' } else { $defPrint = Join-Path ([Environment]::GetFolderPath('Desktop')) 'للطباعة' }
if ($old -and $old.printFolder) { $defPrint = $old.printFolder }
$folder = Ask 'مجلد الطباعة' $defPrint

if ($drive) { $defData = Join-Path $drive 'مصنع المناقصات' } else { $defData = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'مصنع المناقصات' }
if ($old -and $old.factoryData) { $defData = $old.factoryData }
$data = Ask 'مجلد مصنع المناقصات' $defData

# المجلدات اللي Claude يكدر يشتغل بيها من الجلسة (تصفح، سحب، حط ملفات). مجلد الطباعة والمصنع دائماً مسموحين.
$defAllow = @($drive, [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('MyDocuments'), (Join-Path $env:USERPROFILE 'Downloads')) | Where-Object { $_ }
if ($old -and $old.allow) { $defAllow = @($old.allow) }
Write-Host ''
Write-Host 'المجلدات المسموحة لـ Claude:' -ForegroundColor Cyan
$defAllow | ForEach-Object { Write-Host "  $_" }
$allowIn = Read-Host 'Enter = هذني. أو اكتب مجلداتك مفصولة بـ ;'
if ($allowIn) { $allow = $allowIn.Split(';') | ForEach-Object { $_.Trim() } | Where-Object { $_ } } else { $allow = $defAllow }

$defWake = ''
if ($old -and $old.wake) { $defWake = $old.wake }
$wake = Ask 'وقت يگعد بيه اللابتوب كل يوم إذا نايم (مثل 07:45، فارغ = بلا)' $defWake

# ------------------------------------------------------------ Python ومصنع المناقصات
function Find-Python {
  foreach ($c in @('py', 'python', 'python3')) {
    $cmd = Get-Command $c -ErrorAction SilentlyContinue
    if (-not $cmd) { continue }
    try {
      if ($c -eq 'py') { $exe = (& py -3 -c 'import sys;print(sys.executable)' 2>$null) } else { $exe = (& $c -c 'import sys;print(sys.executable)' 2>$null) }
      if ($exe -and (Test-Path $exe) -and $exe -notlike '*WindowsApps*') { return "$exe".Trim() }
    } catch {}
  }
  foreach ($p in @("$env:LOCALAPPDATA\Programs\Python\Python312\python.exe", "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe", "$env:ProgramFiles\Python312\python.exe")) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

Write-Host ''
Write-Host 'تنصيب مصنع المناقصات…' -ForegroundColor Yellow
$py = Find-Python
if (-not $py) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host 'Python مو منصّب، راح أنصّبه (يحتاج إنترنت، دقيقة أو دقيقتين)…'
    winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements | Out-Host
    $py = Find-Python
  }
}
$factoryOk = $false
if ($py) {
  Write-Host "✓ Python: $py" -ForegroundColor Green
  Write-Host 'تنصيب المكتبات (python-docx, openpyxl, python-pptx, pypdf, reportlab, pillow, pywin32)…'
  & $py -m pip install --user --quiet --disable-pip-version-check python-docx openpyxl python-pptx pypdf reportlab pillow pywin32 | Out-Host
  $fdst = Join-Path $dir 'factory'
  New-Item -ItemType Directory -Force -Path $fdst | Out-Null
  Copy-Item -Path (Join-Path $PSScriptRoot 'factory\*.py') -Destination $fdst -Force
  New-Item -ItemType Directory -Force -Path $data | Out-Null
  $env:PYTHONIOENCODING = 'utf-8'
  $seed = & $py -c "import sys; sys.path.insert(0, r'$fdst'); import seed; print(seed.create(r'$data'))" 2>&1
  Write-Host "✓ مجلد المصنع: $data" -ForegroundColor Green
  if ("$seed" -match '\[\]') { Write-Host '  (الملفات موجودة من قبل، ما تغيّر شي)' } else { Write-Host "  انسوّت: $seed" }
  $factoryOk = $true
} else {
  Write-Host '⚠️ ما كدرت أنصّب Python. نصّبه من python.org (علّم Add to PATH) وأعد التنصيب. باقي البرنامج يشتغل.' -ForegroundColor Yellow
}
if (-not (Get-Command winword.exe -ErrorAction SilentlyContinue) -and -not (Test-Path "$env:ProgramFiles\Microsoft Office")) {
  Write-Host '⚠️ ما لكيت Microsoft Word. المصنع يحتاج Word (أو LibreOffice) حتى يطلّع PDF.' -ForegroundColor Yellow
}

@{ worker = $worker; pin = $pin.Trim(); printFolder = $folder; factoryData = $data; python = $(if ($factoryOk) { $py } else { '' });
   allow = @($allow); wake = $wake; updateKey = "$ukey".Trim() } | ConvertTo-Json | Set-Content -Path $cfgPath -Encoding UTF8
# يوكّف أي نسخة شغّالة من البرنامج (والـ launcher) قبل ما نبدّل الملفات
Stop-ScheduledTask -TaskName 'AqsaOffice' -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*AqsaOffice\agent.ps1*' -or $_.CommandLine -like '*AqsaOffice\launcher.ps1*' } |
  ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null }
foreach ($f in @('agent.ps1', 'launcher.ps1', 'VERSION')) {
  Copy-Item -Path (Join-Path $PSScriptRoot $f) -Destination (Join-Path $dir $f) -Force
}
New-Item -ItemType Directory -Force -Path $folder | Out-Null

# يشتغل وحده كل ما تدخل للويندوز، مخفي، ويرجع يشتغل إذا وكف.
# المهمة تشغّل launcher.ps1، وهو يشغّل agent.ps1 ويرجّع النسخة القديمة إذا تحديث خرب
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $dir 'launcher.ps1') + '"')
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
$ver = (Get-Content (Join-Path $dir 'VERSION') -Raw).Trim()
Write-Host "خلص التنصيب (نسخة $ver). لازم توصلك رسالة بتلغرام: «اللابتوب اشتغل وبرنامج المكتب متصل»." -ForegroundColor Green
Write-Host "• أي ملف تحطه بـ $folder ينطبع وحده."
if ($factoryOk) { Write-Host "• مناقصة: عبّي «طلب مناقصة.xlsx» من $data وحطه بمجلد «طلبات» أو دزه للبوت." }
Write-Host '• المهم قبل أول مناقصة: افتح الشركات.json وتأكد من «نموذج_الكتاب» و«الرقم_التالي»، وعبّي مستمسكات.xlsx.'
Read-Host 'دوس Enter حتى تسد'
