# برنامج مكتب أقصى الفرات على اللابتوب (ويندوز). ما يستخدم Claude، فما يصرف توكنز.
#
# يسأل وسيط Cloudflare كل 5 ثواني عن الأوامر وينفّذها:
#   - أوامر المكتب (من البوت أو المكتب الافتراضي): طباعة، رسالة، قفل، نوم، إعادة تشغيل، طفي
#   - مصنع المناقصات: طلب مناقصة (xlsx) ينبني حزمة كاملة وينحفظ بالأرشيف بالدرايف
#   - «إيد Claude»: أوامر ثابتة ومحدودة من جلسة Claude (تصفح، سحب ملف، حط ملف، PDF، طباعة، المصنع)
#     داخل المجلدات المسموحة بس. ماكو تشغيل أوامر أو برامج عشوائية.
# ويراقب مجلدين: «للطباعة» (أي ملف ينطبع) و«مصنع المناقصات\طلبات» (أي طلب ينبني).
# ما يحذف أي ملف: المطبوع ينتقل لـ«انطبع»، والطلب لـ«تم» أو «فشل»، وأي ملف يتبدل تنحفظ نسخته القديمة.
# الإعدادات بـ %APPDATA%\AqsaOffice\config.json (يسويها install.ps1).

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
# الطباعة والتحويل لهاي الأنواع بس (مستندات، مو برامج)
$docExt = @('.pdf', '.doc', '.docx', '.rtf', '.txt', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff')
$utf8 = New-Object Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8

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
  foreach ($a in $allow) {
    if (($full.TrimEnd('\') + '\').StartsWith($a, [StringComparison]::OrdinalIgnoreCase)) { return $full }
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
      if (@('.doc', '.docx', '.rtf') -notcontains [IO.Path]::GetExtension($src).ToLower()) { throw 'التحويل لملفات Word بس' }
      $dst = $a.out
      if (-not $dst) { $dst = [IO.Path]::ChangeExtension($src, '.pdf') }
      $dst = Allowed-Path $dst
      $old = Backup-Existing $dst
      Word-ToPdf $src $dst
      return @{ path = $dst; backup = $old }
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
    default { throw "أمر غير معروف: $($c.op)" }
  }
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
Report '💻 اللابتوب اشتغل وبرنامج المكتب متصل'
$lastBeat = [datetime]::MinValue
while ($true) {
  $beat = ((Get-Date) - $lastBeat).TotalMinutes -ge 3
  $uri = "$base/office/poll"
  if ($beat) { $uri += '?beat=1' }
  try {
    $r = Invoke-RestMethod -Uri $uri -Headers $headers -TimeoutSec 20
    if ($beat) { $lastBeat = Get-Date }
    foreach ($c in $r.cmds) {
      try { Run-Command $c } catch { Log "cmd failed $($c.cmd): $_"; Report "⚠️ ما تنفّذ: $($c.cmd) $($c.name) — $_" $c.chat }
    }
  } catch { Log "poll: $_" }
  Watch-PrintFolder
  Watch-Jobs
  Daily-Docs
  Start-Sleep -Seconds 5
}
