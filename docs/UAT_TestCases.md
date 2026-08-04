# User Acceptance Testing (UAT) — Website NPI

Skenario pengujian dari sudut pandang user asli, dilakukan oleh perwakilan tiap role setelah SIT selesai. Mengacu ke [User Guide](./UserGuide.md). Tujuan: memastikan sistem benar-benar bisa dipakai menyelesaikan pekerjaan sehari-hari, bukan cuma "berfungsi secara teknis".

| Status | Keterangan |
|---|---|
| ⬜ Belum diuji | ✅ Diterima | ❌ Ditolak (butuh perbaikan) |

---

## A. Operator/SPV Produksi

| No | Skenario | Langkah Pengujian | Hasil yang Diharapkan | Status | Catatan Tester |
|---|---|---|---|---|---|
| UAT-01 | Input data tahap produksi | Cari Order, isi form sesuai tahap (Premix/Milling/Aftermix/dst), Save | Data tersimpan, muncul di History | ⬜ | |
| UAT-02 | Edit data yang sudah pernah diinput | Cari ulang Order yang sudah pernah diinput | Form otomatis mode Edit dgn data lama terisi, bukan bikin baris baru | ⬜ | |
| UAT-03 | Pakai antrian PWO Queue | Buka tab PWO Queue, klik "Input [Tahap]" pada salah satu baris | Data Order langsung terbawa ke form Input, tidak perlu ketik ulang | ⬜ | |
| UAT-04 | Paham pesan error saat tahap belum boleh diinput | Coba input Colour Matching padahal Milling belum selesai | Pesan error jelas & bisa dipahami operator tanpa perlu tanya IT | ⬜ | |
| UAT-05 | Input multi-Pass di Milling | Tambah lebih dari 1 Pass Fineness/Visco/Suhu untuk 1 Order | Semua Pass tersimpan & bisa dilihat di History/dashboard | ⬜ | |
| UAT-06 | Hapus data yang salah input | Hapus 1 baris History di menu dengan akses Input | Tombol Hapus tersedia & berfungsi (kalau memang berhak) | ⬜ | |

## B. Tim Quality Control

| No | Skenario | Langkah Pengujian | Hasil yang Diharapkan | Status | Catatan Tester |
|---|---|---|---|---|---|
| UAT-07 | Buat Product Spec baru | Tambah Material + parameter standar | Spec tersimpan, siap dipakai acuan Check Results | ⬜ | |
| UAT-08 | Input Check Results & lihat verdict | Input hasil aktual utk Order tertentu | Verdict Pass/Fail muncul otomatis & sesuai ekspektasi QC | ⬜ | |
| UAT-09 | Input Admin QC & pantau progresnya | Isi Admin QC Stage, Lot Passed, QC to App, QC Passed | Data tersimpan, Order muncul di antrian Approval sesuai stage | ⬜ | |

## C. Tim Approval / MRP-Sales

| No | Skenario | Langkah Pengujian | Hasil yang Diharapkan | Status | Catatan Tester |
|---|---|---|---|---|---|
| UAT-10 | Proses antrian sesuai urutan FIFO | Buka List Antrian Approval | Urutan sesuai lama menunggu (paling lama duluan), sesuai ekspektasi kerja harian | ⬜ | |
| UAT-11 | Upload lampiran pendukung | Upload dokumen di form Approval | File tersimpan & bisa dibuka kembali kapan saja | ⬜ | |

## D. Operator Cetak Label Produksi

| No | Skenario | Langkah Pengujian | Hasil yang Diharapkan | Status | Catatan Tester |
|---|---|---|---|---|---|
| UAT-12 | Cetak label end-to-end | Ikuti langkah di User Guide Bagian 4 sampai label tercetak fisik | Label tercetak rapi, ukuran pas 100mm x 140mm di printer PC42T | ⬜ | |
| UAT-13 | Scan barcode & QR hasil cetak | Scan pakai scanner/HP yang biasa dipakai di lapangan | Semua data terbaca benar & jelas | ⬜ | |
| UAT-14 | Cek riwayat cetak | Buka Label History, cari label yang baru dicetak | Data lengkap & sesuai yang dicetak | ⬜ | |

## E. Admin (Full Access)

| No | Skenario | Langkah Pengujian | Hasil yang Diharapkan | Status | Catatan Tester |
|---|---|---|---|---|---|
| UAT-15 | Tambah user baru & atur akses | Buat akun baru, set level akses per-menu | User baru bisa login & akses sesuai yang diatur (tidak lebih tidak kurang) | ⬜ | |
| UAT-16 | Import Master Data Order | Import file hasil ekspor SAP-COOISPI | Data ter-import tanpa error, langsung terpakai di semua modul | ⬜ | |
| UAT-17 | Pantau dashboard monitoring | Buka Production Order Monitoring, Tank/Mesin Monitoring | Informasi akurat & mudah dibaca untuk pengambilan keputusan harian | ⬜ | |

---

## Sign-off Persetujuan

Dengan menandatangani bagian ini, perwakilan role menyatakan bahwa seluruh skenario UAT di bagiannya telah diuji dan diterima (atau dicatat kekurangannya untuk revisi sebelum go-live).

| Role | Nama | Tanda Tangan | Tanggal | Status Akhir |
|---|---|---|---|---|
| Operator/SPV Produksi | | | | ⬜ Diterima / ⬜ Revisi |
| Tim Quality Control | | | | ⬜ Diterima / ⬜ Revisi |
| Tim Approval/MRP-Sales | | | | ⬜ Diterima / ⬜ Revisi |
| Operator Cetak Label | | | | ⬜ Diterima / ⬜ Revisi |
| Admin (Full Access) | | | | ⬜ Diterima / ⬜ Revisi |
| Project Owner | | | | ⬜ Diterima / ⬜ Revisi |

---
*Dokumen ini adalah draft awal. Jalankan bersama perwakilan tiap role sebelum go-live, dan lengkapi kolom Catatan Tester untuk setiap temuan.*
