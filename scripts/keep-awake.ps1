<#
Mencegah laptop masuk sleep selama server (backend/frontend/ngrok) berjalan.
Pakai SetThreadExecutionState (bukan ubah power plan) karena standby-timeout
di laptop ini dikunci Group Policy kantor -- powercfg /change ditolak.

Jalankan:   .\scripts\keep-awake.ps1
Hentikan:   Ctrl+C di window ini, atau tutup window-nya.
Layar tetap boleh mati (hemat daya); yang dicegah cuma system sleep.
#>

Add-Type -Name Power -Namespace Win32Native -MemberDefinition @'
[DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
public static extern uint SetThreadExecutionState(uint esFlags);
'@

$ES_CONTINUOUS = [uint32]2147483648
$ES_SYSTEM_REQUIRED = [uint32]1

Write-Host "[keep-awake] Aktif sejak $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'). PID $PID. Tekan Ctrl+C untuk berhenti."

try {
    while ($true) {
        [Win32Native.Power]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED) | Out-Null
        Start-Sleep -Seconds 60
    }
} finally {
    [Win32Native.Power]::SetThreadExecutionState($ES_CONTINUOUS) | Out-Null
    Write-Host "[keep-awake] Dihentikan $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'). Perilaku sleep normal dipulihkan."
}
