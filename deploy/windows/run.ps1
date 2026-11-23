# Video Studio media worker for Windows. Installs what it needs on the first run, then starts the worker
# and a public address, and tells the web app where to find it. Leave the window open while you work.
# Values come from environment variables (set by the launcher file) or are asked once and saved.
$ErrorActionPreference = "Stop"
$Root = Join-Path $env:USERPROFILE "video-studio-worker"
$EnvFile = Join-Path $Root "worker.env"
New-Item -ItemType Directory -Force -Path $Root | Out-Null

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = "SilentlyContinue"
$Bin = Join-Path $Root "bin"
New-Item -ItemType Directory -Force -Path $Bin | Out-Null

# Stop leftovers from an earlier run (they keep files locked and hold the port).
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
  if ($env:Path -notlike "*$Bin*") { $env:Path = "$Bin;" + $env:Path }
}
function Download($url, $dest) {
  Write-Host "Downloading $url"
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $dest
}
function Python-Works {
  try { $v = & python --version 2>&1; return ($LASTEXITCODE -eq 0 -and "$v" -match "Python 3\.(9|1\d)") } catch { return $false }
}

Refresh-Path

if (-not (Python-Works)) {
  Write-Host "Installing Python ..."
  $inst = Join-Path $Root "python-setup.exe"
  Download "https://www.python.org/ftp/python/3.12.8/python-3.12.8-amd64.exe" $inst
  Start-Process -FilePath $inst -ArgumentList "/quiet", "InstallAllUsers=0", "PrependPath=1", "Include_test=0", "Include_launcher=0" -Wait
  $pyDir = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312"
  $env:Path = "$pyDir;$pyDir\Scripts;" + $env:Path
  if (-not (Python-Works)) { throw "Python did not install. Install Python 3.12 from python.org, tick 'Add to PATH', then run this again." }
}

if (-not ((Test-Path (Join-Path $Bin "ffmpeg.exe")) -and (Test-Path (Join-Path $Bin "ffprobe.exe")))) {
  Write-Host "Installing ffmpeg ..."
  $z = Join-Path $Root "ffmpeg.zip"
  try { Download "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" $z }
  catch { Download "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip" $z }
  $x = Join-Path $Root "ffmpeg-tmp"
  if (Test-Path $x) { Remove-Item -Recurse -Force $x }
  Expand-Archive -Path $z -DestinationPath $x -Force
  Get-ChildItem -Path $x -Recurse -Include ffmpeg.exe, ffprobe.exe | Copy-Item -Destination $Bin -Force
  Remove-Item -Recurse -Force $x, $z
}
$env:Path = "$Bin;" + $env:Path
try { & (Join-Path $Bin "ffmpeg.exe") -version | Out-Null; & (Join-Path $Bin "ffprobe.exe") -version | Out-Null } catch { throw "ffmpeg did not install correctly. Delete the folder $Bin and run this again." }

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  Write-Host "Installing cloudflared ..."
  Download "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" (Join-Path $Bin "cloudflared.exe")
  if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) { throw "cloudflared did not install." }
}

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
# Faster on a laptop: smaller speech model and a quicker video encoder preset.
if (-not $env:WHISPER_MODEL) { $env:WHISPER_MODEL = "base" }
if (-not $env:RENDER_PRESET) { $env:RENDER_PRESET = "veryfast" }
if (-not $env:RENDER_WIDTH) { $env:RENDER_WIDTH = "720" }
if (-not $env:SOURCE_MAX_HEIGHT) { $env:SOURCE_MAX_HEIGHT = "720" }
$env:WORK_ROOT = Join-Path $Root "work"
New-Item -ItemType Directory -Force -Path $env:WORK_ROOT | Out-Null

# ---- code: fetch the worker files straight from GitHub (no zip, so nothing to unpack or rename) ----
$media = Join-Path $Root "media"
$repoRaw = "https://raw.githubusercontent.com/Priest98/Video-studio/main"
$tree = Invoke-RestMethod -UseBasicParsing -Headers @{ "User-Agent" = "video-studio-worker" } -Uri "https://api.github.com/repos/Priest98/Video-studio/git/trees/main?recursive=1"
$files = $tree.tree | Where-Object { $_.type -eq "blob" -and $_.path -like "workers/media/*" -and $_.path -notlike "workers/media/tests/*" -and $_.path -ne "workers/media/Dockerfile" }
if (-not $files) { throw "Could not read the file list from GitHub. Check your internet and run this again." }
Write-Host ("Fetching {0} worker files ..." -f @($files).Count)
$nonce = (Get-Date).Ticks
foreach ($f in $files) {
  $rel = $f.path.Substring("workers/media/".Length).Replace("/", "\")
  $dest = Join-Path $media $rel
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  Invoke-WebRequest -UseBasicParsing -Uri ("$repoRaw/" + $f.path + "?t=$nonce") -OutFile $dest
}

# ---- python environment (first run only) ----
$venv = Join-Path $Root "venv"
$py = Join-Path $venv "Scripts\python.exe"
if (-not (Test-Path $py)) {
  Write-Host "Setting up Python (a few minutes the first time) ..."
  python -m venv $venv
  & $py -m pip install --upgrade pip | Out-Null
}
& $py -m pip install -q --prefer-binary -r (Join-Path $media "requirements.txt") faster-whisper
if ($LASTEXITCODE -ne 0) { throw "Installing the Python packages failed. Check your internet and free disk space, then run this again." }

# ---- keep the PC awake while this window is open ----
Add-Type -Namespace Win -Name Power -MemberDefinition '[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
[void][Win.Power]::SetThreadExecutionState([uint32]2147483649)

# ---- start the worker ----
$logs = Join-Path $Root "logs"
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$worker = Start-Process -FilePath $py -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8080" `
  -WorkingDirectory $media -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logs "worker.out.log") -RedirectStandardError (Join-Path $logs "worker.err.log")
Start-Sleep -Seconds 6
try { Invoke-RestMethod -Uri "http://127.0.0.1:8080/health" -TimeoutSec 10 | Out-Null; Write-Host "Worker is running." }
catch {
  Stop-Process -Id $worker.Id -Force -ErrorAction SilentlyContinue
  $tail = ""
  $f = Join-Path $logs "worker.err.log"
  if (Test-Path $f) { $tail = (Get-Content $f -Tail 15) -join "`n" }
  throw "The worker did not start. Details:`n$tail"
}

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
if (-not $url) { Stop-Process -Id $worker.Id, $tunnel.Id -Force -ErrorAction SilentlyContinue; throw "The public address did not start. See $tlog" }
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
  [void][Win.Power]::SetThreadExecutionState([uint32]2147483648)
}
