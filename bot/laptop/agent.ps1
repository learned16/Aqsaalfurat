# برنامج مكتب أقصى الفرات على اللابتوب (ويندوز).
# يسأل وسيط Cloudflare كل 5 ثواني عن أوامر المكتب الافتراضي وينفّذها،
# ويطبع أي ملف ينحط بمجلد «للطباعة». ما يستخدم Claude، فما يصرف توكنز.
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

function Log($m) {
  Add-Content -Path $logFile -Value ('{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $m) -Encoding UTF8
}

function Report($text) {
  $body = [Text.Encoding]::UTF8.GetBytes((@{ text = $text } | ConvertTo-Json -Compress))
  try {
    Invoke-RestMethod -Uri "$base/office/done" -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $body -TimeoutSec 20 | Out-Null
  } catch { Log "report failed: $_" }
}

function Print-File($path) {
  $ext = [IO.Path]::GetExtension($path).ToLower()
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

function Run-Command($c) {
  Log "cmd $($c.cmd) $($c.text)"
  switch ($c.cmd) {
    'print'    { Print-TestPage; Report '🖨️ انطبعت صفحة التجربة' }
    'shutdown' { Report '⏻ اللابتوب ينطفي بعد دقيقة'; shutdown.exe /s /t 60 /c 'أمر من مكتب أقصى الفرات' }
    'restart'  { Report '🔄 اللابتوب يعيد التشغيل بعد دقيقة'; shutdown.exe /r /t 60 /c 'أمر من مكتب أقصى الفرات' }
    'lock'     { rundll32.exe user32.dll,LockWorkStation; Report '🔒 انقفلت الشاشة' }
    'sleep'    {
      Report '🌙 اللابتوب نام. يگعد وحده بالوقت المضبوط أو تضغط زر التشغيل'
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false) | Out-Null
    }
    'text'     { Show-Message $c.text; Report ('📩 ظهرت الرسالة على الشاشة: ' + $c.text) }
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
      try { Run-Command $c } catch { Log "cmd failed $($c.cmd): $_"; Report "⚠️ ما تنفّذ: $($c.cmd)" }
    }
  } catch { Log "poll: $_" }
  Watch-PrintFolder
  Start-Sleep -Seconds 5
}
