# Knowledge Base — Website NPI

Dokumentasi operasional untuk pengguna dan tim internal Website NPI (sistem pencatatan & monitoring produksi). Dokumen ini bersifat living document — akan terus diperbarui seiring bertambahnya fitur. *(Revisi 6 November 2026 — merangkum 178 commit sejak draft 4 Agustus 2026.)*

---

## 1. Overview Sistem

Website NPI adalah aplikasi web internal untuk mencatat dan memonitor seluruh alur produksi secara digital, menggantikan sistem manual/spreadsheet (versi sebelumnya berbasis Google Apps Script). Sistem ini mencakup tahap produksi dari Premix hingga Packing, Quality Control, pencetakan Label Produksi, Maintenance peralatan, hingga dashboard monitoring lintas tahap. Sejak akhir September 2026, aplikasi diakses dari server permanen **`http://mes.nipseapaint.com:8090`** (dikelola Tim IT) — bukan lagi dari laptop developer + ngrok.

**Struktur menu utama:**
- **Dashboard** — Produktivitas, Production Order Monitoring, Dashboard Colour Matching, Dashboard Quality, Dashboard Approval, Tank Monitoring, Mesin Monitoring
- **Production & MRP Schedule** — Premix, Milling, Aftermix, Colour Matching, Bongkaran, Approval, Packing (masing-masing punya tab **PWO Schedule & Queue**, kecuali Bongkaran)
- **Portal Quality Control** — Creating Product Spek, Input Check Results, Input Admin QC
- **Production Label** — Label Entry SFG, Label Entry FG
- **Maintenance** — form input + riwayat perbaikan Tanki/Mesin
- **Papan Info** — feed sosial internal + chat, tampil di halaman **Beranda**
- **Developer Tools** (Full Access saja) — User Management, Master Data, Backup & Storage, Pengaturan SMTP

## 2. Panduan Penggunaan per Menu

| Menu | Fungsi Singkat |
|---|---|
| Dashboard Produktivitas | Ringkasan jumlah Order/Batch selesai per tim, per IU Plant, per periode, dengan breakdown IU Plant & Tipe Tanki, dan Tanki Aktif |
| Dashboard Colour Matching | Monitoring khusus tahap Colour Matching: status per Order, aging Submit Cust, Edit/Hapus lewat pop-up |
| Dashboard Quality | (dulu "Quality Check Review") Status QC per Order (OK/Approval/Improve/Assorted (NG)/On Check), KPI **RFT** (Right First Time: Direct Passed vs Not Direct Passed), chart RFT Rate per Bulan (tahunan), breakdown **FLC**, kolom %GR, dan aging **Long Time Proses** |
| Dashboard Approval | KPI & filter worklist Order yang menunggu proses Approval |
| Production Order Monitoring | Status tiap Order lintas semua tahap (Proses Bar), kolom Tank Type, tombol **Pindah Tanki**, tombol ke **PWO Schedule & Queue**, kolom **Long Time Proses** (beku di `actEndDate` utk Order Done/Teco) |
| Tank Monitoring | Status okupansi tanki (Terisi/Kosong/Rusak), ikut pakai logika freeze Long Time Proses yang sama |
| Mesin Monitoring | Status okupansi mesin (Terpakai/Idle/Maintenance) — "Idle" otomatis begitu kolom Finish terisi; checkbox Maintenance auto-release begitu job Maintenance-nya selesai |
| Premix / Milling / Aftermix / Colour Matching | Input & History per tahap; tab **PWO Schedule & Queue** (List + Kalender) dengan drag-and-drop, booking tanki di muka, badge "Cooispi ⚠/✅" |
| Bongkaran | Input & History; TIDAK digerbangi tahap sebelumnya (bebas kapan saja) |
| Approval | Proses administrasi lot (status 4-tier: Prepare Approval → Wait Approval → Approval → Oke Approval), Cust Segmen + autocomplete Customer, Multiple Cust (catatan bebas), upload lampiran, tombol **Sync ke Google Sheet** di tab Lot History (akses dibatasi 5 NIK tertentu) |
| Packing | Input & History tahap akhir produksi |
| Creating Product Spec | Buat parameter standar spesifikasi per Material |
| Input Check Results | Input hasil pengecekan aktual + dropdown **FLC** (Reguler/FLC 1/FLC 2/FLC 3), dibandingkan otomatis dengan Product Spec (verdict Pass/Fail) |
| Input Admin QC | Tahap administrasi QC: Admin QC Stage (Approval/Improve/**Assorted (NG)**), Lot Passed, QC to Approval, QC Passed |
| Label Entry SFG | Cari Order → lengkapi field → cetak label ke printer Honeywell PC42T |
| Label Entry FG | Sama seperti SFG tapi tanpa cetak label fisik (hanya Save); pencarian bisa by Order **atau Batch** (saling fallback); untuk Material yang terdaftar di Master Part Yamaha, field Item No. Yamaha/Viskositas/SG/Qty Pack otomatis tampil & bisa **Download QR Code Yamaha** |
| Maintenance | Form Input (laporan kerusakan Tanki/Mesin), List Job (riwayat), Jadwal Pengerjaan (kalender); No Dok auto-generate format `MTN-YYYYMMDD-0001` |
| Master Data | Referensi Order/PO (SAP-COOISPI), Master Tanki, Master Mesin, Data Karyawan, Material Flow Proses, **Master Part Yamaha** |
| Backup & Storage | Backup/Restore database (pg_dump terjadwal + manual), retensi otomatis, Import & Export Data (Advance) ke/dari Excel |
| Pengaturan SMTP | Konfigurasi SMTP, threshold & jadwal notifikasi Order Macet |
| User Management | Kelola akun pengguna & level akses (khusus Full Access) |
| Papan Info (Beranda) | Posting + komentar + gambar (galeri swipe) + @mention/#hashtag, dan chat antar-user online |

## 3. Role & Level Akses

**Level akses global** (ditentukan per akun di User Management):
| Level | Keterangan |
|---|---|
| **FULL_ACCESS** | Akses penuh ke semua menu & fitur, termasuk User Management, Master Data, Backup & Storage, Pengaturan SMTP |
| **INPUT** | Bisa lihat & input data, tunduk pada pengaturan akses per-menu (lihat di bawah) |
| **VIEW** | Hanya bisa melihat data (History/Queue), tidak bisa menyimpan/input apapun |

**Akses per-menu** (View/Input/Hide) — berlaku untuk menu-menu produksi/QC/Maintenance:
- **Hide** → menu tidak muncul sama sekali di sidebar untuk user tsb
- **View** → tab Input disembunyikan, hanya bisa lihat History/Queue
- **Input** → akses penuh ke menu tsb, termasuk menghapus data History miliknya sendiri; checklist kolom wajib di panel "Info Proses Material" (Material Flow) juga bisa diedit oleh akses Input — hanya **import massal** Material Flow Proses (Master Data) yang tetap Full-Access-only.

> Kalau tombol **Hapus** tidak muncul di suatu History, berarti akun Anda levelnya **View** di menu tsb, atau memang menu itu tidak termasuk yang diberi akses Input.

**Akses dibatasi per-akun (bukan per-level)** — beberapa fitur sensitif dibatasi ke 5 NIK admin tertentu secara hardcode di backend (bukan cuma disembunyikan di UI), terlepas dari level akses globalnya:
- **Backup & Storage**: Restore database dan Hapus backup
- **Approval > Sync ke Google Sheet**: overwrite sheet "New List Approval"

## 4. Glossary / Istilah

| Istilah | Arti |
|---|---|
| **Order** | Nomor Production Order/PO, sumbernya dari data ekspor SAP-COOISPI |
| **Batch** | Nomor batch produksi untuk Order tertentu |
| **Code Tanki** | Kode tangki penyimpanan material yang dipakai di suatu tahap |
| **IU Plant** | Lokasi/unit produksi (IU Plant 1 s.d. 6) |
| **PWO Queue / PWO Schedule & Queue** | Antrian & penjadwalan Order yang sudah/akan memenuhi syarat untuk diinput ke tahap tertentu — punya tampilan List (chip drag-and-drop) dan Kalender (mingguan), termasuk fitur **Booking Tanki** (reservasi Code Tanki di muka, sebelum input proses sungguhan) |
| **Cooispi ⚠/✅** | Badge pada kartu jadwal: ✅ = Order sudah cocok dengan Master Data COOISPI (SAP); ⚠ = dijadwalkan manual lewat "+Input Manual Schedule" dan belum/tidak cocok dengan data SAP |
| **Stage Gate** | Aturan urutan tahap baku — suatu tahap tidak bisa diinput sebelum tahap prasyaratnya selesai (`- DN`). Order dengan Order Type **RF01/RF02 (Rework)** dikecualikan dari semua gate ini. Production Label (SFG) digerbangi tahap Milling (kecuali Order rework). |
| **Teco** | Status Order dengan %GR = 9999% (sentinel SAP) — artinya Order ditutup teknis/dibatalkan di SAP, bukan Order aktif biasa |
| **%GR** | Persentase Goods Receipt, data dari SAP |
| **Long Time Proses** | (dulu "Lama Menunggu" → "Lama Proses" → "Lead Time Proses") Lama waktu sejak sentuhan/input terakhir suatu Order. Untuk Order **Done** (%GR>95%), dibekukan di `actEndDate` SAP; untuk Order **Teco**, dihitung dari rentang sentuhan paling awal s.d. paling akhir (bukan 0) |
| **RFT (Right First Time)** | Pada Dashboard Quality: Order dgn status OK dianggap "Direct Passed" kalau SELURUH riwayat Check Results-nya selalu Pass, atau "Not Direct Passed" kalau pernah ada verdict Fail sebelumnya |
| **FLC (First Lot Control)** | Dropdown di Input Check Results: Reguler / FLC 1 / FLC 2 / FLC 3 — dipakai breakdown di Dashboard Quality |
| **Multiple Cust** | Catatan bebas (free text) di form Approval untuk pelanggan tambahan/sekunder pada Order yang sama — bukan baris terpisah |
| **Status Approval (4-tier)** | Prepare Approval → Wait Approval → Approval → Oke Approval, dihitung otomatis dari kelengkapan field (Prepare Date/Spray Man/dst → Submit Cust/Customer/dst → Finish App) |
| **Pindah Tanki** | Aksi memindahkan Code Tanki suatu Order ke tanki baru, menimpa seluruh baris proses historis Order tsb lintas modul (bukan sekadar catatan), dengan alasan wajib & jejak riwayat |
| **No Dok (Maintenance)** | Nomor dokumen laporan Maintenance, auto-generate format `MTN-YYYYMMDD-0001`, sekuens harian, tidak berubah saat diedit |
| **Lot Passed / QC to App / QC Passed** | Milestone administrasi di tahap Input Admin QC |
| **Material Type (KW/PST)** | Klasifikasi Paste / Kepala Warna / Assorted, diisi manual saat cetak Label Produksi |
| **QR Code Yamaha** | Kode gabungan khusus Material pelanggan Yamaha (format Lot+QtyPack+Item No. Yamaha), dibuat otomatis di Label Entry FG kalau Material terdaftar di Master Data > Master Part Yamaha |

## 5. FAQ

**Q: Bagaimana cara mencetak Label Produksi?**
A: Buka menu Production Label > Label Entry SFG (untuk cetak fisik) atau Label Entry FG (tanpa cetak, hanya Save — bisa dicari by Order maupun Batch) → cari nomor Order → data terkait otomatis terisi → lengkapi field manual → Cetak Label/Save.

**Q: Apa isi QR Code di label SFG?**
A: 9 field: Order, Batch, Material Number, Material Description, Lot No, Exp, IU Plant, Code Tanki, Material Type — dalam format teks per baris `Label: Value`.

**Q: Kenapa di Label Entry FG ada field Item No. Yamaha/Viskositas/SG/Qty Pack?**
A: Field ini SELALU tampil tapi hanya relevan untuk Material yang terdaftar di Master Data > Master Part Yamaha. Kalau Material-nya bukan Yamaha, field ini kosong dan Save tetap berjalan normal (tidak diblokir). Kalau terdaftar, isi Lot/Qty Pack untuk mengaktifkan tombol Download QR.

**Q: Kenapa akses saya ke suatu menu dibatasi?**
A: Hubungi Admin (akun Full Access) untuk pengecekan/pengubahan level akses lewat User Management. Untuk Backup & Storage (Restore/Hapus) dan Sync Google Sheet di Approval, akses dibatasi ke 5 akun admin tertentu terlepas dari level akses — ini bukan bug.

**Q: Kenapa data Order tidak ditemukan saat dicari?**
A: Order tersebut mungkin belum ada di Master Data (Referensi Order/PO) — perlu diimpor dulu lewat Master Data > Import. Untuk PWO Schedule & Queue, Order yang dijadwalkan manual sebelum sempat masuk SAP akan tetap muncul dengan badge "Cooispi ⚠".

**Q: Bagaimana cara ikut menerima notifikasi email Order Macet?**
A: Isi Email Anda di halaman Profile, lalu aktifkan opt-in notifikasi per tahap yang relevan dengan pekerjaan Anda. Email hanya terkirim kalau field Email terisi (satu email tidak boleh dipakai lebih dari satu karyawan).

**Q: Kenapa saya tiba-tiba logout padahal belum klik Logout?**
A: Sistem hanya mengizinkan **1 sesi login aktif per NIK**. Kalau NIK yang sama login di perangkat lain, sesi lama akan diakhiri dengan pesan "Sesi Anda diakhiri...". Kalau pesannya generik/tidak jelas dan muncul berulang padahal tidak ada yang login di tempat lain, kemungkinan IP/jaringan Anda berubah — laporkan ke IT.

## 6. Troubleshooting

| Gejala | Penyebab Umum | Solusi |
|---|---|---|
| Tombol Hapus tidak muncul | Level akses akun = View, atau menu tsb bukan level Input | Cek/ubah lewat User Management |
| Order tidak muncul di Mesin Monitoring sbg Terpakai | Kolom Finish di Milling untuk mesin tsb sudah terisi → mesin dianggap Idle lagi | Kosongkan Finish di Milling kalau memang belum selesai |
| Mesin/Tanki tidak bisa dipakai, berstatus "Maintenance"/"Rusak" | Ada job Maintenance aktif untuk kode tsb yang belum diisi tanggal Selesai | Selesaikan job di menu Maintenance (isi Tanggal Selesai) — status akan ter-release otomatis |
| Code Tanki Order perlu diganti tapi riwayat proses sudah banyak terisi | Perubahan fisik tanki di tengah proses (tanpa mengulang tahap) | Gunakan menu **Pindah Tanki** (dari Production Order Monitoring/Info Proses), bukan edit manual satu-satu |
| Halaman menampilkan badge "Cooispi ⚠" terus-menerus | Order belum/salah ketik saat dijadwalkan manual, belum cocok dgn Master Data COOISPI | Cek penulisan nomor Order, pastikan sudah ikut diimpor di Master Data |
| Tiba-tiba logout tanpa sebab jelas | Login dengan NIK sama di perangkat lain (single-session), atau IP/User-Agent berubah drastis | Login ulang; kalau sering terjadi tanpa sebab, laporkan ke IT (cek jaringan) |
| Aplikasi tidak bisa diakses | Server permanen (`mes.nipseapaint.com:8090`) sedang maintenance/down — BUKAN lagi masalah kuota ngrok (sudah tidak dipakai sejak migrasi) | Hubungi Tim IT |
| Halaman/menu error setelah update sistem | Kemungkinan berkaitan dengan perubahan terbaru | Screenshot error + info menu/URL, laporkan untuk investigasi |

## 7. Changelog (Ringkasan Update Utama)

| Tanggal | Update |
|---|---|
| 4–5 November 2026 | QR Code Yamaha digabung ke Label Entry FG (menu terpisah dihapus); rework field Qty Pack; freeze Long Time Proses diterapkan juga ke Tank Monitoring; fix migrasi database |
| 23 Oktober – 3 November 2026 | Fitur **Pindah Tanki** (pindah tanki + riwayat + Edit/Hapus); rename & rework **Dashboard Quality** (RFT, FLC, chart tahunan) jadi "Long Time Proses" dgn logic freeze Done/Teco; rombak besar **PWO Schedule & Queue** (Kalender, Booking Tanki, badge Cooispi, Input Manual Schedule); Tank Type column & tombol baru di Production Order Monitoring |
| Oktober 2026 | Notifikasi email Order Macet (opt-in per karyawan, SMTP settings web-based, lampiran PPTX); migrasi file storage Vercel Blob → local disk; keamanan sesi: single-session per NIK, binding IP/User-Agent |
| September 2026 | **Backup & Storage** (pg_dump terjadwal, retensi, staleness alert, Import/Export Data Advance); server "live" laptop (:5173) dihentikan — akses dipindah ke server permanen Tim IT (`mes.nipseapaint.com:8090`); Dashboard Colour Matching; Approval: Multiple Cust, 4-tier status, Cust Segmen, Sync ke Google Sheet (akses terbatas) |
| Agustus 2026 | Modul **Maintenance** (Tanki/Mesin rusak); PWO Schedule & Queue versi pertama (drag-and-drop); **Papan Info** (feed sosial + chat); Label Entry FG (menu baru, terpisah dari SFG); redesign tema login & aplikasi (merah/chemical-paint); Order Type RF01/RF02 dikecualikan dari stage gate |
| 4 Agustus 2026 | Fitur Production Label (Entry + History) dengan barcode CODE39 & QR Code; akses Input per-menu kini juga bisa menghapus History miliknya sendiri |
| 3 Agustus 2026 | Tahap Bongkaran ditambahkan; kontrol akses per-menu View/Input/Hide untuk 10 menu |
| 25 Juli 2026 | File storage dipindah dari Cloudflare R2 ke Vercel Blob (kemudian dipindah lagi ke local disk, Oktober 2026) |

---
*Dokumen ini adalah living document. Mohon dilengkapi/dikoreksi sesuai kebutuhan lapangan, terutama bagian FAQ dan Troubleshooting seiring bertambahnya pertanyaan dari user di lapangan.*
