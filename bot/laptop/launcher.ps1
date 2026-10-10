# مشغّل برنامج المكتب. المهمة المجدولة تشغّل هذا الملف، وهو يشغّل agent.ps1 ويرجّعه إذا وكف.
# هذا الملف ما يتبدل بالتحديث عن بعد، حتى يبقى يكدر يرجّع النسخة القديمة إذا التحديث خرب:
# إذا اكو تحديث ينتظر تأكيد (update-pending.json) والبرنامج الجديد وكف 3 مرات قبل ما يتصل بالوسيط،
# يرجّع ملفات النسخة السابقة من مجلد versions ويكتب update-rollback.json حتى البرنامج يبلّغ بتلغرام.

$ErrorActionPreference = 'Continue'
$dir = Join-Path $env:APPDATA 'AqsaOffice'
$agent = Join-Path $dir 'agent.ps1'
$pend = Join-Path $dir 'update-pending.json'
$logFile = Join-Path $dir 'agent.log'

function Log($m) {
  Add-Content -Path $logFile -Value ('{0:yyyy-MM-dd HH:mm:ss} launcher: {1}' -f (Get-Date), $m) -Encoding UTF8
}

# نفس الملفات اللي يبدّلها التحديث: agent.ps1 وVERSION وfactory\*.py
function Restore-Version($from) {
  foreach ($f in @('agent.ps1', 'VERSION')) {
    $src = Join-Path $from $f
    if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $dir $f) -Force }
  }
  $fsrc = Join-Path $from 'factory'
  if (Test-Path -LiteralPath $fsrc) {
    $fdst = Join-Path $dir 'factory'
    New-Item -ItemType Directory -Force -Path $fdst | Out-Null
    Get-ChildItem -LiteralPath $fsrc -Filter '*.py' -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $fdst $_.Name) -Force }
  }
}

Log 'started'
while ($true) {
  if (Test-Path -LiteralPath $pend) {
    try {
      $p = Get-Content -LiteralPath $pend -Raw -Encoding UTF8 | ConvertFrom-Json
      $tries = [int]$p.tries + 1
      if ($tries -gt 3 -and $p.backup -and (Test-Path -LiteralPath $p.backup)) {
        Log "update $($p.to) failed $($p.tries) times, rolling back to $($p.from)"
        Restore-Version $p.backup
        Move-Item -LiteralPath $pend -Destination (Join-Path $dir 'update-rollback.json') -Force
      } else {
        $p | Add-Member -NotePropertyName tries -NotePropertyValue $tries -Force
        $p | ConvertTo-Json | Set-Content -LiteralPath $pend -Encoding UTF8
      }
    } catch { Log "pending check failed: $_" }
  }
  $t0 = Get-Date
  & powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File $agent
  $code = $LASTEXITCODE
  # خروج 0 = البرنامج طلب إعادة تشغيل (بعد تحديث). غيره = وكف، فننتظر شوية حتى ما يدور بسرعة
  if ($code -eq 0) { Start-Sleep -Seconds 2 }
  else {
    Log "agent exited ($code) after $([int]((Get-Date) - $t0).TotalSeconds)s"
    Start-Sleep -Seconds 15
  }
}
