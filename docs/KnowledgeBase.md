# Knowledge Base — Website NPI

Dokumentasi operasional untuk pengguna dan tim internal Website NPI (sistem pencatatan & monitoring produksi). Dokumen ini bersifat living document — akan terus diperbarui seiring bertambahnya fitur.

---

## 1. Overview Sistem

Website NPI adalah aplikasi web internal untuk mencatat dan memonitor seluruh alur produksi secara digital, menggantikan sistem manual/spreadsheet (versi sebelumnya berbasis Google Apps Script). Sistem ini mencakup tahap produksi dari Premix hingga Packing, Quality Control, pencetakan Label Produksi, hingga dashboard monitoring lintas tahap.

**Struktur menu utama:**
- **Dashboard** — Produktivitas, Approval, Production Order Monitoring, Tank Monitoring, Mesin Monitoring
- **Production & MRP Schedule** — Premix, Milling, Aftermix, Colour Matching, Bongkaran, Approval, Packing
- **Portal Quality Control** — Creating Product Spec, Input Check Results, Input Admin QC
- **Production Label** — Production Label Entry, Label History
- **Developer Tools** (Full Access saja) — User Management, Master Data

## 2. Panduan Penggunaan per Menu

| Menu | Fungsi Singkat |
|---|---|
| Dashboard Produktivitas | Ringkasan jumlah Order/Batch selesai per tim, per IU Plant, per periode (Hari Ini/Minggu Ini/Bulan Ini/Semua) |
| Dashboard Approval | Worklist Order yang menunggu proses Approval |
| Production Order Monitoring | Status tiap Order lintas semua tahap (Proses Bar), termasuk okupansi tanki & Code Tanki |
| Tank Monitoring | Status okupansi tanki (Terisi/Kosong), digabung dari semua modul yang memakai tanki |
| Mesin Monitoring | Status okupansi mesin Milling (Terpakai/Idle) — status "Idle" lagi otomatis begitu kolom Finish di Milling terisi |
| Premix / Aftermix | Input & History tahap Premix/Aftermix; ada PWO Queue (antrian Order yang siap diinput) |
| Milling | Input & History (mendukung multi-Pass Fineness/Visco/Suhu); Code Mesin dipakai Mesin Monitoring |
| Colour Matching | Input & History; hanya bisa diinput setelah tahap sebelumnya (Milling/Premix) selesai (`- DN`) |
| Bongkaran | Input & History; PWO Schedule & Queue TIDAK digerbangi tahap sebelumnya (bebas kapan saja) |
| Approval | Proses administrasi lot (MRP/Sales PIC, Lot COA, dsb), termasuk upload lampiran |
| Packing | Input & History tahap akhir produksi |
| Creating Product Spec | Buat parameter standar spesifikasi per Material |
| Input Check Results | Input hasil pengecekan aktual, dibandingkan otomatis dengan Product Spec (verdict Pass/Fail) |
| Input Admin QC | Tahap administrasi QC: Admin QC Stage, Lot Passed, QC to Approval, QC Passed |
| Production Label Entry | Cari Order → lengkapi Lot No/Exp/Material Type/Drum Colour → cetak label ke printer Honeywell PC42T (100mm x 140mm), berisi barcode CODE39 (Order & Batch) + QR Code |
| Label History | Riwayat semua label yang pernah dicetak |
| Master Data | Kelola Referensi Order/PO (import dari SAP-COOISPI), Material Flow Proses, Master Tanki, Master Mesin, Data Karyawan |
| User Management | Kelola akun pengguna & level akses (khusus Full Access) |

## 3. Role & Level Akses

**Level akses global** (ditentukan per akun di User Management):
| Level | Keterangan |
|---|---|
| **FULL_ACCESS** | Akses penuh ke semua menu & fitur, termasuk User Management dan Master Data |
| **INPUT** | Bisa lihat & input data, tunduk pada pengaturan akses per-menu (lihat di bawah) |
| **VIEW** | Hanya bisa melihat data (History/Queue), tidak bisa menyimpan/input apapun |

**Akses per-menu** (View/Input/Hide) — berlaku untuk 10 menu: Premix, Milling, Aftermix, Colour Matching, Bongkaran, Approval, Packing, Creating Product Spec, Input Check Results, Input Admin QC:
- **Hide** → menu tidak muncul sama sekali di sidebar untuk user tsb
- **View** → tab Input disembunyikan, hanya bisa lihat History/Queue
- **Input** → akses penuh ke menu tsb, termasuk **menghapus data History miliknya sendiri** (per pembaruan terbaru — sebelumnya hapus hanya bisa oleh Full Access)

> Kalau tombol **Hapus** tidak muncul di suatu History, berarti akun Anda levelnya **View** di menu tsb, atau memang menu itu tidak termasuk yang diberi akses Input.

## 4. Glossary / Istilah

| Istilah | Arti |
|---|---|
| **Order** | Nomor Production Order/PO, sumbernya dari data ekspor SAP-COOISPI |
| **Batch** | Nomor batch produksi untuk Order tertentu |
| **Code Tanki** | Kode tangki penyimpanan material yang dipakai di suatu tahap |
| **IU Plant** | Lokasi/unit produksi (IU Plant 1 s.d. 6) |
| **PWO Queue** | Antrian Order yang sudah memenuhi syarat untuk diinput ke tahap tertentu, tapi belum diinput |
| **Stage Gate** | Aturan urutan tahap baku — suatu tahap tidak bisa diinput sebelum tahap prasyaratnya selesai (`- DN`) |
| **%GR** | Persentase Goods Receipt, data dari SAP |
| **Lot Passed / QC to App / QC Passed** | Milestone administrasi di tahap Input Admin QC |
| **Material Type (KW/PST)** | Klasifikasi Paste / Kepala Warna / Assorted, diisi manual saat cetak Label Produksi |

## 5. FAQ

**Q: Bagaimana cara mencetak Label Produksi?**
A: Buka menu Production Label Entry → cari nomor Order → data Material Number/Description/Batch/Order Qty/Plant otomatis terisi, Code Tanki/IU Plant/Remark ikut auto-fill dari input terakhir di modul lain (tapi bisa diedit) → lengkapi Lot No/Exp/Material Type/Drum Colour secara manual → klik Cetak Label.

**Q: Apa isi QR Code di label?**
A: 9 field: Order, Batch, Material Number, Material Description, Lot No, Exp, IU Plant, Code Tanki, Material Type — dalam format teks per baris `Label: Value`.

**Q: Kenapa akses saya ke suatu menu dibatasi?**
A: Hubungi Admin (akun Full Access) untuk pengecekan/pengubahan level akses lewat User Management.

**Q: Kenapa data Order tidak ditemukan saat dicari?**
A: Order tersebut mungkin belum ada di Master Data (Referensi Order/PO) — perlu diimpor dulu lewat Master Data > Import.

## 6. Troubleshooting

| Gejala | Penyebab Umum | Solusi |
|---|---|---|
| Tombol Hapus tidak muncul | Level akses akun = View, atau menu tsb bukan level Input | Cek/ubah lewat User Management |
| Order tidak muncul di Mesin Monitoring | Kolom Finish di Milling untuk mesin tsb sudah terisi → mesin dianggap Idle lagi | Kosongkan Finish di Milling kalau memang belum selesai |
| Code Tanki/IU Plant kosong saat cetak Label | Belum ada input untuk Order tsb di modul manapun (Premix/Aftermix/Milling/Approval/Admin QC) | Isi manual di form Cetak Label |
| Aplikasi tidak bisa diakses dari luar kantor | Kuota bandwidth ngrok (plan gratis) habis — `ERR_NGROK_725` | Tunggu reset bulanan, upgrade plan, atau pakai akses jaringan lokal sementara |
| Halaman/menu error setelah update sistem | Kemungkinan berkaitan dengan perubahan terbaru | Screenshot error + info menu/URL, laporkan untuk investigasi |

## 7. Changelog (Ringkasan Update Utama)

| Tanggal | Update |
|---|---|
| 4 Agustus 2026 | Fitur Production Label (Entry + History) dengan barcode CODE39 & QR Code; akses Input per-menu kini juga bisa menghapus History miliknya sendiri |
| 3 Agustus 2026 | Tahap Bongkaran ditambahkan; kontrol akses per-menu View/Input/Hide untuk 10 menu |
| Akhir Juli 2026 | Order Type ditambahkan ke Master Data & dashboard; auto-fit kolom tabel |
| Akhir Juli 2026 | Sequential stage-order gating, Material Flow master data, Tank Manual Input |
| Akhir Juli 2026 | Rework logika antrian & status tahap produksi |
| Akhir Juli 2026 | Admin QC dipisah dari Approval; layout Milling/Approval direvisi |
| 25 Juli 2026 | File storage dipindah dari Cloudflare R2 ke Vercel Blob |

---
*Dokumen ini adalah draft awal. Mohon dilengkapi/dikoreksi sesuai kebutuhan lapangan, terutama bagian FAQ dan Troubleshooting seiring bertambahnya pertanyaan dari user di lapangan.*
