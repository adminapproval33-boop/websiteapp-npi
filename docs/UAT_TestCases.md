# User Acceptance Testing (UAT) — Website NPI

Skenario pengujian dari sudut pandang user asli, dilakukan oleh perwakilan tiap role setelah SIT selesai. Mengacu ke [User Guide](./UserGuide.md). Tujuan: memastikan sistem benar-benar bisa dipakai menyelesaikan pekerjaan sehari-hari, bukan cuma "berfungsi secara teknis". *(Revisi 6 November 2026 — menambah skenario untuk fitur baru sejak draft 4 Agustus 2026.)*

| Status | Keterangan |
|---|---|
| ⬜ Belum diuji | ✅ Diterima | ❌ Ditolak (butuh perbaikan) |

---

## A. Operator/SPV Produksi

| No | Skenario | Langkah Pengujian | Hasil yang Diharapkan | Status | Catatan Tester |
|---|---|---|---|---|---|
| UAT-01 | Input data tahap produksi | Cari Order, isi form sesuai tahap (Premix/Milling/Aftermix/dst), Save | Data tersimpan, muncul di History | ⬜ | |
| UAT-02 | Edit data yang sudah pernah diinput | Cari ulang Order yang sudah pernah diinput | Form otomatis mode Edit dgn data lama terisi, bukan bikin baris baru | ⬜ | |
| UAT-03 | Pakai antrian PWO Queue (List) | Buka tab PWO Schedule & Queue > List, klik "Input [Tahap]" pada salah satu baris | Data Order langsung terbawa ke form Input, tidak perlu ketik ulang | ⬜ | |
| UAT-04 | Paham pesan error saat tahap belum boleh diinput | Coba input Colour Matching padahal Milling belum selesai | Pesan error jelas & bisa dipahami operator tanpa perlu tanya IT | ⬜ | |
| UAT-05 | Input multi-Pass di Milling | Tambah lebih dari 1 Pass Fineness/Visco/Suhu untuk 1 Order | Semua Pass tersimpan & bisa dilihat di History/dashboard | ⬜ | |
| UAT-06 | Hapus data yang salah input | Hapus 1 baris History di menu dengan akses Input | Tombol Hapus tersedia & berfungsi (kalau memang berhak) | ⬜ | |
| UAT-18 | Pakai tampilan Kalender di PWO Schedule & Queue | Buka tab PWO Schedule & Queue > Kalender, cari Order yg sudah dijadwalkan | Jadwal tampil rapi per minggu, mudah dibandingkan dgn tampilan List | ⬜ | |
| UAT-19 | Booking tanki di muka sebelum proses dimulai | Gunakan "+Input Manual Schedule" dgn Code Tanki, utk Order yg belum waktunya diproses | Tanki ter-reservasi (booking), tampil di kartu kalender dgn badge Cooispi yg sesuai | ⬜ | |
| UAT-20 | Paham arti badge "Cooispi ⚠/✅" | Lihat kartu jadwal dgn badge ⚠ dan ✅ | Operator paham ⚠ = belum cocok data SAP, ✅ = sudah cocok, tanpa perlu tanya developer | ⬜ | |
| UAT-21 | Pindahkan tanki suatu Order yang rusak di tengah jalan | Buka Pindah Tanki dari Production Order Monitoring, cari Order, isi Tanki Baru + Alasan | Proses berhasil, operator paham semua riwayat Order tsb otomatis ikut tercatat ke tanki baru tanpa perlu input ulang manual | ⬜ | |
| UAT-22 | Laporkan kerusakan Tanki/Mesin lewat Maintenance | Buka menu Maintenance, isi Form Input (Equipment Type, Deskripsi Kerusakan, Priority) | Laporan tersimpan dgn No Dok otomatis, status tanki/mesin terkait berubah jadi "Maintenance"/"Rusak" di dashboard | ⬜ | |

## B. Teknisi Maintenance

| No | Skenario | Langkah Pengujian | Hasil yang Diharapkan | Status | Catatan Tester |
|---|---|---|---|---|---|
| UAT-23 | Jadwalkan & selesaikan pekerjaan Maintenance | Isi Jadwal Pengerjaan → Tanggal Mulai → Tanggal Selesai pada job yang sudah ada | Status job berubah bertahap (Dijadwalkan → Dikerjakan → Selesai); begitu Tanggal Selesai terisi, Tanki/Mesin terkait otomatis kembali bisa dipakai | ⬜ | |
| UAT-24 | Cetak laporan Maintenance | Buka job yang sudah selesai, klik Print | Dokumen tercetak berisi No Dok, deskripsi kerusakan, teknisi, dan tanggal lengkap | ⬜ | |

## C. Tim Quality Control

| No | Skenario | Langkah Pengujian | Hasil yang Diharapkan | Status | Catatan Tester |
|---|---|---|---|---|---|
| UAT-07 | Buat Product Spec baru | Tambah Material + parameter standar | Spec tersimpan, siap dipakai acuan Check Results | ⬜ | |
| UAT-08 | Input Check Results & lihat verdict | Input hasil aktual utk Order tertentu | Verdict Pass/Fail muncul otomatis & sesuai ekspektasi QC | ⬜ | |
| UAT-09 | Input Admin QC & pantau progresnya | Isi Admin QC Stage, Lot Passed, QC to App, QC Passed | Data tersimpan, Order muncul di antrian Approval sesuai stage | ⬜ | |
| UAT-25 | Isi FLC saat Input Check Results | Pilih FLC 1/2/3 atau Reguler saat input hasil cek | Pilihan tersimpan & muncul di breakdown Dashboard Quality | ⬜ | |
| UAT-26 | Baca RFT di Dashboard Quality | Buka Dashboard Quality, cek kolom/KPI RFT utk beberapa Order yg sudah OK | QC paham mana Order "Direct Passed" vs "Not Direct Passed" dan kenapa (riwayat Fail sebelumnya) | ⬜ | |
| UAT-27 | Set Admin QC Stage "Assorted (NG)" | Tandai suatu Order sbg Assorted (NG) | Order pindah status di Dashboard Quality sesuai, tidak tercampur dgn status OK/Approval | ⬜ | |

## D. Tim Approval / MRP-Sales

| No | Skenario | Langkah Pengujian | Hasil yang Diharapkan | Status | Catatan Tester |
|---|---|---|---|---|---|
| UAT-10 | Proses antrian sesuai urutan FIFO | Buka List Antrian Approval | Urutan sesuai lama menunggu (paling lama duluan), sesuai ekspektasi kerja harian | ⬜ | |
| UAT-11 | Upload lampiran pendukung | Upload dokumen di form Approval | File tersimpan & bisa dibuka kembali kapan saja | ⬜ | |
| UAT-28 | Paham status 4-tier Approval | Isi field Approval bertahap (Tier 1 dulu, lalu Tier 2, lalu Finish App) | Status berubah otomatis sesuai urutan: Prepare Approval → Wait Approval → Approval → Oke Approval, dan tim paham arti tiap status tanpa penjelasan tambahan | ⬜ | |
| UAT-29 | Isi Cust Segmen & Customer dgn autocomplete | Ketik nama Customer di form Approval | Saran autocomplete muncul, Cust Segmen bisa dipilih sesuai | ⬜ | |
| UAT-30 | (Khusus akun admin tertentu) Sync ke Google Sheet | Login sbg salah satu dari 5 akun yg diberi akses, klik "Sync ke Google Sheet" di Lot History | Sheet "New List Approval" ter-update sesuai filter yg aktif saat itu | ⬜ | |

## E. Operator Cetak Label Produksi

| No | Skenario | Langkah Pengujian | Hasil yang Diharapkan | Status | Catatan Tester |
|---|---|---|---|---|---|
| UAT-12 | Cetak label end-to-end (SFG) | Ikuti langkah di User Guide Bagian 6 sampai label tercetak fisik | Label tercetak rapi, ukuran pas 100mm x 140mm di printer PC42T | ⬜ | |
| UAT-13 | Scan barcode & QR hasil cetak | Scan pakai scanner/HP yang biasa dipakai di lapangan | Semua data terbaca benar & jelas | ⬜ | |
| UAT-14 | Cek riwayat cetak | Buka Label History, cari label yang baru dicetak | Data lengkap & sesuai yang dicetak | ⬜ | |
| UAT-31 | Isi data Label Entry FG tanpa cetak fisik | Cari Order di Label Entry FG, lengkapi field, klik Save (bukan Cetak) | Data tersimpan ke History FG tanpa membuka dialog print | ⬜ | |
| UAT-32 | Cari by Batch di Label Entry FG | Ketik nomor Batch (bukan Order) di kolom pencarian | Data Order terkait ikut ter-autofill sama seperti cari by Order | ⬜ | |
| UAT-33 | Download QR Code Yamaha utk Material pelanggan Yamaha | Cari Order dgn Material terdaftar di Master Part Yamaha, lengkapi Lot/Qty Pack, klik Download QR | File PNG QR Code terunduh, kode yg tertera sesuai preview di layar | ⬜ | |

## F. Admin (Full Access)

| No | Skenario | Langkah Pengujian | Hasil yang Diharapkan | Status | Catatan Tester |
|---|---|---|---|---|---|
| UAT-15 | Tambah user baru & atur akses | Buat akun baru, set level akses per-menu | User baru bisa login & akses sesuai yang diatur (tidak lebih tidak kurang) | ⬜ | |
| UAT-16 | Import Master Data Order | Import file hasil ekspor SAP-COOISPI | Data ter-import tanpa error, langsung terpakai di semua modul | ⬜ | |
| UAT-17 | Pantau dashboard monitoring | Buka Production Order Monitoring, Tank/Mesin Monitoring, Dashboard Colour Matching, Dashboard Quality | Informasi akurat & mudah dibaca untuk pengambilan keputusan harian | ⬜ | |
| UAT-34 | Backup database manual & cek riwayat | Buka Backup & Storage, klik backup manual, cek daftar backup | Backup baru muncul di daftar dgn timestamp benar; indikator staleness tidak merah setelahnya | ⬜ | |
| UAT-35 | Restore database (hanya akun yg diberi akses) | (Di environment staging/test, bukan live) jalankan Restore dari salah satu backup | Database kembali ke kondisi saat backup diambil, tanpa error | ⬜ | |
| UAT-36 | Import & Export Data (Advance) | Export salah satu kategori data ke Excel, ubah sedikit, Import kembali | Preview sebelum commit tampil jelas; data ter-update sesuai file; ada snapshot otomatis dibuat sebelum import jalan | ⬜ | |
| UAT-37 | Atur Pengaturan SMTP & jadwal notifikasi | Isi host/port/user/pass SMTP, set threshold hari macet & jam kirim | Pengaturan tersimpan (password tidak tampil lagi di layar), email test/terjadwal terkirim sesuai jam yg di-set | ⬜ | |
| UAT-38 | Opt-in notifikasi Order Macet sbg karyawan biasa | Isi Email di Profile, aktifkan opt-in notifikasi utk tahap yg relevan | Mulai menerima email Order Macet (PPTX terlampir) sesuai jadwal yg di-set Admin | ⬜ | |

---

## Sign-off Persetujuan

Dengan menandatangani bagian ini, perwakilan role menyatakan bahwa seluruh skenario UAT di bagiannya telah diuji dan diterima (atau dicatat kekurangannya untuk revisi sebelum go-live).

| Role | Nama | Tanda Tangan | Tanggal | Status Akhir |
|---|---|---|---|---|
| Operator/SPV Produksi | | | | ⬜ Diterima / ⬜ Revisi |
| Teknisi Maintenance | | | | ⬜ Diterima / ⬜ Revisi |
| Tim Quality Control | | | | ⬜ Diterima / ⬜ Revisi |
| Tim Approval/MRP-Sales | | | | ⬜ Diterima / ⬜ Revisi |
| Operator Cetak Label | | | | ⬜ Diterima / ⬜ Revisi |
| Admin (Full Access) | | | | ⬜ Diterima / ⬜ Revisi |
| Project Owner | | | | ⬜ Diterima / ⬜ Revisi |

---
*Dokumen ini direvisi 6 November 2026. Jalankan bersama perwakilan tiap role sebelum go-live, dan lengkapi kolom Catatan Tester untuk setiap temuan.*
