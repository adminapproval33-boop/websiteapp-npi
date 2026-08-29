# Menerapkan perubahan dari dev workspace (branch main, folder websiteapp-npi)
# ke server "live" yang diakses rekan kerja di LAN (branch production, folder
# websiteapp-npi-live, port 8080, production build - bukan dev-mode HMR).
#
# Jalankan manual kapan saja perubahan siap dirilis, ATAU dijadwalkan otomatis
# lewat scripts\schedule-deploy.ps1 (mis. "jam 17.00" / "jam 19.00").
#
# Commit di dev workspace TIDAK otomatis tampil ke rekan kerja sampai script
# ini dijalankan - itulah pemisahnya.

$ErrorActionPreference = 'Stop'
$devRoot = 'C:\Users\abdad\websiteapp-npi'
$liveRoot = 'C:\Users\abdad\websiteapp-npi-live'
$livePort = 5173
$logFile = Join-Path $liveRoot 'deploy-live.log'

function Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Host $line
    Add-Content -Path $logFile -Value $line
}

# Catatan: SENGAJA tidak pakai "2>&1" di command native (npm/git/npx) di
# bawah - di Windows PowerShell itu membungkus tiap baris stderr jadi
# NativeCommandError dan bisa memicu exception walau exit code sukses.
# Cek keberhasilan pakai $LASTEXITCODE saja setelah tiap command.

try {
    Log "=== Mulai deploy ke live ==="

    Set-Location $liveRoot
    Log "Fetch branch 'main' terbaru dari origin (GitHub)..."
    # SEBELUMNYA branch 'main' lokal di liveRoot cuma di-merge apa adanya,
    # tanpa fetch dulu -- jadi kalau commit baru cuma di-push ke GitHub dari
    # devRoot (belum sempat ada proses lain yg fetch di liveRoot), local
    # 'main' di sini bisa ketinggalan & ff-only merge di bawah cuma
    # mengulang commit lama (2026-08-29, ditemukan saat rilis redesign
    # login/tema). Fetch langsung ke ref 'main' lokal (bukan checkout) aman
    # dilakukan sekalipun branch yg sedang aktif itu 'production'.
    git fetch origin main:main | Tee-Object -FilePath $logFile -Append
    if ($LASTEXITCODE -ne 0) {
        throw "git fetch origin main:main gagal. Cek koneksi/kredensial GitHub di $liveRoot."
    }

    Log "Fast-forward branch 'production' ke commit terbaru di 'main'..."
    git merge main --ff-only | Tee-Object -FilePath $logFile -Append
    if ($LASTEXITCODE -ne 0) {
        throw "git merge --ff-only gagal - kemungkinan branch 'production' punya commit sendiri yang tidak ada di 'main'. Cek manual di $liveRoot."
    }

    # Matikan proses live LAMA di sini (SEBELUM build, bukan sesudah) -- kalau
    # masih hidup, dia mengunci file query_engine-windows.dll.node milik Prisma
    # (EPERM saat "prisma generate" coba menimpanya) dan mungkin juga file
    # dist/*.js lain. Konsekuensinya: rekan kerja OFFLINE selama proses build di
    # bawah (biasanya ~15-20 detik), bukan cuma saat restart singkat di akhir.
    Log "Menghentikan proses live lama (kalau ada, port $livePort) sebelum build..."
    $conn = Get-NetTCPConnection -LocalPort $livePort -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        $conn | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
            Log "Stop-Process PID $_"
            Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 2
    }

    Log "npm install (menyesuaikan dependency kalau ada yang baru)..."
    npm install --no-audit --no-fund | Tee-Object -FilePath $logFile -Append
    if ($LASTEXITCODE -ne 0) { throw "npm install gagal. Live SEDANG OFFLINE - perbaiki lalu jalankan ulang deploy-live.ps1 secepatnya." }

    Log "Prisma generate..."
    npm run prisma:generate --workspace=server | Tee-Object -FilePath $logFile -Append
    if ($LASTEXITCODE -ne 0) { throw "prisma generate gagal. Live SEDANG OFFLINE - perbaiki lalu jalankan ulang deploy-live.ps1 secepatnya." }

    Log "Terapkan migration yang belum jalan..."
    npm exec -w server -- prisma migrate deploy | Tee-Object -FilePath $logFile -Append
    if ($LASTEXITCODE -ne 0) { throw "prisma migrate deploy gagal. Live SEDANG OFFLINE - perbaiki lalu jalankan ulang deploy-live.ps1 secepatnya." }

    Log "Build backend..."
    npm run build:server | Tee-Object -FilePath $logFile -Append
    if ($LASTEXITCODE -ne 0) { throw "Build backend gagal. Live SEDANG OFFLINE - perbaiki lalu jalankan ulang deploy-live.ps1 secepatnya." }

    Log "Build frontend..."
    npm run build:web | Tee-Object -FilePath $logFile -Append
    if ($LASTEXITCODE -ne 0) { throw "Build frontend gagal. Live SEDANG OFFLINE - perbaiki lalu jalankan ulang deploy-live.ps1 secepatnya." }

    Log "Menyalakan server live yang baru (production build)..."
    # SENGAJA TANPA -NoExit (beda dari start-local.ps1) -- deploy berikutnya
    # mem-Stop-Process node.exe-nya lewat lookup port, BUKAN window ini
    # sendiri; tanpa -NoExit, begitu node.exe mati (dibunuh ATAU crash),
    # powershell -Command ini otomatis selesai & jendelanya ikut tertutup
    # sendiri -- mencegah jendela "zombie" menumpuk tiap kali deploy
    # (ditemukan 2026-08-25: 6 jendela nyangkut dari beberapa kali deploy
    # hari itu, sebelum -NoExit dihapus di sini).
    Start-Process powershell.exe -ArgumentList '-NoProfile', '-Command', "`$env:NODE_ENV='production'; node dist/index.js" -WorkingDirectory "$liveRoot\server" -WindowStyle Minimized

    $elapsed = 0
    $ready = $false
    while ($elapsed -lt 30 -and -not $ready) {
        Start-Sleep -Seconds 2
        $elapsed += 2
        try {
            $r = Invoke-WebRequest -Uri "http://localhost:$livePort/api/health" -UseBasicParsing -TimeoutSec 2
            if ($r.StatusCode -eq 200) { $ready = $true }
        } catch {}
    }

    if (-not $ready) { throw "Server live sudah di-restart tapi belum merespons /api/health setelah 30 detik. Cek jendela powershell live secara manual." }

    $lanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|Virtual' -and $_.IPAddress -notmatch '^169\.254\.' } |
        Select-Object -First 1 -ExpandProperty IPAddress

    $liveCommit = git rev-parse --short HEAD
    Log "=== Deploy SELESAI. Live sekarang di commit $liveCommit. ==="
    if ($lanIp) { Log "Akses LAN: http://${lanIp}:${livePort}" }
}
catch {
    Log "!!! DEPLOY GAGAL: $($_.Exception.Message)"
    Write-Host ""
    Write-Host "[NPI] Deploy ke live GAGAL - lihat $logFile untuk detail. Server live lama (kalau masih hidup) tidak diganggu selama build belum sukses." -ForegroundColor Red
    exit 1
}
finally {
    Set-Location $devRoot
}
