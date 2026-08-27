# Idempotent local DEV startup for websiteapp-npi (PRIBADI - bukan untuk rekan kerja).
# Starts backend (:4000) + frontend dev/HMR (:8080) + keep-awake if not already running.
# Rekan kerja TIDAK pakai port ini lagi (2026-08-25) - mereka akses server "live" di
# :5173 (lihat scripts\deploy-live.ps1 / websiteapp-npi-live), yang isinya baru berubah
# saat di-deploy, bukan langsung ikut tiap kali Anda save di sini.
#
# Sejak 2026-08-26 script ini JUGA menyalakan ulang proses live (:5173) kalau mati -
# misalnya setelah laptop shutdown/restart semalam - pakai build production yang SUDAH
# ADA di websiteapp-npi-live (TIDAK build ulang / TIDAK git merge; itu tetap tugas
# deploy-live.ps1). Ini murni "hidupkan lagi proses yang mati", bukan deploy.
#
# Safe to run repeatedly (e.g. from $PROFILE on every new PowerShell window) - it skips
# anything already up.

$ErrorActionPreference = 'SilentlyContinue'
$repoRoot = 'C:\Users\abdad\websiteapp-npi'

# Guards against duplicate launches when this script is invoked from more than one
# terminal in quick succession (e.g. several new PowerShell windows opened within
# seconds of each other, before npm run dev has had time to bind its port).
$mutex = New-Object System.Threading.Mutex($false, 'Global\NpiStartLocalLock')
if (-not $mutex.WaitOne(0)) {
    Write-Host "[NPI] start-local.ps1 is already running in another window - skipping." -ForegroundColor Yellow
    return
}
try {

function Test-PortListening($port) {
    return $null -ne (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Test-KeepAwakeRunning {
    return $null -ne (Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
        Where-Object { $_.CommandLine -like '*keep-awake.ps1*' })
}

function Test-MouseJiggleRunning {
    return $null -ne (Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
        Where-Object { $_.CommandLine -like '*mouse-jiggle.ps1*' })
}

$backendUp = Test-PortListening 4000
$frontendUp = Test-PortListening 8080
$keepAwakeUp = Test-KeepAwakeRunning
$mouseJiggleUp = Test-MouseJiggleRunning

$liveRoot = 'C:\Users\abdad\websiteapp-npi-live'
$livePort = 5173
$liveUp = Test-PortListening $livePort
$liveDistExists = Test-Path "$liveRoot\server\dist\index.js"

$pg = Get-Service postgresql-x64-18 -ErrorAction SilentlyContinue
if ($pg -and $pg.Status -ne 'Running') {
    Write-Host "[NPI] PostgreSQL service is $($pg.Status), not Running - start it manually if the backend fails." -ForegroundColor Yellow
}

if (-not $backendUp) {
    Write-Host "[NPI] Starting backend..." -ForegroundColor Cyan
    Start-Process powershell.exe -ArgumentList '-NoProfile', '-NoExit', '-Command', 'npm run dev' -WorkingDirectory "$repoRoot\server" -WindowStyle Minimized
}
if (-not $frontendUp) {
    Write-Host "[NPI] Starting frontend..." -ForegroundColor Cyan
    Start-Process powershell.exe -ArgumentList '-NoProfile', '-NoExit', '-Command', 'npm run dev' -WorkingDirectory "$repoRoot\web" -WindowStyle Minimized
}
if (-not $keepAwakeUp) {
    Write-Host "[NPI] Starting keep-awake..." -ForegroundColor Cyan
    Start-Process powershell.exe -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "$repoRoot\scripts\keep-awake.ps1" -WindowStyle Minimized
}
if (-not $mouseJiggleUp) {
    Write-Host "[NPI] Starting mouse-jiggle..." -ForegroundColor Cyan
    Start-Process powershell.exe -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "$repoRoot\scripts\mouse-jiggle.ps1" -WindowStyle Minimized
}
if (-not $liveUp) {
    if ($liveDistExists) {
        Write-Host "[NPI] Server live (:$livePort) mati - menyalakan ulang pakai build yang sudah ada..." -ForegroundColor Cyan
        Start-Process powershell.exe -ArgumentList '-NoProfile', '-Command', "`$env:NODE_ENV='production'; node dist/index.js" -WorkingDirectory "$liveRoot\server" -WindowStyle Minimized
    } else {
        Write-Host "[NPI] Server live (:$livePort) mati DAN belum pernah di-build (dist/index.js tidak ada) - jalankan scripts\deploy-live.ps1 dulu." -ForegroundColor Yellow
    }
}

if (-not $backendUp -or -not $frontendUp) {
    $elapsed = 0
    $ready = $false
    while ($elapsed -lt 30 -and -not $ready) {
        Start-Sleep -Seconds 2
        $elapsed += 2
        try {
            $r1 = Invoke-WebRequest -Uri 'http://localhost:4000/api/health' -UseBasicParsing -TimeoutSec 2
            $r2 = Invoke-WebRequest -Uri 'http://localhost:8080' -UseBasicParsing -TimeoutSec 2
            if ($r1.StatusCode -eq 200 -and $r2.StatusCode -eq 200) { $ready = $true }
        } catch {}
    }
}
if (-not $liveUp -and $liveDistExists) {
    $elapsed = 0
    $liveReady = $false
    while ($elapsed -lt 30 -and -not $liveReady) {
        Start-Sleep -Seconds 2
        $elapsed += 2
        try {
            $r = Invoke-WebRequest -Uri "http://localhost:$livePort/api/health" -UseBasicParsing -TimeoutSec 2
            if ($r.StatusCode -eq 200) { $liveReady = $true }
        } catch {}
    }
    if (-not $liveReady) {
        Write-Host "[NPI] Server live sudah dicoba dinyalakan tapi belum merespons /api/health setelah 30 detik - cek manual." -ForegroundColor Red
    }
}

$lanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|Virtual' -and $_.IPAddress -notmatch '^169\.254\.' } |
    Select-Object -First 1 -ExpandProperty IPAddress

Write-Host ""
if ($lanIp) {
    Write-Host "[NPI] Dev PRIBADI (jangan dibagikan ke rekan kerja): http://${lanIp}:8080" -ForegroundColor Cyan
} else {
    Write-Host "[NPI] Tidak menemukan LAN IP aktif - cek koneksi jaringan." -ForegroundColor Red
}
Write-Host "[NPI] Backend + Frontend + Keep-awake siap. (Ngrok tidak dinyalakan - mode lokal saja.)" -ForegroundColor Green
if ($lanIp -and (Test-PortListening $livePort)) {
    Write-Host "[NPI] Server live juga aktif: http://${lanIp}:${livePort}" -ForegroundColor Green
}
Write-Host "[NPI] Jalankan scripts\deploy-live.ps1 untuk merilis perubahan kode baru ke rekan kerja di :5173." -ForegroundColor DarkGray
Write-Host ""

} finally {
    $mutex.ReleaseMutex()
}
