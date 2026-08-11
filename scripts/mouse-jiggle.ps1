<#
Simulasi gerakan mouse kecil secara berkala, sebagai lapisan tambahan di atas
keep-awake.ps1. Beda mekanisme: SetThreadExecutionState cuma sinyal aplikasi
yang terbukti 2x diabaikan Modern Standby (battery-budget hibernate & fixed-
timeout hibernate, lihat memory project_keep_awake_script). Input HID asli
(lewat SendInput) dianggap Windows sebagai aktivitas user sungguhan, level
sinyalnya lebih tinggi -- belum tentu cukup kalau GPO memang hard-force
hibernate tanpa peduli aktivitas, tapi belum pernah diuji di laptop ini.

Gerakan cuma 1px kanan lalu 1px kiri (net posisi tidak berubah, praktis tidak
kelihatan), tiap 90 detik. Tidak mengganggu kerja normal karena sekecil dan
sejarang itu.

Jalankan:   .\scripts\mouse-jiggle.ps1
Hentikan:   Ctrl+C di window ini, atau tutup window-nya.
#>

Add-Type -Name MouseNative -Namespace Win32Native -MemberDefinition @'
[DllImport("user32.dll", SetLastError = true)]
public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, System.UIntPtr dwExtraInfo);
'@

$MOUSEEVENTF_MOVE = [uint32]1

Write-Host "[mouse-jiggle] Aktif sejak $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'). PID $PID. Tekan Ctrl+C untuk berhenti."

try {
    while ($true) {
        [Win32Native.MouseNative]::mouse_event($MOUSEEVENTF_MOVE, 1, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 200
        [Win32Native.MouseNative]::mouse_event($MOUSEEVENTF_MOVE, -1, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Seconds 90
    }
} finally {
    Write-Host "[mouse-jiggle] Dihentikan $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')."
}
