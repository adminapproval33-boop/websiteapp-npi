# System Integration Testing (SIT) — Website NPI

Skenario pengujian integrasi antar-modul, dilakukan oleh tim developer/teknis sebelum masuk tahap UAT. Fokus: memastikan data mengalir dengan benar lintas modul, aturan gating berjalan, dan kontrol akses ditegakkan di level backend (bukan cuma disembunyikan di UI).

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

## B. Stage Gate (Urutan Tahap Baku)

| No | Skenario | Langkah Pengujian | Hasil yang Diharapkan | Status |
|---|---|---|---|---|
| SIT-05 | Colour Matching diblokir sebelum Milling selesai | Input Order baru ke Colour Matching padahal Milling belum ada/belum Finish | Muncul pesan error "belum menyelesaikan tahap Milling", data tidak tersimpan | ⬜ |
| SIT-06 | Colour Matching lolos setelah Milling `- DN` | Selesaikan Milling (isi Finish) untuk Order tsb, ulangi input Colour Matching | Berhasil tersimpan | ⬜ |
| SIT-07 | Bongkaran TIDAK digerbangi tahap manapun | Input Bongkaran untuk Order yang belum ada histori tahap lain sama sekali | Berhasil tersimpan tanpa syarat | ⬜ |
| SIT-08 | Edit (bukan create) tidak terkena re-validasi gate | Order yang sudah lolos Colour Matching, coba edit data yang sama | Tidak muncul error gate lagi (mode Edit bebas) | ⬜ |

## C. Status Real-Time Antar Modul

| No | Skenario | Langkah Pengujian | Hasil yang Diharapkan | Status |
|---|---|---|---|---|
| SIT-09 | Mesin Monitoring reflect status Milling | Isi Code Mesin di Milling tanpa Finish → cek Mesin Monitoring | Status mesin = "Terpakai", occupant = Order tsb | ⬜ |
| SIT-10 | Mesin idle lagi setelah Finish terisi | Isi Finish pada baris Milling yang sama → cek Mesin Monitoring | Status mesin kembali "Idle" | ⬜ |
| SIT-11 | Production Order Monitoring Proses Bar akurat | Lengkapi Order dari Premix s.d. Packing satu per satu | Proses Bar/label status di dashboard ter-update benar di tiap tahap (Milling → Colour Matching → ... → Packing) | ⬜ |
| SIT-12 | Admin QC Stage mengalirkan Order ke antrian Approval | Isi Admin QC Stage = "Approval" utk suatu Order | Order tsb muncul di List Antrian Approval | ⬜ |
| SIT-13 | Check Results verdict vs Product Spec | Buat Product Spec dgn standar tertentu → input Check Results dgn hasil di luar standar | Verdict tampil "Fail" (bukan "Pass") | ⬜ |

## D. Production Label & Persistensi

| No | Skenario | Langkah Pengujian | Hasil yang Diharapkan | Status |
|---|---|---|---|---|
| SIT-14 | Cetak Label tersimpan ke History | Cetak label untuk suatu Order | Muncul baris baru di Label History dengan semua field & `printedBy` terisi | ⬜ |
| SIT-15 | QR Code berisi 9 field yang benar | Scan QR hasil cetak | Data yang muncul = Order, Batch, Material Number, Material Description, Lot No, Exp, IU Plant, Code Tanki, Material Type — sesuai form | ⬜ |
| SIT-16 | Barcode CODE39 terbaca scanner | Scan barcode Order & Batch di label fisik | Scanner membaca angka yang sama persis dengan yang tertera | ⬜ |

## E. Kontrol Akses (Backend, bukan cuma UI)

| No | Skenario | Langkah Pengujian | Hasil yang Diharapkan | Status |
|---|---|---|---|---|
| SIT-17 | Akses "Hide" benar-benar diblokir di backend | Set menu X = Hide utk user Y, coba panggil API menu X langsung (bukan lewat UI) pakai token user Y | API menolak (403), bukan cuma disembunyikan di sidebar | ⬜ |
| SIT-18 | Akses "View" tidak bisa input walau API dipanggil langsung | User dgn level View di menu X, coba POST data langsung ke endpoint menu X | Ditolak 403 | ⬜ |
| SIT-19 | Delete: Input-level cuma bisa hapus menu miliknya sendiri | User dgn akses Input HANYA di Milling, coba hapus data di History Packing | Tombol Hapus tidak muncul di Packing; kalau API dipanggil langsung, ditolak 403 | ⬜ |
| SIT-20 | Full Access bypass semua pembatasan | Login sbg Full Access, cek semua menu & tombol Hapus muncul di semua History | Semua akses lolos tanpa terkecuali | ⬜ |

## F. Import/Export & File

| No | Skenario | Langkah Pengujian | Hasil yang Diharapkan | Status |
|---|---|---|---|---|
| SIT-21 | Upload lampiran tersimpan & bisa diunduh kembali | Upload file di Approval/Admin QC/dsb | File berhasil diunggah ke Vercel Blob, link download berfungsi | ⬜ |
| SIT-22 | Export CSV dari DataTable sesuai data yang tampil (termasuk filter) | Filter History suatu modul, lalu Export CSV | Isi CSV cocok dengan baris yang sedang ditampilkan/difilter | ⬜ |

---
*Catatan: Test case ini disusun berdasarkan logika bisnis yang sudah diimplementasikan di kode per 4 Agustus 2026. Perlu dijalankan ulang di environment SIT sesungguhnya, dan ditambah skenario baru setiap ada fitur baru.*
