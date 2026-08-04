# Business Requirements Document (BRD)
## Website NPI — Sistem Pencatatan & Monitoring Produksi

| | |
|---|---|
| **Nama Project** | Website NPI (repo: `websiteapp-npi`) |
| **Tanggal** | 4 Agustus 2026 |
| **Status** | Draft |
| **Versi** | 1.0 |

---

## 1. Latar Belakang

Proses pencatatan dan monitoring produksi saat ini masih dilakukan secara manual/menggunakan spreadsheet (versi sebelumnya berbasis Google Apps Script), mencakup banyak tahap produksi yang saling bergantung: Premix, Milling, Aftermix, Colour Matching, Bongkaran, Approval, Packing, hingga Quality Control. Proses manual ini rentan terhadap human error, duplikasi input, sulit ditelusuri riwayatnya, dan tidak memberikan visibilitas real-time lintas tahap kepada tim terkait maupun manajemen.

Website NPI dikembangkan sebagai sistem pengganti yang terpusat, untuk mencatat dan memonitor seluruh alur produksi secara digital, real-time, dan terstruktur.

Sosialisasi awal mengenai pengertian, manfaat, dan tujuan migrasi telah dilaksanakan kepada tim terkait pada **Senin, 3 Agustus 2026**, dan akun pengguna (User) untuk tim terkait telah dibuat di dalam sistem.

## 2. Tujuan

1. Mempercepat dan mengakuratkan proses pencatatan, monitoring, dan pelaporan produksi.
2. Menyediakan visibilitas real-time lintas tahap produksi bagi tim terkait dan manajemen.
3. Mengurangi risiko human error dan duplikasi input data.
4. Mempermudah penelusuran riwayat (history) tiap Order/Batch.
5. Menstandardisasi proses pencetakan label produksi (barcode & QR Code) untuk keperluan identifikasi dan traceability material.
6. Menjadi fondasi digitalisasi proses kerja produksi ke depan.

## 3. Ruang Lingkup (Scope)

### 3.1 Termasuk dalam Scope
- **Production & MRP Schedule**: Premix, Milling, Aftermix, Colour Matching, Bongkaran, Approval, Packing
- **Portal Quality Control**: Creating Product Spec, Input Check Results, Input Admin QC
- **Production Label**: Entry (cetak label barcode/QR untuk printer Honeywell PC42T) dan Label History
- **Dashboard**: Dashboard Produktivitas, Dashboard Approval, Production Order Monitoring, Tank Monitoring, Mesin Monitoring
- **Master Data**: Referensi Order/PO (import dari SAP-COOISPI), Material Flow Proses, Master Tanki, Master Mesin, Data Karyawan
- **User Management**: pengelolaan akun, dengan kontrol akses berjenjang per menu (View/Input/Hide) dan level Full Access

### 3.2 Tidak Termasuk dalam Scope (Saat Ini)
- **Purchase Requisition** (PR Entry, PR History, PR Monitoring) — masih placeholder, belum diimplementasikan
- Integrasi otomatis dua arah dengan SAP (saat ini masih import manual via file Excel/CSV hasil ekspor SAP-COOISPI)
- Hosting/infrastruktur permanen (lihat Bagian 7 — masih dalam tahap perencanaan bersama Tim IT)

## 4. Stakeholder

| Peran | Keterlibatan |
|---|---|
| Tim Produksi (Operator/SPV Premix, Milling, Aftermix, Colour Matching, Bongkaran, Packing) | Input data harian per tahap produksi |
| Tim Quality Control | Input Product Spec, Check Results, Admin QC |
| Tim Approval / MRP / Sales | Proses administrasi lot & approval |
| Admin (Full Access) | User Management, Master Data, konfigurasi akses |
| Tim IT | Infrastruktur, hosting, migrasi server permanen |
| Tim Digitalisasi Nippon Paint | Review project, dukungan strategi digitalisasi |

## 5. Kebutuhan Bisnis (Business Requirements)

| No | Kebutuhan |
|---|---|
| BR-1 | Sistem harus mencatat data produksi per tahap secara real-time, menggantikan pencatatan manual/spreadsheet |
| BR-2 | Sistem harus menyediakan dashboard monitoring lintas tahap (status Order, okupansi tanki/mesin, produktivitas tim) |
| BR-3 | Sistem harus mendukung kontrol akses berjenjang sesuai peran pengguna (View/Input/Hide per menu, Full Access) |
| BR-4 | Sistem harus dapat mencetak label produksi fisik (barcode CODE39 + QR Code) sesuai standar identifikasi material |
| BR-5 | Sistem harus menyimpan riwayat (history) tiap input, termasuk siapa dan kapan data diinput (audit trail) |
| BR-6 | Sistem harus dapat menerima data referensi Order/PO dari hasil ekspor SAP-COOISPI |
| BR-7 | Sistem harus dapat diakses secara stabil oleh seluruh tim terkait (lihat kendala di Bagian 7) |

## 6. Manfaat yang Diharapkan (Business Benefits)

- Data produksi terpusat, konsisten, dan mudah ditelusuri
- Monitoring real-time mengurangi keterlambatan identifikasi masalah produksi
- Mengurangi kesalahan pencatatan manual dan duplikasi data
- Traceability material lebih baik melalui label barcode/QR
- Dasar pengambilan keputusan berbasis data yang lebih akurat bagi manajemen

## 7. Kendala & Asumsi

- **Kendala infrastruktur saat ini**: Aplikasi masih dijalankan dari laptop kerja pribadi dengan akses publik sementara melalui ngrok, yang terkendala limit kuota bandwidth bulanan pada akun gratis (error `ERR_NGROK_725`). Hal ini menegaskan kebutuhan migrasi ke server/hosting permanen.
- **Rencana tindak lanjut**: Koordinasi dengan Tim IT untuk migrasi ke server permanen sedang dijadwalkan (lihat Notulen Rapat 3 Agustus 2026).
- **Asumsi**: Data referensi Order/PO dari SAP-COOISPI tetap diimpor secara manual (file Excel/CSV) hingga ada keputusan integrasi otomatis di fase berikutnya.
- **Penyimpanan file**: Lampiran/upload disimpan di layanan cloud storage pihak ketiga (Vercel Blob), bukan di server lokal.

## 8. Timeline / Milestone

| Tanggal | Milestone |
|---|---|
| 3 Agustus 2026 | Sosialisasi migrasi ke tim terkait (pengertian, manfaat, tujuan); setup akun User |
| 5 Agustus 2026 | Meeting dengan Tim IT — pembahasan migrasi ke server permanen |
| Berjalan | Hardening dashboard & modul produksi, training lanjutan per departemen |
| TBD | Migrasi ke hosting/server permanen (menunggu hasil koordinasi Tim IT) |

## 9. Kriteria Keberhasilan (Success Criteria)

1. Seluruh tahap produksi (Premix s.d. Packing & QC) tercatat melalui sistem, bukan lagi manual/spreadsheet.
2. Sistem dapat diakses secara stabil (tanpa kendala limit bandwidth/uptime) oleh seluruh tim terkait setelah migrasi ke server permanen.
3. Seluruh pengguna dari departemen terkait telah dilatih dan aktif menggunakan sistem.
4. Label produksi tercetak sesuai standar (barcode & QR terbaca dengan baik oleh scanner).

---
*Dokumen ini adalah draft awal, disusun berdasarkan konteks pengembangan project hingga 4 Agustus 2026. Mohon direview dan dilengkapi/dikoreksi oleh pihak terkait sebelum difinalisasi.*
