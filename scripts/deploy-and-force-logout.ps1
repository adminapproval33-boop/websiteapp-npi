# Dipakai KHUSUS utk rilis yang perlu semua user langsung "sadar" ada
# perubahan (2026-08-29, instruksi eksplisit user: redesign tema
# login/topbar/sidebar) -- jalankan deploy-live.ps1 dulu (build + restart
# server live), BARU KEMUDIAN akhiri paksa semua sesi yang sedang aktif,
# supaya begitu user ke-logout dan login ulang, yang mereka lihat sudah
# tampilan BARU (bukan logout duluan baru lihat versi lama yang masih jalan).
#
# SENGAJA dipisah dari deploy-live.ps1 biasa (bukan ditambahkan permanen di
# sana) -- force-logout-semua-user itu tindakan yang cukup mengganggu utk
# rekan kerja, jadi hanya dipakai saat memang diminta eksplisit, bukan efek
# samping otomatis di SETIAP deploy.
#
# Kalau deploy-live.ps1 gagal (exit 1 di dalam), script ini ikut berhenti di
# baris itu juga -- force-logout TIDAK akan jalan kalau deploy-nya sendiri
# gagal, supaya user tidak di-logout paksa cuma utk balik ke tampilan lama
# yang masih online.

$ErrorActionPreference = 'Stop'
$devRoot = 'C:\Users\abdad\websiteapp-npi'

& "$devRoot\scripts\deploy-live.ps1"

Write-Host "[NPI] Deploy sukses -- mengakhiri paksa semua sesi yang sedang aktif..." -ForegroundColor Yellow
Set-Location "$devRoot\server"
npm run force-logout-all
if ($LASTEXITCODE -ne 0) {
    Write-Host "[NPI] force-logout-all GAGAL dijalankan -- cek manual (server sudah live dgn versi baru, tapi user lama belum ke-logout otomatis)." -ForegroundColor Red
    exit 1
}

Write-Host "[NPI] Deploy + force-logout SELESAI. Semua user akan diminta login ulang & langsung melihat tampilan baru." -ForegroundColor Green
