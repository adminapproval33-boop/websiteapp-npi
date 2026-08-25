# Menjadwalkan sekali-jalan scripts\deploy-live.ps1 pada jam tertentu hari ini
# (atau besok kalau jamnya sudah lewat), lewat Windows Task Scheduler.
#
# Contoh pakai:
#   .\scripts\schedule-deploy.ps1 -At "17:00"
#   .\scripts\schedule-deploy.ps1 -At "19:00"
#
# Task otomatis terhapus lagi setelah selesai jalan (sekali pakai). Kalau mau
# batal, jalankan: .\scripts\schedule-deploy.ps1 -Cancel

param(
    [string]$At,
    [switch]$Cancel
)

$ErrorActionPreference = 'Stop'
$taskName = 'NPI-Deploy-Live'
$scriptPath = 'C:\Users\abdad\websiteapp-npi\scripts\deploy-live.ps1'
$logOut = 'C:\Users\abdad\websiteapp-npi-live\schedule-deploy-run.log'

if ($Cancel) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "[NPI] Jadwal deploy (kalau ada) dibatalkan." -ForegroundColor Yellow
    exit 0
}

if (-not $At) {
    Write-Host "[NPI] Wajib isi -At, contoh: .\scripts\schedule-deploy.ps1 -At '19:00'" -ForegroundColor Red
    exit 1
}

$targetTime = [DateTime]::ParseExact($At, 'HH:mm', $null)
$now = Get-Date
$runAt = Get-Date -Hour $targetTime.Hour -Minute $targetTime.Minute -Second 0
if ($runAt -le $now) { $runAt = $runAt.AddDays(1) }

# Hapus task lama kalau ada (biar bisa reschedule / ganti jam dgn perintah yg sama)
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -File `"$scriptPath`" *> `"$logOut`""
$trigger = New-ScheduledTaskTrigger -Once -At $runAt
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Description "Deploy sekali-jalan websiteapp-npi ke live (dijadwalkan via schedule-deploy.ps1)" | Out-Null

Write-Host "[NPI] Deploy dijadwalkan jalan otomatis pada $($runAt.ToString('yyyy-MM-dd HH:mm')). Laptop harus tetap menyala & login sampai jam itu." -ForegroundColor Green
Write-Host "[NPI] Batalkan dengan: .\scripts\schedule-deploy.ps1 -Cancel" -ForegroundColor DarkGray
