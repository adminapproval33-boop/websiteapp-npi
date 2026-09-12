# Idempotent local DEV startup for websiteapp-npi (PRIBADI - bukan untuk rekan kerja).
# Starts backend (:4000) + frontend dev/HMR (:8080) kalau belum jalan. Keep-awake &
# mouse-jiggle SENGAJA dimatikan (2026-09-12, instruksi eksplisit user) - tidak lagi
# di-auto-start di sini.
#
# Rekan kerja akses http://mes.nipseapaint.com:8090/login (dikelola tim IT, di-update
# lewat email setelah kode di-push ke GitHub) - bukan lewat server "live" lokal :5173
# lagi (dihentikan 2026-09-11; lihat riwayat git untuk logic lama kalau perlu).
#
# Safe to run repeatedly (e.g. from $PROFILE on every new PowerShell window) - it skips
# anything already up.

$ErrorActionPreference = 'SilentlyContinue'
# Dev pribadi = folder tempat script ini ada sekarang (bukan hardcoded ke satu
# folder tertentu) - supaya kalau dipindah/dicopy ke checkout lain (mis. saat
# ganti folder kerja utama), auto-start ikut folder yang benar tanpa edit manual.
$repoRoot = Split-Path -Parent $PSScriptRoot

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

$backendUp = Test-PortListening 4000
$frontendUp = Test-PortListening 8080

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

$lanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|Virtual' -and $_.IPAddress -notmatch '^169\.254\.' } |
    Select-Object -First 1 -ExpandProperty IPAddress

Write-Host ""
if ($lanIp) {
    Write-Host "[NPI] Dev PRIBADI (jangan dibagikan ke rekan kerja): http://${lanIp}:8080" -ForegroundColor Cyan
} else {
    Write-Host "[NPI] Tidak menemukan LAN IP aktif - cek koneksi jaringan." -ForegroundColor Red
}
Write-Host "[NPI] Backend + Frontend siap. (Ngrok tidak dinyalakan - mode lokal saja.)" -ForegroundColor Green
Write-Host "[NPI] Rekan kerja akses http://mes.nipseapaint.com:8090/login - push ke GitHub lalu email tim IT untuk update di sana." -ForegroundColor DarkGray
Write-Host ""

} finally {
    $mutex.ReleaseMutex()
}
