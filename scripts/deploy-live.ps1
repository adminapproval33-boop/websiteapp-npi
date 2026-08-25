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
    Log "Fast-forward branch 'production' ke commit terbaru di 'main'..."
    git merge main --ff-only | Tee-Object -FilePath $logFile -Append
    if ($LASTEXITCODE -ne 0) {
        throw "git merge --ff-only gagal - kemungkinan branch 'production' punya commit sendiri yang tidak ada di 'main'. Cek manual di $liveRoot."
    }

    Log "npm install (menyesuaikan dependency kalau ada yang baru)..."
    npm install --no-audit --no-fund | Tee-Object -FilePath $logFile -Append
    if ($LASTEXITCODE -ne 0) { throw "npm install gagal." }

    Log "Prisma generate..."
    npm run prisma:generate --workspace=server | Tee-Object -FilePath $logFile -Append
    if ($LASTEXITCODE -ne 0) { throw "prisma generate gagal." }

    Log "Terapkan migration yang belum jalan..."
    npm exec -w server -- prisma migrate deploy | Tee-Object -FilePath $logFile -Append
    if ($LASTEXITCODE -ne 0) { throw "prisma migrate deploy gagal." }

    Log "Build backend..."
    npm run build:server | Tee-Object -FilePath $logFile -Append
    if ($LASTEXITCODE -ne 0) { throw "Build backend gagal - deploy dibatalkan, server live LAMA tetap jalan." }

    Log "Build frontend..."
    npm run build:web | Tee-Object -FilePath $logFile -Append
    if ($LASTEXITCODE -ne 0) { throw "Build frontend gagal - deploy dibatalkan, server live LAMA tetap jalan." }

    Log "Menghentikan proses live lama (kalau ada, port $livePort)..."
    $conn = Get-NetTCPConnection -LocalPort $livePort -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        $conn | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
            Log "Stop-Process PID $_"
            Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 2
    }

    Log "Menyalakan server live yang baru (production build)..."
    Start-Process powershell.exe -ArgumentList '-NoProfile', '-NoExit', '-Command', "`$env:NODE_ENV='production'; node dist/index.js" -WorkingDirectory "$liveRoot\server" -WindowStyle Minimized

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
