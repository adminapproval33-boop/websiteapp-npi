# System Integration Testing (SIT) — Website NPI

Skenario pengujian integrasi antar-modul, dilakukan oleh tim developer/teknis sebelum masuk tahap UAT. Fokus: memastikan data mengalir dengan benar lintas modul, aturan gating berjalan, dan kontrol akses ditegakkan di level backend (bukan cuma disembunyikan di UI). *(Revisi 6 November 2026 — menambah skenario untuk 178 commit sejak draft 4 Agustus 2026.)*

| Status | Keterangan |
|---|---|
| ⬜ Belum diuji | ✅ Pass | ❌ Fail |

---

## A. Master Data & Auto-fill Lintas Modul

| No | Skenario | Langkah Pengujian | Hasil yang Diharapkan | Status |
|---|---|---|---|---|
| SIT-01 | Import Master Data Order mengalir ke semua modul | Import file referensi Order/PO baru di Master Data → buka Premix, cari Order tsb | Material Number/Description/Batch/Order Qty/Plant otomatis terisi | ⬜ |
| SIT-02 | Placeholder "-" dari SAP tidak dianggap data valid | Import Order dengan kolom Jenis/Warna Dasar/Volume berisi "-" | Field terkait di Colour Matching/Packing tetap kosong (bukan ikut ke-autofill jadi "-") | ⬜ |
| SIT-03 | Code Tanki/IU Plant/Remark ter-agregasi lintas modul | Input Order X di Milling dgn Code Tanki A, lalu buka Production Label Entry cari Order X | Code Tanki/IU Plant/Remark ter-autofill dari input Milling (baris terakhir) | ⬜ |
| SIT-04 | Agregasi ambil baris TERBARU, bukan campur field beda baris | Input Order X di Milling (timestamp T1), lalu di Approval (timestamp T2, lebih baru) | Auto-fill Code Tanki/IU Plant/Remark di Production Label ambil dari Approval (T2), bukan campuran Milling+Approval | ⬜ |
| SIT-23 | Import Material Flow Proses massal tetap Full-Access-only | Login sbg akun Input (bukan Full Access), coba panggil `POST /master-data/material-flow/import` langsung | Ditolak 403 | ⬜ |
| SIT-24 | Checklist kolom wajib per-Material (panel Info Proses) terbuka utk Input | Login sbg akun Input, buka panel Info Proses Material, ubah checklist tahap wajib | `PUT /master-data/material-flow/:materialNumber` berhasil (bukan 403) | ⬜ |

## B. Stage Gate (Urutan Tahap Baku)

| No | Skenario | Langkah Pengujian | Hasil yang Diharapkan | Status |
|---|---|---|---|---|
| SIT-05 | Colour Matching diblokir sebelum Milling selesai | Input Order baru ke Colour Matching padahal Milling belum ada/belum Finish | Muncul pesan error "belum menyelesaikan tahap Milling", data tidak tersimpan | ⬜ |
| SIT-06 | Colour Matching lolos setelah Milling `- DN` | Selesaikan Milling (isi Finish) untuk Order tsb, ulangi input Colour Matching | Berhasil tersimpan | ⬜ |
| SIT-07 | Bongkaran TIDAK digerbangi tahap manapun | Input Bongkaran untuk Order yang belum ada histori tahap lain sama sekali | Berhasil tersimpan tanpa syarat | ⬜ |
| SIT-08 | Edit (bukan create) tidak terkena re-validasi gate | Order yang sudah lolos Colour Matching, coba edit data yang sama | Tidak muncul error gate lagi (mode Edit bebas) | ⬜ |
| SIT-25 | Order Type RF01/RF02 (Rework) dikecualikan dari SEMUA gate | Input Order dgn Order Type RF01 langsung ke Aftermix/Colour Matching tanpa Milling/Premix | Berhasil tersimpan, tidak terblokir Material Flow manapun | ⬜ |
| SIT-26 | Production Label (SFG) digerbangi Milling, kecuali Rework | Cetak Label SFG utk Order yg Material-nya wajib Milling tapi belum Finish | Ditolak dgn pesan gate; ulangi dgn Order Type RF01 → berhasil tanpa gate | ⬜ |

## C. Status Real-Time Antar Modul

| No | Skenario | Langkah Pengujian | Hasil yang Diharapkan | Status |
|---|---|---|---|---|
| SIT-09 | Mesin Monitoring reflect status Milling | Isi Code Mesin di Milling tanpa Finish → cek Mesin Monitoring | Status mesin = "Terpakai", occupant = Order tsb | ⬜ |
| SIT-10 | Mesin idle lagi setelah Finish terisi | Isi Finish pada baris Milling yang sama → cek Mesin Monitoring | Status mesin kembali "Idle" | ⬜ |
| SIT-11 | Production Order Monitoring Proses Bar akurat | Lengkapi Order dari Premix s.d. Packing satu per satu | Proses Bar/label status di dashboard ter-update benar di tiap tahap (Milling → Colour Matching → ... → Packing) | ⬜ |
| SIT-12 | Admin QC Stage mengalirkan Order ke antrian Approval | Isi Admin QC Stage = "Approval" utk suatu Order | Order tsb muncul di List Antrian Approval | ⬜ |
| SIT-13 | Check Results verdict vs Product Spec | Buat Product Spec dgn standar tertentu → input Check Results dgn hasil di luar standar | Verdict tampil "Fail" (bukan "Pass") | ⬜ |
| SIT-27 | Admin QC Stage "Assorted (NG)" tercermin di Dashboard Quality | Set Admin QC Stage = Assorted (NG) utk suatu Order | Status Order di Dashboard Quality = "Assorted (NG)", bukan OK/Approval | ⬜ |
| SIT-28 | Maintenance auto-release status Tanki/Mesin | Centang "Damaged" di Master Data Tanki X → buat job Maintenance utk X → isi Tanggal Selesai | Checkbox Damaged di Master Data Tanki X otomatis ter-uncheck, status di Tank Monitoring kembali normal | ⬜ |
| SIT-29 | Maintenance: Tanggal Mulai tanpa Jadwal Pengerjaan ditolak | Isi Tanggal Mulai sebelum Jadwal Pengerjaan terisi | Request ditolak/validasi gagal | ⬜ |
| SIT-30 | No Dok Maintenance tidak berubah saat Edit | Buat job Maintenance (catat No Dok), edit job tsb (ubah field lain) | No Dok tetap sama persis setelah disimpan | ⬜ |
| SIT-31 | No Dok sekuens harian reset lintas hari | Buat beberapa job Maintenance di hari H, lalu buat job baru di hari H+1 | Sekuens 4-digit No Dok hari H+1 mulai dari 0001 lagi (bukan lanjut dari hari H) | ⬜ |

## D. Production Label, Pindah Tanki & Persistensi

| No | Skenario | Langkah Pengujian | Hasil yang Diharapkan | Status |
|---|---|---|---|---|
| SIT-14 | Cetak Label tersimpan ke History | Cetak label untuk suatu Order | Muncul baris baru di Label History dengan semua field & `printedBy` terisi | ⬜ |
| SIT-15 | QR Code SFG berisi 9 field yang benar | Scan QR hasil cetak Label Entry SFG | Data yang muncul = Order, Batch, Material Number, Material Description, Lot No, Exp, IU Plant, Code Tanki, Material Type — sesuai form | ⬜ |
| SIT-16 | Barcode CODE39 terbaca scanner | Scan barcode Order & Batch di label fisik | Scanner membaca angka yang sama persis dengan yang tertera | ⬜ |
| SIT-32 | Label Entry FG: pencarian by Batch fallback ke Order | Cari lewat kolom Batch (bukan Order) utk Order yang sudah ada di Master Data | Data Order ikut ter-autofill sama seperti cari by Order | ⬜ |
| SIT-33 | QR Code Yamaha hanya muncul utk Material terdaftar | Cari Order dgn Material TIDAK terdaftar di Master Part Yamaha | Field Item No. Yamaha kosong ("Produk tidak pakai QR Code"), tombol Download QR disabled, Save tetap berhasil normal | ⬜ |
| SIT-34 | QR Code Yamaha ter-generate benar utk Material terdaftar | Cari Order dgn Material terdaftar, isi Lot No + Qty Pack (angka) | Kode gabungan (Lot DDMMYYYY + Qty Pack 3-digit + Item No. Yamaha) & QR preview muncul benar, Download QR aktif | ⬜ |
| SIT-35 | Migrasi database `qr_code_yamaha` idempoten di database baru | Jalankan `prisma migrate deploy` dari kosong di database baru (belum pernah ada tabel `qr_code_yamaha`) | Migrasi berhasil tanpa error (tidak ada lagi `DROP TABLE` tanpa `IF EXISTS`) | ⬜ |
| SIT-36 | Pindah Tanki cascade ke semua modul terkait | Order X punya histori di Milling, Colour Matching, Approval, Packing dgn Code Tanki A → lakukan Pindah Tanki ke Tanki B | SEMUA baris histori Order X di keempat modul tsb ter-update Code Tanki jadi B, dgn remark trail pindah tanki ditambahkan (bukan menimpa remark lama) | ⬜ |
| SIT-37 | Pindah Tanki ditolak utk Order tanpa histori proses | Pilih Order yang belum pernah diinput di modul manapun | Request ditolak dengan pesan jelas (tidak ada yang bisa dipindah) | ⬜ |
| SIT-38 | Edit riwayat Pindah Tanki redo move, bukan cuma ubah teks | Buka tab Riwayat Pindah Tanki, Edit salah satu entri (ganti Tanki Baru) | Move dieksekusi ulang dgn tanki baru yg diedit (bukan sekadar mengubah catatan teks lama) | ⬜ |
| SIT-39 | Hapus riwayat Pindah Tanki tidak membatalkan perubahan tanki | Hapus 1 entri Riwayat Pindah Tanki | Entri riwayat hilang, TAPI Code Tanki yang sudah ter-update di baris proses tetap seperti hasil pindah (tidak di-revert) | ⬜ |

## E. Kontrol Akses (Backend, bukan cuma UI)

| No | Skenario | Langkah Pengujian | Hasil yang Diharapkan | Status |
|---|---|---|---|---|
| SIT-17 | Akses "Hide" benar-benar diblokir di backend | Set menu X = Hide utk user Y, coba panggil API menu X langsung (bukan lewat UI) pakai token user Y | API menolak (403), bukan cuma disembunyikan di sidebar | ⬜ |
| SIT-18 | Akses "View" tidak bisa input walau API dipanggil langsung | User dgn level View di menu X, coba POST data langsung ke endpoint menu X | Ditolak 403 | ⬜ |
| SIT-19 | Delete: Input-level cuma bisa hapus menu miliknya sendiri | User dgn akses Input HANYA di Milling, coba hapus data di History Packing | Tombol Hapus tidak muncul di Packing; kalau API dipanggil langsung, ditolak 403 | ⬜ |
| SIT-20 | Full Access bypass semua pembatasan menu | Login sbg Full Access, cek semua menu & tombol Hapus muncul di semua History | Semua akses lolos tanpa terkecuali | ⬜ |
| SIT-40 | Backup & Storage Restore/Hapus dibatasi 5 NIK tertentu | Login sbg Full Access TAPI bukan salah satu dari 5 NIK whitelist, coba `POST /backup/restore` atau hapus backup | Ditolak 403 meskipun levelnya Full Access | ⬜ |
| SIT-41 | Sync ke Google Sheet dibatasi 5 NIK tertentu | Login sbg akun Approval biasa (bukan whitelist), panggil endpoint sync langsung | Ditolak 403 | ⬜ |
| SIT-42 | Single-session per NIK | Login dgn NIK yang sama di 2 perangkat berbeda tanpa `force: true` | Login kedua ditolak/diminta konfirmasi force login; begitu force, sesi pertama mendapat pesan "Sesi Anda diakhiri" pada request berikutnya | ⬜ |
| SIT-43 | Session ditolak kalau IP/User-Agent tidak cocok | Curi/pakai token sesi dari perangkat lain dgn IP/User-Agent berbeda | Request ditolak 401, TAPI sesi asli (di perangkat sahnya) tidak ikut ter-invalidate | ⬜ |
| SIT-44 | Error transient (502/network) tidak memicu false-logout | Simulasikan response 502 sesaat dari backend | Sesi di client TIDAK dianggap logout, tetap tersambung setelah error sementara hilang | ⬜ |
| SIT-45 | Maintenance-mode lockdown login | Set env `maintenanceMode=true`, coba login dgn NIK selain `maintenanceAllowedNik` | Login ditolak; NIK yang di-allowlist tetap bisa login | ⬜ |

## F. Import/Export, Backup & Email

| No | Skenario | Langkah Pengujian | Hasil yang Diharapkan | Status |
|---|---|---|---|---|
| SIT-21 | Upload lampiran tersimpan & bisa diunduh kembali | Upload file di Approval/Admin QC/dsb | File tersimpan ke local disk server (`server/data/uploads/`), link download berfungsi | ⬜ |
| SIT-22 | Export CSV dari DataTable sesuai data yang tampil (termasuk filter) | Filter History suatu modul, lalu Export CSV | Isi CSV cocok dengan baris yang sedang ditampilkan/difilter | ⬜ |
| SIT-46 | Backup otomatis berjalan sesuai jam yang dikonfigurasi | Set `autoBackupHour` ke jam tertentu, tunggu sampai jam tsb | File `.dump` baru muncul di folder backup | ⬜ |
| SIT-47 | Catch-up backup kalau jam terlewat (server sempat down) | Matikan server melewati jam backup terjadwal, nyalakan lagi dlm hari yang sama | Backup tetap berjalan otomatis (poll berikutnya mendeteksi belum ada backup hari ini) | ⬜ |
| SIT-48 | Retensi backup menghapus sesuai aturan umur/jumlah | Set `retentionDays`/`retentionMaxCount` kecil, biarkan beberapa backup terkumpul | Backup lama ikut terhapus otomatis sesuai aturan, backup terbaru tetap ada | ⬜ |
| SIT-49 | Staleness indicator aktif kalau backup terakhir >36 jam | Matikan auto-backup / biarkan lewat 36 jam tanpa backup baru | UI Backup & Storage menampilkan peringatan merah | ⬜ |
| SIT-50 | Import Data (Advance) selalu didahului snapshot otomatis | Jalankan Import Data (Advance) dgn file valid | Ada `.dump` baru (snapshot pre-import) di folder backup SEBELUM baris pertama ditulis | ⬜ |
| SIT-51 | Notifikasi Order Macet hanya terkirim kalau Email karyawan terisi | Opt-in notifikasi utk karyawan TANPA Email di Profile | Email tidak terkirim (tidak error, cuma di-skip) | ⬜ |
| SIT-52 | Satu Email tidak boleh dipakai 2 karyawan | Isi Email yang sama persis di Profile 2 akun berbeda | Request kedua ditolak HTTP 409 dgn pesan nama & NIK pemilik email tsb | ⬜ |
| SIT-53 | Lampiran PPTX Order Macet berisi data benar | Trigger notifikasi Order Macet (atau jalankan manual) | PPTX terlampir berisi chart jumlah Order macet per tahap + tabel detail + kolom %GR live | ⬜ |

---
*Catatan: Test case ini disusun berdasarkan logika bisnis yang sudah diimplementasikan di kode per 5 November 2026 (commit `7da58c6`). Perlu dijalankan ulang di environment SIT sesungguhnya, dan ditambah skenario baru setiap ada fitur baru.*
