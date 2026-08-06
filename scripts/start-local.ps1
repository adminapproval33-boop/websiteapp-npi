# Idempotent local-access startup for websiteapp-npi.
# Starts backend + frontend + keep-awake if not already running, and prints the LAN URL
# for coworkers on the same office network. Safe to run repeatedly (e.g. from $PROFILE
# on every new PowerShell window) - it skips anything already up.

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

$backendUp = Test-PortListening 4000
$frontendUp = Test-PortListening 5173
$keepAwakeUp = Test-KeepAwakeRunning

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

if (-not $backendUp -or -not $frontendUp) {
    $elapsed = 0
    $ready = $false
    while ($elapsed -lt 30 -and -not $ready) {
        Start-Sleep -Seconds 2
        $elapsed += 2
        try {
            $r1 = Invoke-WebRequest -Uri 'http://localhost:4000/api/health' -UseBasicParsing -TimeoutSec 2
            $r2 = Invoke-WebRequest -Uri 'http://localhost:5173' -UseBasicParsing -TimeoutSec 2
            if ($r1.StatusCode -eq 200 -and $r2.StatusCode -eq 200) { $ready = $true }
        } catch {}
    }
}

$lanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|Virtual' -and $_.IPAddress -notmatch '^169\.254\.' } |
    Select-Object -First 1 -ExpandProperty IPAddress

Write-Host ""
if ($lanIp) {
    Write-Host "[NPI] Akses untuk rekan kerja (WiFi/LAN kantor yang sama): http://${lanIp}:5173" -ForegroundColor Green
} else {
    Write-Host "[NPI] Tidak menemukan LAN IP aktif - cek koneksi jaringan." -ForegroundColor Red
}
Write-Host "[NPI] Backend + Frontend + Keep-awake siap. (Ngrok tidak dinyalakan - mode lokal saja.)" -ForegroundColor Green
Write-Host ""

if ($lanIp) {
    $waMessage = @"
Halo tim Admin,

Website NPI sekarang sudah bisa diakses di jaringan kantor (WiFi/LAN) untuk input administrasi produksi.

Alamat akses: http://${lanIp}:5173

Catatan penting:
- Buka link di atas dari browser (Chrome/Edge) selama terhubung ke WiFi/LAN kantor yang sama dengan komputer server.
- Link ini tidak bisa diakses dari luar kantor (rumah/data seluler) - hanya untuk penggunaan internal di area kantor.
- Login pakai NIK dan password masing-masing seperti biasa.
- Kalau link tidak bisa dibuka, pastikan WiFi sudah tersambung, lalu coba refresh. Kalau masih bermasalah, hubungi [nama/kontak PIC].

Silakan mulai input administrasi produksi melalui link tersebut.

Terima kasih.
"@
    Write-Host "----------------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host "[NPI] Teks siap kirim ke WhatsApp tim admin (copy semua di bawah ini):" -ForegroundColor Yellow
    Write-Host "----------------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host $waMessage
    Write-Host "----------------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host ""
}

} finally {
    $mutex.ReleaseMutex()
}
