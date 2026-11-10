# Business Requirements Document (BRD)
## Website NPI — Sistem Pencatatan & Monitoring Produksi

| | |
|---|---|
| **Nama Project** | Website NPI (repo: `websiteapp-npi`) |
| **Tanggal** | 6 November 2026 (revisi 1 — draft awal 4 Agustus 2026) |
| **Status** | Draft (living document, direvisi seiring fitur baru) |
| **Versi** | 2.0 |

---

## 1. Latar Belakang

Proses pencatatan dan monitoring produksi saat ini masih dilakukan secara manual/menggunakan spreadsheet (versi sebelumnya berbasis Google Apps Script), mencakup banyak tahap produksi yang saling bergantung: Premix, Milling, Aftermix, Colour Matching, Bongkaran, Approval, Packing, hingga Quality Control. Proses manual ini rentan terhadap human error, duplikasi input, sulit ditelusuri riwayatnya, dan tidak memberikan visibilitas real-time lintas tahap kepada tim terkait maupun manajemen.

Website NPI dikembangkan sebagai sistem pengganti yang terpusat, untuk mencatat dan memonitor seluruh alur produksi secara digital, real-time, dan terstruktur.

Sosialisasi awal mengenai pengertian, manfaat, dan tujuan migrasi telah dilaksanakan kepada tim terkait pada **Senin, 3 Agustus 2026**, dan akun pengguna (User) untuk tim terkait telah dibuat di dalam sistem. Sejak draft pertama (4 Agustus 2026), sistem telah melalui 178+ commit pengembangan lanjutan: migrasi ke server permanen **sudah selesai** (lihat Bagian 7), dan lingkup modul bertambah signifikan (Maintenance, Backup & Storage, Pindah Tanki, Papan Info, notifikasi email, dsb — lihat Bagian 3.1).

## 2. Tujuan

1. Mempercepat dan mengakuratkan proses pencatatan, monitoring, dan pelaporan produksi.
2. Menyediakan visibilitas real-time lintas tahap produksi bagi tim terkait dan manajemen.
3. Mengurangi risiko human error dan duplikasi input data.
4. Mempermudah penelusuran riwayat (history) tiap Order/Batch, termasuk jejak perubahan tanki (Pindah Tanki) dan status perawatan peralatan (Maintenance).
5. Menstandardisasi proses pencetakan label produksi (barcode & QR Code) untuk keperluan identifikasi dan traceability material, termasuk kebutuhan khusus pelanggan (mis. QR Code format Yamaha).
6. Menjaga keamanan data operasional melalui backup otomatis terjadwal dan kontrol sesi login.
7. Menjadi fondasi digitalisasi proses kerja produksi ke depan.

## 3. Ruang Lingkup (Scope)

### 3.1 Termasuk dalam Scope
- **Production & MRP Schedule**: Premix, Milling, Aftermix, Colour Matching, Bongkaran, Approval, Packing — masing-masing dengan antrian **PWO Schedule & Queue** (tampilan List + Kalender, booking tanki di muka, deteksi Order yang belum masuk Master Data COOISPI)
- **Maintenance**: pencatatan perbaikan Tanki/Mesin rusak (Form Input, List Job, Jadwal Pengerjaan), auto-release status "Damaged" begitu pekerjaan selesai
- **Pindah Tanki**: pemindahan Code Tanki suatu Order secara retroaktif ke seluruh tahap yang sudah tercatat, lengkap dengan riwayat & alasan
- **Portal Quality Control**: Creating Product Spec, Input Check Results (+FLC — First Lot Control), Input Admin QC (termasuk status Assorted/NG)
- **Production Label**: Entry SFG & Entry FG (cetak label barcode/QR untuk printer Honeywell PC42T; Entry FG juga menghasilkan QR Code format Yamaha untuk Material yang terdaftar) dan Label History
- **Dashboard**: Dashboard Produktivitas, Dashboard Colour Matching, Dashboard Quality (RFT/FLC, menggantikan nama "Quality Check Review"), Dashboard Approval, Production Order Monitoring, Tank Monitoring, Mesin Monitoring
- **Master Data**: Referensi Order/PO (import dari SAP-COOISPI), Material Flow Proses, Master Tanki, Master Mesin, Data Karyawan, Master Part Yamaha
- **Developer Tools**: User Management, Master Data, **Backup & Storage** (backup/restore database + import-export data lanjutan), **Pengaturan SMTP** (notifikasi email Order Macet otomatis)
- **Papan Info & Chat**: feed sosial internal (posting, komentar, gambar, mention/hashtag) dan chat antar-user online, di halaman Beranda
- **User Management**: pengelolaan akun, dengan kontrol akses berjenjang per menu (View/Input/Hide) dan level Full Access

### 3.2 Tidak Termasuk dalam Scope (Saat Ini)
- **Purchase Requisition** (PR Entry, PR History, PR Monitoring) — masih placeholder, belum diimplementasikan
- Integrasi otomatis dua arah dengan SAP (saat ini masih import manual via file Excel/CSV hasil ekspor SAP-COOISPI)
- Sinkronisasi dua arah ke Google Sheets — fitur "Sync ke Google Sheet" di Approval bersifat satu arah (overwrite sheet dari data aplikasi) dan dibatasi hanya untuk 5 akun tertentu, bukan fitur umum

## 4. Stakeholder

| Peran | Keterlibatan |
|---|---|
| Tim Produksi (Operator/SPV Premix, Milling, Aftermix, Colour Matching, Bongkaran, Packing) | Input data harian per tahap produksi, pengajuan Pindah Tanki |
| Teknisi Maintenance | Input & update status perbaikan Tanki/Mesin |
| Tim Quality Control | Input Product Spec, Check Results (+FLC), Admin QC |
| Tim Approval / MRP / Sales | Proses administrasi lot & approval (4-tier status), sinkronisasi laporan ke Google Sheet (akses terbatas) |
| Admin (Full Access) | User Management, Master Data, Backup & Storage, Pengaturan SMTP |
| Tim IT | Hosting server permanen (`mes.nipseapaint.com:8090`), deploy rilis dari GitHub, dukungan infrastruktur |
| Tim Digitalisasi Nippon Paint | Review project, dukungan strategi digitalisasi |

## 5. Kebutuhan Bisnis (Business Requirements)

| No | Kebutuhan |
|---|---|
| BR-1 | Sistem harus mencatat data produksi per tahap secara real-time, menggantikan pencatatan manual/spreadsheet |
| BR-2 | Sistem harus menyediakan dashboard monitoring lintas tahap (status Order, okupansi tanki/mesin, produktivitas tim, status QC/RFT) |
| BR-3 | Sistem harus mendukung kontrol akses berjenjang sesuai peran pengguna (View/Input/Hide per menu, Full Access, serta pembatasan per-akun untuk fitur sensitif seperti Backup & Storage dan Sync Google Sheet) |
| BR-4 | Sistem harus dapat mencetak label produksi fisik (barcode CODE39 + QR Code) sesuai standar identifikasi material, termasuk format QR khusus pelanggan (Yamaha) |
| BR-5 | Sistem harus menyimpan riwayat (history) tiap input, termasuk siapa dan kapan data diinput (audit trail), termasuk riwayat Pindah Tanki dan Maintenance |
| BR-6 | Sistem harus dapat menerima data referensi Order/PO dari hasil ekspor SAP-COOISPI, dan menandai Order yang belum/belum cocok dengan data SAP (badge Cooispi ⚠/✅) |
| BR-7 | Sistem harus dapat diakses secara stabil oleh seluruh tim terkait melalui server permanen |
| BR-8 | Sistem harus mem-backup database secara otomatis terjadwal, dengan mekanisme catch-up kalau jadwal terlewat, retensi otomatis, dan peringatan kalau backup terakhir sudah terlalu lama (stale) |
| BR-9 | Sistem harus mengirim notifikasi email otomatis untuk Order yang macet/tertahan terlalu lama di suatu tahap, dengan opt-in per karyawan |
| BR-10 | Sistem harus membatasi satu sesi login aktif per akun (NIK), dan menolak permintaan dari perangkat dengan IP/User-Agent yang tidak cocok dengan sesi yang sedang berjalan |

## 6. Manfaat yang Diharapkan (Business Benefits)

- Data produksi terpusat, konsisten, dan mudah ditelusuri
- Monitoring real-time mengurangi keterlambatan identifikasi masalah produksi
- Mengurangi kesalahan pencatatan manual dan duplikasi data
- Traceability material lebih baik melalui label barcode/QR, termasuk kebutuhan spesifik pelanggan
- Dasar pengambilan keputusan berbasis data yang lebih akurat bagi manajemen (RFT, FLC, aging Order)
- Keamanan data operasional terjaga lewat backup otomatis & kontrol sesi login
- Notifikasi proaktif mengurangi Order yang "terlupakan" macet di suatu tahap

## 7. Kendala & Asumsi

- **Migrasi server — SELESAI**: aplikasi sebelumnya dijalankan dari laptop kerja pribadi dengan akses publik sementara melalui ngrok (terkendala limit kuota bandwidth, error `ERR_NGROK_725`). Per akhir September 2026, migrasi ke server permanen yang dikelola Tim IT **telah selesai** — aplikasi kini diakses di `http://mes.nipseapaint.com:8090`. Alur rilis: developer push kode ke GitHub → email Tim IT → Tim IT melakukan deploy di server mereka (bukan lagi deploy manual dari laptop developer).
- **Asumsi**: Data referensi Order/PO dari SAP-COOISPI tetap diimpor secara manual (file Excel/CSV) hingga ada keputusan integrasi otomatis di fase berikutnya.
- **Penyimpanan file**: Lampiran/upload sempat berpindah dari Cloudflare R2 → Vercel Blob, namun **per Oktober 2026 dipindah lagi ke local disk di server aplikasi sendiri** (folder `server/data/uploads/`) setelah Vercel Blob mengalami suspend akibat kuota transfer data gratis habis. Konsekuensinya, lampiran ini sekarang **perlu ikut dicakup dalam backup server** (lihat `ServerSpecification.md` Bagian 5) — beda dari asumsi draft sebelumnya.
- **Backup**: Sejak Oktober 2026, aplikasi punya mekanisme backup database otomatis bawaan (lihat `KnowledgeBase.md` — Backup & Storage), sehingga kebutuhan backup DB level-infrastruktur oleh Tim IT bisa jadi lapisan kedua (bukan satu-satunya mekanisme).

## 8. Timeline / Milestone

| Tanggal | Milestone |
|---|---|
| 3 Agustus 2026 | Sosialisasi migrasi ke tim terkait (pengertian, manfaat, tujuan); setup akun User |
| 5 Agustus 2026 | Meeting dengan Tim IT — pembahasan migrasi ke server permanen |
| Agustus–September 2026 | Modul besar baru: PWO Schedule & Queue (drag-and-drop + Kalender), Maintenance, Papan Info & Chat, Backup & Storage, redesign tema login/aplikasi |
| 11 September 2026 | Server "live" sementara (`:5173`, laptop developer) dihentikan; akses dipindah ke server permanen Tim IT |
| Oktober 2026 | Migrasi file storage ke local disk; Pengaturan SMTP + notifikasi email Order Macet; penguncian keamanan sesi (single-session, IP/UA binding) |
| Oktober–November 2026 | Pindah Tanki, rename & rework Dashboard Quality (RFT/FLC), rework PWO Schedule & Queue Kalender + Booking Tanki, Production Label FG + QR Code Yamaha |
| Berjalan | Hardening dashboard & modul produksi, training lanjutan per departemen |

## 9. Kriteria Keberhasilan (Success Criteria)

1. Seluruh tahap produksi (Premix s.d. Packing & QC) tercatat melalui sistem, bukan lagi manual/spreadsheet.
2. ✅ Sistem dapat diakses secara stabil melalui server permanen (`mes.nipseapaint.com:8090`) — migrasi dari laptop+ngrok telah selesai.
3. Seluruh pengguna dari departemen terkait telah dilatih dan aktif menggunakan sistem.
4. Label produksi tercetak sesuai standar (barcode & QR terbaca dengan baik oleh scanner), termasuk format khusus pelanggan.
5. Backup database otomatis berjalan konsisten tanpa intervensi manual, dengan indikator staleness yang dipantau Admin.

---
*Dokumen ini adalah living document. Revisi 1 (6 November 2026) merangkum 178 commit pengembangan sejak draft awal 4 Agustus 2026. Mohon direview dan dilengkapi/dikoreksi oleh pihak terkait.*
