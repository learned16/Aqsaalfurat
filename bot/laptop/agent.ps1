# برنامج مكتب أقصى الفرات على اللابتوب (ويندوز). ما يستخدم Claude، فما يصرف توكنز.
#
# يسأل وسيط Cloudflare كل 5 ثواني عن الأوامر وينفّذها:
#   - أوامر المكتب (من البوت أو المكتب الافتراضي): طباعة، رسالة، قفل، نوم، إعادة تشغيل، طفي
#   - مصنع المناقصات: طلب مناقصة (xlsx) ينبني حزمة كاملة وينحفظ بالأرشيف بالدرايف
#   - «إيد Claude»: مكتبة أوامر ثابتة من جلسة Claude، داخل المجلدات المسموحة بس، وماكو تشغيل كود عشوائي:
#       🟢 فوراً: تصفح، سحب ملف، حط ملف، PDF، طباعة، المصنع، حالة اللابتوب، الطابعات، zip، السجل
#       🟡 بموافقة صاحب البوت بتلغرام (الوسيط يمسكها لحد ما يوافق): تنصيب برنامج من قائمة ثابتة،
#          الطابعة الافتراضية، إلغاء طابور الطباعة، سد Word، صورة الشاشة، وقت التصحية،
#          وتحديث البرنامج نفسه (حزمة موقّعة برمز التحديث، والنسخة القديمة تنحفظ وترجع إذا الجديدة خربت)
# ويراقب مجلدين: «للطباعة» (أي ملف ينطبع) و«مصنع المناقصات\طلبات» (أي طلب ينبني).
# ما يحذف أي ملف: المطبوع ينتقل لـ«انطبع»، والطلب لـ«تم» أو «فشل»، وأي ملف يتبدل تنحفظ نسخته القديمة.
# الإعدادات بـ %APPDATA%\AqsaOffice\config.json (يسويها install.ps1). يشتغل من launcher.ps1.

$ErrorActionPreference = 'Continue'
$dir = Join-Path $env:APPDATA 'AqsaOffice'
$cfg = Get-Content (Join-Path $dir 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$base = $cfg.worker.TrimEnd('/')
$headers = @{ 'X-Office-Pin' = $cfg.pin }
$printDir = $cfg.printFolder
$doneDir = Join-Path $printDir 'انطبع'
$failDir = Join-Path $printDir 'ما انطبع'
New-Item -ItemType Directory -Force -Path $printDir, $doneDir, $failDir | Out-Null
$logFile = Join-Path $dir 'agent.log'
$factory = Join-Path $dir 'factory\factory.py'
$dataDir = $cfg.factoryData
$python = $cfg.python
$jobsDir = $null
if ($dataDir) {
  $jobsDir = Join-Path $dataDir 'طلبات'
  New-Item -ItemType Directory -Force -Path $jobsDir, (Join-Path $jobsDir 'تم'), (Join-Path $jobsDir 'فشل') | Out-Null
}
# المجلدات اللي Claude يكدر يشتغل بيها (+ مجلد الطباعة ومجلد المصنع دائماً)
$allow = @()
foreach ($a in @($cfg.allow) + @($printDir, $dataDir)) { if ($a) { $allow += [IO.Path]::GetFullPath($a).TrimEnd('\') + '\' } }
# Google Drive للكمبيوتر: إذا انصّب بعد التنصيب، ينضاف وحده للمجلدات المسموحة (بدون إعادة تنصيب)
# (الدرايف يتأخر بعد تشغيل الويندوز، فـ Allowed-Path يعيد المحاولة إذا ما لكاه أول مرة)
function Add-DriveRoot {
  $root = @('G:\My Drive', 'G:\محرك Drive الخاص بي', "$env:USERPROFILE\Google Drive", "$env:USERPROFILE\My Drive") |
    Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $root) { return $false }
  $d = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
  if ($script:allow -notcontains $d) { $script:allow += $d; return $true }
  return $false
}
Add-DriveRoot | Out-Null
# الطباعة والتحويل لهاي الأنواع بس (مستندات، مو برامج)
$docExt = @('.pdf', '.doc', '.docx', '.rtf', '.txt', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff')
# البرامج اللي يكدر Claude ينصّبها (بموافقة): الاسم ← معرّف winget
$installable = @{
  'sumatra'     = 'SumatraPDF.SumatraPDF'
  'libreoffice' = 'TheDocumentFoundation.LibreOffice'
  'python'      = 'Python.Python.3.12'
  'gdrive'      = 'Google.GoogleDrive'
  '7zip'        = '7zip.7zip'
  'chrome'      = 'Google.Chrome'
  'acrobat'     = 'Adobe.Acrobat.Reader.64-bit'
  'edge'        = 'Microsoft.Edge'
  'firefox'     = 'Mozilla.Firefox'
  'notepadpp'   = 'Notepad++.Notepad++'
  'vlc'         = 'VideoLAN.VLC'
  'zoom'        = 'Zoom.Zoom'
  'anydesk'     = 'AnyDeskSoftwareGmbH.AnyDesk'
  'winrar'      = 'RARLab.WinRAR'
  'office'      = 'Microsoft.Office'
}
$started = Get-Date
$utf8 = New-Object Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8
$version = '0'
$versionFile = Join-Path $dir 'VERSION'
if (Test-Path -LiteralPath $versionFile) { $version = (Get-Content -LiteralPath $versionFile -Raw -Encoding UTF8).Trim() }
$pendFile = Join-Path $dir 'update-pending.json'
$rollFile = Join-Path $dir 'update-rollback.json'
$restartNow = $false

function Log($m) {
  Add-Content -Path $logFile -Value ('{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $m) -Encoding UTF8
}

function Post-Json($path, $obj) {
  $body = $utf8.GetBytes(($obj | ConvertTo-Json -Compress -Depth 8))
  Invoke-RestMethod -Uri "$base$path" -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $body -TimeoutSec 60
}

# $chat = معرّف تلغرام اللي دز الأمر من البوت، حتى ترجعله النتيجة. $print = ملف يطلع جنبه زر «اطبع»
function Report($text, $chat = '', $print = '') {
  try { Post-Json '/office/done' @{ text = $text; chat = "$chat"; print = "$print" } | Out-Null } catch { Log "report failed: $_" }
}

function Print-File($path) {
  $ext = [IO.Path]::GetExtension($path).ToLower()
  if ($docExt -notcontains $ext) { throw "نوع الملف ما ينطبع: $ext" }
  $sumatra = @("$env:LOCALAPPDATA\SumatraPDF\SumatraPDF.exe", "$env:ProgramFiles\SumatraPDF\SumatraPDF.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($ext -eq '.pdf' -and $sumatra) {
    $p = Start-Process $sumatra -ArgumentList '-print-to-default', '-silent', "`"$path`"" -PassThru
  } elseif ($ext -eq '.txt') {
    $p = Start-Process notepad.exe -ArgumentList '/p', "`"$path`"" -PassThru
  } else {
    # Word وPDF والصور تنطبع بالبرنامج المنصّب إلها
    $p = Start-Process -FilePath $path -Verb Print -PassThru
  }
  if ($p) { $p | Wait-Process -Timeout 120 -ErrorAction SilentlyContinue }
}

function Print-TestPage {
  $f = Join-Path $env:TEMP 'aqsa-test-page.txt'
  $text = "شركة أقصى الفرات للمقاولات العامة`r`nصفحة تجربة من المكتب الافتراضي`r`n" + (Get-Date -Format 'yyyy-MM-dd HH:mm')
  [IO.File]::WriteAllText($f, $text, (New-Object Text.UTF8Encoding $true))
  Print-File $f
}

function Show-Message($text) {
  # نافذة على الشاشة 60 ثانية، بعملية منفصلة حتى ما توكف البرنامج
  $safe = $text.Replace("'", "''")
  $cmd = "(New-Object -ComObject WScript.Shell).Popup('$safe', 60, 'مكتب أقصى الفرات', 64) | Out-Null"
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', $cmd
}

function Safe-Name($name, $fallback) {
  $n = ("$name" -replace '[\\/:*?"<>|]', '-').Trim()
  if (-not $n) { $n = $fallback }
  return $n
}

# ملف دزّه البوت (محفوظ بالوسيط): ينزل لمسار مؤقت
function Fetch-File($c) {
  $name = Safe-Name $c.name 'ملف'
  $tmp = Join-Path $env:TEMP ('aqsa-' + $c.file + [IO.Path]::GetExtension($name))
  Invoke-WebRequest -Uri "$base/office/file?id=$($c.file)" -Headers $headers -OutFile $tmp -TimeoutSec 120 -UseBasicParsing
  return $tmp
}

# ملف دزّه البوت للطباعة: ينطبع، وبعدين ينحفظ بمجلد «انطبع» أو «ما انطبع»
function Print-BotFile($c) {
  $name = Safe-Name $c.name 'ملف'
  $stamp = Get-Date -Format 'yyyyMMdd-HHmm-'
  $tmp = Fetch-File $c
  try {
    Print-File $tmp
    Move-Item -LiteralPath $tmp -Destination (Join-Path $doneDir ($stamp + $name)) -Force
    Report "🖨️ انطبع: $name" $c.chat
  } catch {
    Log "print failed $name : $_"
    Move-Item -LiteralPath $tmp -Destination (Join-Path $failDir ($stamp + $name)) -Force -ErrorAction SilentlyContinue
    Report "⚠️ ما انطبع: $name (انحط بمجلد «ما انطبع» باللابتوب)" $c.chat
  }
}

# ------------------------------------------------------------------ مصنع المناقصات

# أوامر المصنع المسموحة بس (المصنع برنامج ثابت منصّب ويه البرنامج)
function Run-Factory([string[]]$fargs) {
  if (-not $python -or -not (Test-Path $factory)) { throw 'مصنع المناقصات مو منصّب (Python ناقص). أعد التنصيب.' }
  if (@('build', 'check', 'docs') -notcontains $fargs[0]) { throw "أمر مصنع غير مسموح: $($fargs[0])" }
  $env:PYTHONIOENCODING = 'utf-8'
  $all = @($factory) + $fargs
  if ($dataDir -and ($fargs -notcontains '--data')) { $all += @('--data', $dataDir) }
  $out = & $python @all 2>&1 | ForEach-Object { "$_" }
  $last = ($out | Where-Object { $_ -like '{*' } | Select-Object -Last 1)
  if (-not $last) { throw ('المصنع ما رجّع نتيجة: ' + (($out | Select-Object -Last 5) -join ' | ')) }
  return ($last | ConvertFrom-Json)
}

function Tender-Summary($r) {
  if (-not $r.ok) {
    return '⚠️ ما انبنت المناقصة:' + "`n• " + (@($r.errors) -join "`n• ")
  }
  $t = "📦 جاهزة: $($r.title)`n$($r.number) — $($r.company)`n💰 المجموع: $($r.total) دينار`n($($r.total_words))"
  $t += "`n📄 $($r.pages) صفحة. الأرقام الصادرة: " + (@($r.numbers) -join '، ')
  if ($r.folder) { $t += "`n📁 انحفظت بالأرشيف: " + (Split-Path $r.folder -Leaf) }
  if (@($r.warnings).Count) { $t += "`n`n⚠️ تنبيهات:`n• " + (@($r.warnings) -join "`n• ") }
  if (@($r.remaining).Count) { $t += "`n`n📋 على الشركة:`n• " + (@($r.remaining) -join "`n• ") }
  return $t
}

function Build-Tender($jobPath, $chat) {
  $name = Split-Path $jobPath -Leaf
  Report "⚙️ المصنع بدأ يبني: $name" $chat
  $stamp = Get-Date -Format 'yyyyMMdd-HHmm-'
  try {
    $r = Run-Factory @('build', $jobPath)
  } catch {
    $r = [pscustomobject]@{ ok = $false; errors = @("$_") }
  }
  if ($jobsDir -and (Split-Path $jobPath -Parent) -eq $jobsDir) {
    $to = 'فشل'
    if ($r.ok) { $to = 'تم' }
    Move-Item -LiteralPath $jobPath -Destination (Join-Path (Join-Path $jobsDir $to) ($stamp + $name)) -Force -ErrorAction SilentlyContinue
  }
  $pdf = ''
  if ($r.ok) { $pdf = $r.pdf }
  Report (Tender-Summary $r) $chat $pdf
  return $r
}

function Watch-Jobs {
  if (-not $jobsDir) { return }
  Get-ChildItem -Path $jobsDir -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in '.xlsx', '.json' -and $_.Name -notlike '~$*' -and $_.LastWriteTime -lt (Get-Date).AddSeconds(-10) } |
    ForEach-Object { Build-Tender $_.FullName '' | Out-Null }
}

# تنبيه المستمسكات والكفالات: مرة باليوم بعد الساعة 8 الصبح
$lastDocsDay = ''
function Daily-Docs {
  if (-not $dataDir -or -not $python) { return }
  $today = Get-Date -Format 'yyyy-MM-dd'
  if ($today -eq $script:lastDocsDay -or (Get-Date).Hour -lt 8) { return }
  $script:lastDocsDay = $today
  try {
    $r = Run-Factory @('docs', '--days', '30')
    $list = @($r.expiring)
    if ($list.Count) {
      $lines = $list | ForEach-Object {
        if ($_.days -lt 0) { "• $($_.name) ($($_.company)): منتهي من $(-$_.days) يوم" } else { "• $($_.name) ($($_.company)): باقي $($_.days) يوم ($($_.expiry))" }
      }
      Report ("⏰ مستمسكات تنتهي أو منتهية:`n" + ($lines -join "`n"))
    }
  } catch { Log "docs: $_" }
}

# ------------------------------------------------------------------- إيد Claude

function Allowed-Path($p) {
  if (-not $p) { throw 'المسار فارغ' }
  $full = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($p))
  foreach ($try in 1..2) {
    foreach ($a in $allow) {
      if (($full.TrimEnd('\') + '\').StartsWith($a, [StringComparison]::OrdinalIgnoreCase)) { return $full }
    }
    # يمكن الدرايف اشتغل بعد البرنامج: نضيفه ونعيد مرة وحدة
    if (-not (Add-DriveRoot)) { break }
  }
  throw "المسار خارج المجلدات المسموحة: $full"
}

function Backup-Existing($full) {
  if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { return $null }
  $root = ($allow | Where-Object { ($full + '\').StartsWith($_, [StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1)
  $bdir = Join-Path $root '_نسخ_قبل_التعديل'
  New-Item -ItemType Directory -Force -Path $bdir | Out-Null
  $dest = Join-Path $bdir ((Get-Date -Format 'yyyyMMdd-HHmmss-') + (Split-Path $full -Leaf))
  Copy-Item -LiteralPath $full -Destination $dest -Force
  return $dest
}

function Word-ToPdf($src, $dst) {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  try {
    $doc = $word.Documents.Open($src, $false, $true)
    $doc.ExportAsFixedFormat($dst, 17)
    $doc.Close($false)
  } finally { $word.Quit() }
}

function Excel-ToPdf($src, $dst) {
  $xl = New-Object -ComObject Excel.Application
  $xl.Visible = $false
  $xl.DisplayAlerts = $false
  try {
    $wb = $xl.Workbooks.Open($src, 0, $true)
    $wb.ExportAsFixedFormat(0, $dst)  # 0 = xlTypePDF
    $wb.Close($false)
  } finally { $xl.Quit() }
}

function PowerPoint-ToPdf($src, $dst) {
  $pp = New-Object -ComObject PowerPoint.Application
  try {
    $prs = $pp.Presentations.Open($src, $true, $false, $false)
    $prs.SaveAs($dst, 32)  # 32 = ppSaveAsPDF
    $prs.Close()
  } finally { $pp.Quit() }
}

# يحوّل أي ملف Office لـ PDF بالبرنامج الحقيقي، حتى الترويسة والختم يطلعون مثل ما هم
function Office-ToPdf($src, $dst) {
  switch ([IO.Path]::GetExtension($src).ToLower()) {
    { @('.doc', '.docx', '.rtf') -contains $_ } { Word-ToPdf $src $dst; return 'Word' }
    { @('.xls', '.xlsx', '.xlsm', '.csv') -contains $_ } { Excel-ToPdf $src $dst; return 'Excel' }
    { @('.ppt', '.pptx') -contains $_ } { PowerPoint-ToPdf $src $dst; return 'PowerPoint' }
    default { throw 'التحويل لملفات Word وExcel وPowerPoint بس' }
  }
}

function Pc-Op($c) {
  $a = $c.args
  if ($c.argsRef) { $a = Invoke-RestMethod -Uri "$base/pc/args?id=$($c.id)" -Headers $headers -TimeoutSec 120 }
  switch ($c.op) {
    'roots' { return @{ roots = $allow; data = $dataDir; print = $printDir; python = [bool]$python } }
    'ls' {
      $p = Allowed-Path $a.path
      $items = Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Select-Object -First 500 | ForEach-Object {
        @{ name = $_.Name; dir = $_.PSIsContainer; size = $(if ($_.PSIsContainer) { 0 } else { $_.Length }); modified = $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm') }
      }
      return @{ path = $p; items = @($items) }
    }
    'find' {
      $p = Allowed-Path $a.path
      $pat = $a.pattern
      if (-not $pat) { $pat = '*' }
      $hits = Get-ChildItem -LiteralPath $p -Recurse -Force -Filter $pat -ErrorAction SilentlyContinue | Select-Object -First 200 |
        ForEach-Object { @{ path = $_.FullName; dir = $_.PSIsContainer; size = $(if ($_.PSIsContainer) { 0 } else { $_.Length }) } }
      return @{ hits = @($hits) }
    }
    'get' {
      $p = Allowed-Path $a.path
      $f = Get-Item -LiteralPath $p -ErrorAction Stop
      if ($f.Length -gt 15MB) { throw 'الملف أكبر من 15 ميغا' }
      return @{ path = $p; name = $f.Name; b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($p)) }
    }
    'put' {
      $p = Allowed-Path $a.path
      New-Item -ItemType Directory -Force -Path (Split-Path $p -Parent) | Out-Null
      $old = Backup-Existing $p
      [IO.File]::WriteAllBytes($p, [Convert]::FromBase64String($a.b64))
      return @{ path = $p; backup = $old }
    }
    'mkdir' { $p = Allowed-Path $a.path; New-Item -ItemType Directory -Force -Path $p | Out-Null; return @{ path = $p } }
    'copy' {
      $src = Allowed-Path $a.from
      $dst = Allowed-Path $a.to
      $old = Backup-Existing $dst
      Copy-Item -LiteralPath $src -Destination $dst -Force -Recurse
      return @{ path = $dst; backup = $old }
    }
    'pdf' {
      $src = Allowed-Path $a.path
      $dst = $a.out
      if (-not $dst) { $dst = [IO.Path]::ChangeExtension($src, '.pdf') }
      $dst = Allowed-Path $dst
      $old = Backup-Existing $dst
      $app = Office-ToPdf $src $dst
      return @{ path = $dst; backup = $old; app = $app }
    }
    'print' { $p = Allowed-Path $a.path; Print-File $p; return @{ printed = $p } }
    'tender' {
      if ($a.b64) {
        $job = Join-Path $env:TEMP ('aqsa-job-' + $c.id + '.xlsx')
        if ("$($a.name)" -like '*.json') { $job = [IO.Path]::ChangeExtension($job, '.json') }
        [IO.File]::WriteAllBytes($job, [Convert]::FromBase64String($a.b64))
      } else { $job = Allowed-Path $a.path }
      $fargs = @('build', $job)
      if ($a.dry) { $fargs += '--dry' }
      $r = Run-Factory $fargs
      if (-not $a.quiet) {
        $pdf = ''
        if ($r.ok) { $pdf = $r.pdf }
        Report (Tender-Summary $r) '' $pdf
      }
      return $r
    }
    'check' { return Run-Factory @('check', (Allowed-Path $a.path)) }
    'docs'  { return Run-Factory @('docs', '--days', "$($a.days)") }
    # ------------------------------------------------ 🟢 مكتبة: معلومات
    'status'   { return (Laptop-Status) }
    'printers' { return @{ printers = @(Printer-List) } }
    'log' {
      $n = [int]$a.lines
      if ($n -le 0 -or $n -gt 500) { $n = 80 }
      return @{ lines = @(Get-Content -LiteralPath $logFile -Tail $n -Encoding UTF8 -ErrorAction SilentlyContinue) }
    }
    'zip' {
      $src = Allowed-Path $a.path
      $dst = $a.out
      if (-not $dst) { $dst = $src.TrimEnd('\') + '.zip' }
      $dst = Allowed-Path $dst
      if ([IO.Path]::GetExtension($dst).ToLower() -ne '.zip') { throw 'الناتج لازم .zip' }
      $old = Backup-Existing $dst
      Compress-Archive -LiteralPath $src -DestinationPath $dst -CompressionLevel Optimal -Force  # القديم انحفظ فوك
      return @{ path = $dst; size = (Get-Item -LiteralPath $dst).Length; backup = $old }
    }
    # ------------------------------------- 🟡 مكتبة: توصل هنا بس بعد موافقة صاحب البوت
    'install' {
      $name = "$($a.name)".ToLower()
      if (-not $installable.ContainsKey($name)) { throw ('مو بالقائمة المسموحة. المسموح: ' + (($installable.Keys | Sort-Object) -join ', ')) }
      if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'winget مو موجود على اللابتوب' }
      $out = & winget install -e --id $installable[$name] --silent --accept-package-agreements --accept-source-agreements 2>&1 | Out-String
      $tail = ($out.Trim() -split "`n" | Select-Object -Last 3) -join "`n"
      Report ("📦 تنصيب $name`n" + $tail)
      return @{ name = $name; output = $out.Substring([Math]::Max(0, $out.Length - 3000)) }
    }
    'default_printer' {
      $p = Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq "$($a.name)" } | Select-Object -First 1
      if (-not $p) { throw ('ماكو طابعة بهذا الاسم. الموجود: ' + ((Printer-List | ForEach-Object { $_.name }) -join ' | ')) }
      Invoke-CimMethod -InputObject $p -MethodName SetDefaultPrinter | Out-Null
      Report "🖨️ صارت الطابعة الافتراضية: $($p.Name)"
      return @{ default = $p.Name }
    }
    'clear_queue' {
      $n = 0
      Get-Printer -ErrorAction SilentlyContinue | ForEach-Object {
        Get-PrintJob -PrinterObject $_ -ErrorAction SilentlyContinue | ForEach-Object { Remove-PrintJob -InputObject $_ -ErrorAction SilentlyContinue; $n++ }
      }
      Report "🧹 انلغت $n ورقة عالقة بطابور الطباعة"
      return @{ removed = $n }
    }
    'close_word' {
      $procs = @(Get-Process -Name WINWORD -ErrorAction SilentlyContinue)
      $procs | Stop-Process -Force -ErrorAction SilentlyContinue
      Report "📝 انسد Word ($($procs.Count))"
      return @{ closed = $procs.Count }
    }
    'screenshot' {
      Add-Type -AssemblyName System.Windows.Forms, System.Drawing
      $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
      $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
      # نصغّرها حتى تكون خفيفة
      $w = [Math]::Min(1280, $b.Width)
      $h = [int]($b.Height * $w / $b.Width)
      $small = New-Object System.Drawing.Bitmap $bmp, $w, $h
      $ms = New-Object IO.MemoryStream
      $small.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
      $g.Dispose(); $bmp.Dispose(); $small.Dispose()
      Report '📸 انأخذت صورة للشاشة لـ Claude'
      return @{ name = 'screen.png'; b64 = [Convert]::ToBase64String($ms.ToArray()) }
    }
    'wake_time' {
      $t = "$($a.time)"
      if ($t -notmatch '^([01]\d|2[0-3]):[0-5]\d$') { throw 'الوقت لازم HH:mm مثل 07:45' }
      $wa = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c exit'
      $wt = New-ScheduledTaskTrigger -Daily -At $t
      $ws = New-ScheduledTaskSettingsSet -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
      Register-ScheduledTask -TaskName 'AqsaOfficeWake' -Action $wa -Trigger $wt -Settings $ws -Force | Out-Null
      Report "⏰ صار وقت التصحية اليومي $t"
      return @{ wake = $t }
    }
    'office' {
      if (-not $python) { throw 'Python ناقص (المصنع مو منصّب)' }
      $req = @{}
      foreach ($k in $a.PSObject.Properties.Name) { $req[$k] = $a.$k }
      # كل حقل مسار يتأكد إنه داخل المجلدات المسموحة قبل ما يوصل لـ office.py
      foreach ($k in @('path', 'out', 'out_dir')) {
        if ($req[$k]) { $req[$k] = Allowed-Path $req[$k] }
      }
      if ($req['paths']) {
        $req['paths'] = @(foreach ($p in @($req['paths'])) { Allowed-Path $p })
      }
      # أوامر الكتابة تحفظ النسخة القديمة أول (الناتج الجديد أو الملف اللي يتعدّل)
      $writes = @('xlsx_set', 'xlsx_append', 'xlsx_add_sheet', 'docx_replace', 'docx_append',
        'pptx_replace', 'pptx_add')
      if ($writes -contains "$($a.op)") { Backup-Existing $req['path'] | Out-Null }
      if ($req['out']) { Backup-Existing $req['out'] | Out-Null }
      $reqFile = Join-Path $env:TEMP ('aqsa-office-' + $c.id + '.json')
      [IO.File]::WriteAllText($reqFile, ($req | ConvertTo-Json -Depth 8 -Compress), $utf8)
      $env:PYTHONIOENCODING = 'utf-8'
      $out = & $python (Join-Path $dir 'factory\office.py') $reqFile 2>&1 | ForEach-Object { "$_" }
      Remove-Item -LiteralPath $reqFile -Force -ErrorAction SilentlyContinue
      $last = ($out | Where-Object { $_ -like '{*' } | Select-Object -Last 1)
      if (-not $last) { throw ('office ما رجّع نتيجة: ' + (($out | Select-Object -Last 5) -join ' | ')) }
      $r = $last | ConvertFrom-Json
      if (-not $r.ok) { throw "office: $($r.error)" }
      return $r
    }
    # ------------------------------------- 🟡 فتح رابط بالمتصفح (بموافقة صاحب البوت)
    'open_url' {
      $u = "$($a.url)"
      if ($u -notmatch '^https?://') { throw 'الرابط لازم يبدي بـ http:// أو https://' }
      Start-Process $u | Out-Null
      Report "🌐 انفتح الرابط باللابتوب: $u"
      return @{ opened = $u }
    }
    'update' { return (Apply-Update $a) }
    default { throw "أمر غير معروف: $($c.op)" }
  }
}

# ------------------------------------------------------------ التحديث عن بعد

# الملفات اللي يبدّلها التحديث بس: agent.ps1 وVERSION وfactory\*.py (launcher.ps1 والإعدادات ما تتغير)
function Copy-Program($from, $to) {
  New-Item -ItemType Directory -Force -Path $to | Out-Null
  foreach ($f in @('agent.ps1', 'VERSION')) {
    $src = Join-Path $from $f
    if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $to $f) -Force }
  }
  $fsrc = Join-Path $from 'factory'
  if (Test-Path -LiteralPath $fsrc) {
    $fdst = Join-Path $to 'factory'
    New-Item -ItemType Directory -Force -Path $fdst | Out-Null
    Get-ChildItem -LiteralPath $fsrc -Filter '*.py' -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $fdst $_.Name) -Force }
  }
}

function Hex($bytes) { return -join ($bytes | ForEach-Object { $_.ToString('x2') }) }

# a = {version, file, sha256, sig, notes}. يوصل هنا بس بعد موافقة صاحب البوت بتلغرام.
function Apply-Update($a) {
  if (-not $cfg.updateKey) { throw 'رمز التحديث مو مضبوط باللابتوب (أعد التنصيب واكتب رمز التحديث)' }
  $ver = "$($a.version)".Trim()
  if ($ver -notmatch '^\d+(\.\d+){1,3}$') { throw "رقم النسخة غلط: $ver" }
  if ($version -match '^\d+(\.\d+){1,3}$' -and [version]$ver -le [version]$version) { throw "النسخة $ver مو أحدث من الحالية $version" }
  $zip = Allowed-Path $a.file
  if ([IO.Path]::GetExtension($zip).ToLower() -ne '.zip') { throw 'التحديث لازم ملف .zip' }
  $sha = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
  if ($sha -ne "$($a.sha256)".ToLower()) { throw 'بصمة الملف ما تطابق (الملف تغيّر بالطريق)' }
  # التوقيع: HMAC-SHA256 برمز التحديث. بدونه ماكو أحد يكدر ينصّب شي حتى لو وصل للدرايف أو للوسيط
  $hm = [Security.Cryptography.HMACSHA256]::new($utf8.GetBytes([string]$cfg.updateKey))
  $expect = Hex ($hm.ComputeHash($utf8.GetBytes("aqsa-office|$ver|$sha")))
  if ($expect -ne "$($a.sig)".ToLower()) { throw 'التوقيع غلط: التحديث انرفض' }

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $stage = Join-Path $dir "_staging\$ver-$stamp"
  Expand-Archive -LiteralPath $zip -DestinationPath $stage -Force
  $newAgent = Join-Path $stage 'agent.ps1'
  if (-not (Test-Path -LiteralPath $newAgent)) { throw 'الحزمة ناقصها agent.ps1' }
  $sv = Join-Path $stage 'VERSION'
  if (-not (Test-Path -LiteralPath $sv) -or (Get-Content -LiteralPath $sv -Raw -Encoding UTF8).Trim() -ne $ver) { throw 'VERSION بالحزمة ما يطابق رقم النسخة' }
  # نفحص الكود قبل ما نبدّل: أي خطأ كتابة يوكّف التحديث والنسخة الحالية تبقى
  $tokens = $null; $errs = $null
  [Management.Automation.Language.Parser]::ParseFile($newAgent, [ref]$tokens, [ref]$errs) | Out-Null
  if ($errs -and $errs.Count) { throw ('agent.ps1 الجديد بيه خطأ: ' + $errs[0].Message) }
  if ($python) {
    $env:PYTHONIOENCODING = 'utf-8'
    foreach ($f in @(Get-ChildItem -LiteralPath (Join-Path $stage 'factory') -Filter '*.py' -File -ErrorAction SilentlyContinue)) {
      $out = & $python -c "import ast,sys; ast.parse(open(sys.argv[1],encoding='utf-8').read())" $f.FullName 2>&1
      if ($LASTEXITCODE -ne 0) { throw ("المصنع $($f.Name) بيه خطأ: " + (($out | Select-Object -Last 1) -join '')) }
    }
  }

  # النسخة الحالية تنحفظ، والـ launcher يرجّعها إذا الجديدة ما اشتغلت
  $backup = Join-Path $dir "versions\$version-$stamp"
  $n = 1
  while (Test-Path -LiteralPath $backup) { $backup = Join-Path $dir "versions\$version-$stamp-$n"; $n++ }
  Copy-Program $dir $backup
  Copy-Program $stage $dir
  @{ from = $version; to = $ver; backup = $backup; tries = 0; at = (Get-Date).ToString('yyyy-MM-dd HH:mm'); notes = "$($a.notes)" } |
    ConvertTo-Json | Set-Content -LiteralPath $pendFile -Encoding UTF8
  Log "update $version -> $ver applied, restarting"
  $script:restartNow = $true
  return @{ from = $version; to = $ver; backup = $backup; restarting = $true }
}

# بعد ما البرنامج يتصل بالوسيط: إذا جاي من تحديث نأكده، وإذا الـ launcher رجّع نسخة قديمة نبلّغ
function Confirm-Update {
  if (Test-Path -LiteralPath $pendFile) {
    $p = Get-Content -LiteralPath $pendFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ("$($p.to)" -eq $version) {
      Move-Item -LiteralPath $pendFile -Destination (Join-Path $dir 'update-last.json') -Force
      $t = "✅ تحدّث برنامج المكتب من $($p.from) إلى $version"
      if ($p.notes) { $t += "`n$($p.notes)" }
      Report $t
    }
  }
  if (Test-Path -LiteralPath $rollFile) {
    $p = Get-Content -LiteralPath $rollFile -Raw -Encoding UTF8 | ConvertFrom-Json
    Move-Item -LiteralPath $rollFile -Destination (Join-Path $dir 'update-last.json') -Force
    Report "⚠️ التحديث $($p.to) ما اشتغل، فرجعت النسخة $version وحدها"
  }
}

function Printer-List {
  $def = (Get-CimInstance Win32_Printer -Filter 'Default=True' -ErrorAction SilentlyContinue | Select-Object -First 1).Name
  Get-Printer -ErrorAction SilentlyContinue | ForEach-Object {
    $jobs = @(Get-PrintJob -PrinterObject $_ -ErrorAction SilentlyContinue).Count
    @{ name = $_.Name; default = ($_.Name -eq $def); status = "$($_.PrinterStatus)"; jobs = $jobs }
  }
}

function Laptop-Status {
  $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
  $disks = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null } | ForEach-Object {
    @{ drive = $_.Name; freeGB = [Math]::Round($_.Free / 1GB, 1) }
  }
  $bat = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
  $def = (Get-CimInstance Win32_Printer -Filter 'Default=True' -ErrorAction SilentlyContinue | Select-Object -First 1).Name
  $wordOk = [bool](Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Winword.exe' -ErrorAction SilentlyContinue)
  $waiting = 0
  if ($jobsDir) { $waiting = @(Get-ChildItem -Path $jobsDir -File -ErrorAction SilentlyContinue).Count }
  return @{
    computer = $env:COMPUTERNAME; user = $env:USERNAME; version = $version
    windows = "$($os.Caption)"; upSince = $(if ($os) { $os.LastBootUpTime.ToString('yyyy-MM-dd HH:mm') } else { '' })
    agentSince = $started.ToString('yyyy-MM-dd HH:mm')
    disks = @($disks)
    battery = $(if ($bat) { "$($bat.EstimatedChargeRemaining)%" } else { 'ماكو (كهرباء)' })
    defaultPrinter = $def; word = $wordOk; python = [bool]$python
    googleDrive = [bool](Get-Process -Name GoogleDriveFS -ErrorAction SilentlyContinue)
    printFolderWaiting = @(Get-ChildItem -Path $printDir -File -ErrorAction SilentlyContinue).Count
    tenderJobsWaiting = $waiting
  }
}

function Status-Text {
  $s = Laptop-Status
  $d = ($s.disks | ForEach-Object { "$($_.drive): $($_.freeGB) GB" }) -join '، '
  $t = "💻 حالة اللابتوب ($($s.computer)) — برنامج المكتب $($s.version)`n• شغّال من: $($s.upSince)`n• البطارية: $($s.battery)`n• المساحة الفارغة: $d"
  $t += "`n• الطابعة الافتراضية: $($s.defaultPrinter)"
  $t += "`n• Word: " + $(if ($s.word) { '✓' } else { '✗' }) + '  • Python (المصنع): ' + $(if ($s.python) { '✓' } else { '✗' }) + '  • Google Drive: ' + $(if ($s.googleDrive) { '✓ شغّال' } else { '✗ مطفي' })
  if ($s.printFolderWaiting) { $t += "`n• ملفات تنتظر الطباعة: $($s.printFolderWaiting)" }
  return $t
}

function Run-Pc($c) {
  Log "pc $($c.op) $($c.id)"
  try {
    $data = Pc-Op $c
    Post-Json '/pc/result' @{ id = $c.id; ok = $true; data = $data } | Out-Null
  } catch {
    Log "pc failed $($c.op): $_"
    try { Post-Json '/pc/result' @{ id = $c.id; ok = $false; error = "$_" } | Out-Null } catch { Log "pc result failed: $_" }
  }
}

# ------------------------------------------------------------------------ الأوامر

function Run-Command($c) {
  Log "cmd $($c.cmd) $($c.text) $($c.name)"
  $to = $c.chat
  switch ($c.cmd) {
    'pc'        { Run-Pc $c }
    'printfile' { Print-BotFile $c }
    'printpath' {
      $p = Allowed-Path $c.path
      Print-File $p
      Report ('🖨️ انطبع: ' + (Split-Path $p -Leaf)) $to
    }
    'tender' {
      $tmp = Fetch-File $c
      $job = $tmp
      if ($jobsDir) {
        $job = Join-Path $jobsDir ('بوت-' + (Get-Date -Format 'yyyyMMdd-HHmmss-') + (Safe-Name $c.name 'طلب.xlsx'))
        Move-Item -LiteralPath $tmp -Destination $job -Force
      }
      Build-Tender $job $to | Out-Null
    }
    'docs' {
      $r = Run-Factory @('docs', '--days', '45')
      $list = @($r.expiring)
      if (-not $list.Count) { Report '✅ ماكو مستمسك ينتهي خلال 45 يوم (حسب مستمسكات.xlsx)' $to }
      else { Report ("⏰ تنتهي قريباً:`n" + (($list | ForEach-Object { "• $($_.name) ($($_.company)): $($_.expiry) — باقي $($_.days) يوم" }) -join "`n")) $to }
    }
    'status'   { Report (Status-Text) $to }
    'print'    { Print-TestPage; Report '🖨️ انطبعت صفحة التجربة' $to }
    'shutdown' { Report '⏻ اللابتوب ينطفي بعد دقيقة' $to; shutdown.exe /s /t 60 /c 'أمر من مكتب أقصى الفرات' }
    'restart'  { Report '🔄 اللابتوب يعيد التشغيل بعد دقيقة' $to; shutdown.exe /r /t 60 /c 'أمر من مكتب أقصى الفرات' }
    'lock'     { rundll32.exe user32.dll,LockWorkStation; Report '🔒 انقفلت الشاشة' $to }
    'sleep'    {
      Report '🌙 اللابتوب نام. يگعد وحده بالوقت المضبوط أو تضغط زر التشغيل' $to
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false) | Out-Null
    }
    'text'     { Show-Message $c.text; Report ('📩 ظهرت الرسالة على الشاشة: ' + $c.text) $to }
    default    { Log "unknown $($c.cmd)" }
  }
}

function Watch-PrintFolder {
  $skip = '\.(tmp|crdownload|partial|part|lnk|ini)$'
  Get-ChildItem -Path $printDir -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notmatch $skip -and $_.Name -notlike '~$*' -and $_.LastWriteTime -lt (Get-Date).AddSeconds(-5) } |
    ForEach-Object {
      $file = $_
      $name = $file.Name
      try {
        Print-File $file.FullName
        # ما نحذف شي: الملف المطبوع ينتقل لمجلد «انطبع»
        Move-Item -LiteralPath $file.FullName -Destination (Join-Path $doneDir ((Get-Date -Format 'yyyyMMdd-HHmm-') + $name)) -Force
        Report "🖨️ انطبع: $name"
      } catch {
        Log "print failed $name : $_"
        # ينتقل لمجلد «ما انطبع» حتى ما يعيد المحاولة كل 5 ثواني
        Move-Item -LiteralPath $file.FullName -Destination (Join-Path $failDir $name) -Force -ErrorAction SilentlyContinue
        Report "⚠️ ما انطبع: $name (انحط بمجلد «ما انطبع»)"
      }
    }
}

Log 'agent started'
Report "💻 اللابتوب اشتغل وبرنامج المكتب متصل (نسخة $version)"
$lastBeat = [datetime]::MinValue
$confirmed = $false
while ($true) {
  $beat = ((Get-Date) - $lastBeat).TotalMinutes -ge 3
  $uri = "$base/office/poll"
  if ($beat) { $uri += '?beat=1' }
  try {
    $r = Invoke-RestMethod -Uri $uri -Headers $headers -TimeoutSec 20
    if ($beat) { $lastBeat = Get-Date }
    if (-not $confirmed) {
      $confirmed = $true
      try { Confirm-Update } catch { Log "confirm update: $_" }
    }
    foreach ($c in $r.cmds) {
      try { Run-Command $c } catch { Log "cmd failed $($c.cmd): $_"; Report "⚠️ ما تنفّذ: $($c.cmd) $($c.name) — $_" $c.chat }
    }
  } catch { Log "poll: $_" }
  # بعد تحديث: نطلع، والـ launcher يشغّل النسخة الجديدة
  if ($restartNow) { Report "⬆️ انحطت النسخة الجديدة، البرنامج يعيد تشغيل نفسه"; exit 0 }
  Watch-PrintFolder
  Watch-Jobs
  Daily-Docs
  Start-Sleep -Seconds 5
}
