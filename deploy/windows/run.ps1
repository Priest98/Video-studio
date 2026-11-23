# Video Studio media worker for Windows. Installs what it needs on the first run, then starts the worker
# and a public address, and tells the web app where to find it. Leave the window open while you work.
# Values come from environment variables (set by the launcher file) or are asked once and saved.
$ErrorActionPreference = "Stop"
$Root = Join-Path $env:USERPROFILE "video-studio-worker"
$EnvFile = Join-Path $Root "worker.env"
New-Item -ItemType Directory -Force -Path $Root | Out-Null

function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}
function Have($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Install-Tool($cmd, $id) {
  Refresh-Path
  if (Have $cmd) { return }
  Write-Host "Installing $id ..."
  winget install -e --id $id --silent --accept-package-agreements --accept-source-agreements | Out-Null
  Refresh-Path
  if (-not (Have $cmd)) { throw "$id was installed but '$cmd' is not found. Close this window, open a new PowerShell and run the same command again." }
}

if (-not (Have "winget")) { throw "winget is missing. Update 'App Installer' from the Microsoft Store, then run this again." }
Install-Tool "python" "Python.Python.3.12"
Install-Tool "ffmpeg" "Gyan.FFmpeg"
Install-Tool "cloudflared" "Cloudflare.cloudflared"

# ---- settings ----
$keys = @("APP_URL", "WORKER_TOKEN", "CALLBACK_SECRET", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "GEMINI_API_KEY")
$saved = @{}
if (Test-Path $EnvFile) {
  Get-Content $EnvFile | ForEach-Object { if ($_ -match '^([A-Z0-9_]+)=(.*)$') { $saved[$Matches[1]] = $Matches[2] } }
}
foreach ($k in $keys) {
  $v = [Environment]::GetEnvironmentVariable($k)
  if ([string]::IsNullOrWhiteSpace($v) -or $v.StartsWith("<")) { $v = $saved[$k] }
  if (([string]::IsNullOrWhiteSpace($v) -or $v.StartsWith("<")) -and $k -ne "GEMINI_API_KEY") { $v = Read-Host "Enter $k" }
  if ($null -eq $v) { $v = "" }
  Set-Item -Path "Env:$k" -Value $v.Trim()
}
$lines = $keys | ForEach-Object { "$_=" + [Environment]::GetEnvironmentVariable($_) }
Set-Content -Path $EnvFile -Value $lines -Encoding ASCII
$env:WORKER_CONCURRENCY = "1"
$env:WORK_ROOT = Join-Path $Root "work"
New-Item -ItemType Directory -Force -Path $env:WORK_ROOT | Out-Null

# ---- code: fresh copy each start ----
$zip = Join-Path $Root "code.zip"
Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/Priest98/Video-studio/archive/refs/heads/main.zip" -OutFile $zip
$src = Join-Path $Root "src"
if (Test-Path $src) { Remove-Item -Recurse -Force $src }
Expand-Archive -Path $zip -DestinationPath $Root -Force
Rename-Item -Path (Join-Path $Root "Video-studio-main") -NewName "src"
$media = Join-Path $src "workers\media"

# ---- python environment (first run only) ----
$venv = Join-Path $Root "venv"
$py = Join-Path $venv "Scripts\python.exe"
if (-not (Test-Path $py)) {
  Write-Host "Setting up Python (a few minutes the first time) ..."
  python -m venv $venv
  & $py -m pip install --upgrade pip | Out-Null
}
& $py -m pip install -q -r (Join-Path $media "requirements.txt") faster-whisper

# ---- keep the PC awake while this window is open ----
Add-Type -Namespace Win -Name Power -MemberDefinition '[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
[void][Win.Power]::SetThreadExecutionState(0x80000001)

# ---- start the worker ----
$logs = Join-Path $Root "logs"
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$worker = Start-Process -FilePath $py -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8080" `
  -WorkingDirectory $media -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logs "worker.out.log") -RedirectStandardError (Join-Path $logs "worker.err.log")
Start-Sleep -Seconds 6
try { Invoke-RestMethod -Uri "http://127.0.0.1:8080/health" -TimeoutSec 10 | Out-Null; Write-Host "Worker is running." }
catch { Write-Host "Worker did not answer. See $logs\worker.err.log"; Stop-Process -Id $worker.Id -Force -ErrorAction SilentlyContinue; exit 1 }

# ---- public address ----
$tlog = Join-Path $logs "tunnel.log"
if (Test-Path $tlog) { Remove-Item $tlog -Force }
$tunnel = Start-Process -FilePath "cloudflared" -ArgumentList "tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:8080" `
  -PassThru -WindowStyle Hidden -RedirectStandardError $tlog -RedirectStandardOutput (Join-Path $logs "tunnel.out.log")
$url = $null
for ($i = 0; $i -lt 90 -and -not $url; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $tlog) {
    $m = Select-String -Path $tlog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value }
  }
}
if (-not $url) { Write-Host "The public address did not start. See $tlog"; Stop-Process -Id $worker.Id, $tunnel.Id -Force -ErrorAction SilentlyContinue; exit 1 }
Write-Host "Public address: $url"

Write-Host "Keep this window open. Press Ctrl+C to stop."
try {
  while (-not $tunnel.HasExited -and -not $worker.HasExited) {
    try {
      Invoke-RestMethod -Method Post -Uri "$($env:APP_URL)/api/worker/register" -TimeoutSec 20 `
        -Headers @{ Authorization = "Bearer $($env:WORKER_TOKEN)" } -ContentType "application/json" `
        -Body (@{ url = $url } | ConvertTo-Json) | Out-Null
      Write-Host ("[{0}] Ready. Your app can use this worker." -f (Get-Date -Format "HH:mm"))
    } catch { Write-Host "Could not tell the app yet: $($_.Exception.Message)" }
    Start-Sleep -Seconds 120
  }
} finally {
  Stop-Process -Id $worker.Id, $tunnel.Id -Force -ErrorAction SilentlyContinue
  [void][Win.Power]::SetThreadExecutionState(0x80000000)
}
