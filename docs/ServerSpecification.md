# Spesifikasi Server — Website NPI

Dokumen ini awalnya disiapkan sebagai bahan diskusi dengan Tim IT terkait migrasi dari setup sementara (laptop kerja + ngrok) ke server permanen. **Migrasi tersebut sudah selesai** (server permanen aktif sejak akhir September 2026, diakses di `http://mes.nipseapaint.com:8090`, dikelola Tim IT). Dokumen ini kini berfungsi sebagai (1) catatan kebutuhan asli yang diajukan, dan (2) referensi perubahan kebutuhan storage/backup yang terjadi SETELAH migrasi — spesifikasi hardware/OS detail dari server aktual ada di pihak Tim IT, bukan di sesi pengembangan ini.

*(Revisi 6 November 2026.)*

---

## 1. Ringkasan Kebutuhan

Website NPI adalah aplikasi web internal (Node.js/Express + PostgreSQL di backend, React/Vite di frontend) untuk pencatatan & monitoring produksi, dipakai oleh staf Produksi/QC/Approval di satu lokasi pabrik. Karakteristik beban:
- Jumlah user bersamaan (concurrent) diperkirakan **puluhan**, bukan ratusan/ribuan
- Trafik didominasi jam kerja pabrik (bukan 24/7 intensif)
- **Perubahan penting sejak draft awal**: lampiran/upload **tidak lagi** disimpan di layanan cloud pihak ketiga — sejak Oktober 2026 (migrasi dari Vercel Blob) semua file tersimpan di **local disk server itu sendiri** (folder `server/data/uploads/`, path override lewat env `UPLOADS_DIR`). Ini berarti kebutuhan backup & kapasitas disk server kini **harus** mencakup folder upload ini, berbeda dari asumsi draft pertama.

## 2. Status Migrasi & Alur Deploy Saat Ini

| | |
|---|---|
| **URL produksi** | `http://mes.nipseapaint.com:8090` |
| **Dikelola oleh** | Tim IT |
| **Alur rilis** | Developer push commit ke GitHub (branch yang disepakati) → email/notifikasi ke Tim IT → Tim IT menarik kode & deploy di server mereka. Developer **tidak** lagi deploy langsung dari laptop pribadi (skema lama `:5173` + ngrok sudah dihentikan sejak 11 September 2026). |
| **Jeda deploy** | Perlu diperhatikan — pernah terjadi server live tertinggal belasan commit/hari dari GitHub karena menunggu giliran deploy manual Tim IT. Developer disarankan cek versi live (lewat perilaku fitur yang diketahui, atau tanya Tim IT) sebelum mengasumsikan suatu fix sudah aktif. |
| **Migrasi database** | Prisma migration dijalankan oleh Tim IT saat deploy (`prisma migrate deploy`). Migrasi harus idempoten di database kosong/fresh — lihat SIT-35 di `SIT_TestCases.md` terkait insiden `DROP TABLE qr_code_yamaha` yang sempat gagal di server fresh (sudah diperbaiki). |

## 3. Spesifikasi Software

| Komponen | Kebutuhan |
|---|---|
| Sistem Operasi | Linux (Ubuntu Server 22.04/24.04 LTS direkomendasikan) **atau** Windows Server 2019/2022 — spesifik OS server aktual ditentukan & dikelola Tim IT |
| Runtime | Node.js 20 LTS atau lebih baru |
| Database | PostgreSQL 18 (harus sama/kompatibel dengan versi development) |
| Web server / reverse proxy | Nginx atau Caddy (serve frontend build + reverse proxy ke backend, plus SSL) — backend juga bisa langsung serve `web/dist` kalau build ada di folder yang sama (lihat commit "Serve built frontend from backend when web/dist exists") |
| SSL/TLS | Sertifikat SSL (Let's Encrypt gratis, atau sertifikat internal perusahaan) — wajib kalau diakses lewat internet |
| Process manager | PM2 atau systemd service (supaya backend Node.js otomatis restart kalau crash/reboot server) |

## 4. Spesifikasi Hardware

| | Minimum | Direkomendasikan |
|---|---|---|
| **CPU** | 2 vCPU / core | 4 vCPU / core |
| **RAM** | 4 GB | 8 GB |
| **Storage** | 50 GB SSD | 100 GB SSD — **naikkan alokasi** dibanding estimasi awal karena sekarang harus menampung: database + backup `.dump` harian (dgn retensi) + folder upload lampiran lokal |
| **Uptime** | Server nyala 24/7 | — (sudah terpenuhi sejak migrasi ke server permanen Tim IT) |

> Estimasi ini untuk **1 instance** menjalankan backend + database + frontend static + file upload lokal di server yang sama. Kalau ke depan traffic/data tumbuh signifikan, database/storage bisa dipisah ke instance sendiri.

## 5. Storage & Backup

- **Database**: aplikasi kini punya mekanisme **backup otomatis bawaan** (menu Developer Tools > Backup & Storage) — `pg_dump -Fc` terjadwal harian pada jam yang dikonfigurasi admin, dengan mekanisme catch-up (kalau jam terlewat krn server down, backup tetap jalan di polling berikutnya hari yang sama), retensi otomatis (hapus-by-age dan/atau hapus-by-count), dan peringatan staleness di UI kalau backup terakhir >36 jam. File backup tersimpan di folder lokal `backups/` (override via env `BACKUP_DIR`).
  - **Catatan**: sempat ada opsi salinan off-site ke cloud (Vercel Blob) tapi fitur ini sudah **dibatalkan/dihapus** di hari yang sama saat ditambahkan — backup saat ini **hanya local disk**, tidak ada salinan otomatis ke luar server. Tim IT **disarankan tetap punya lapisan backup infrastruktur sendiri** (mis. snapshot VM/disk harian ke lokasi terpisah) sebagai redundansi, karena backup bawaan aplikasi ini satu-satunya baris pertahanan kalau disk server itu sendiri rusak/hilang.
- **Lampiran/file upload**: **PERUBAHAN DARI DRAFT AWAL** — sekarang tersimpan di local disk server (`server/data/uploads/`), BUKAN lagi di Vercel Blob. Artinya folder ini **wajib** ikut dicakup dalam strategi backup Tim IT (baik lewat backup aplikasi bawaan yang mencakup DB saja, atau backup disk/VM level yang mencakup seluruh folder `server/data/`).
- Restore manual (`pg_restore --clean --if-exists --no-owner`) dan penghapusan backup dibatasi ke 5 NIK admin tertentu, bukan semua akun Full Access.

## 6. Keamanan

- Akses database (`PostgreSQL`) **tidak boleh terekspos langsung ke internet** — hanya backend aplikasi yang boleh konek ke database (localhost/internal network saja)
- Environment variable sensitif (`DATABASE_URL`, kredensial SMTP, Google Service Account untuk sync Approval, dll — lihat `server/.env.example`) disimpan aman di server, tidak pernah masuk ke source code/git. Password SMTP dienkripsi AES-256-GCM di database, tidak pernah dikirim balik ke browser.
- Server dikunci ke timezone **Asia/Jakarta** (WIB/GMT+7) secara eksplisit di kode (bukan bergantung timezone OS) — penting diperhatikan Tim IT kalau server fisik/VM berada di region/timezone berbeda, supaya tanggal roll-over & jadwal notifikasi/backup tetap akurat.
- Kontrol sesi login: satu sesi aktif per NIK (login di perangkat baru mengakhiri sesi lama), sesi terikat ke IP + User-Agent (request dari kombinasi berbeda ditolak tanpa meng-invalidate sesi aslinya), ada mode maintenance-lockdown (env `maintenanceMode` + `maintenanceAllowedNik`) untuk mengunci login ke satu NIK saja saat deploy/maintenance.
- Rencanakan proses rotasi/pergantian password database & token pihak ketiga (SMTP, Google Service Account) secara berkala
- SSL/TLS wajib kalau aplikasi diakses lewat internet (bukan cuma intranet)

## 7. Opsi Deployment

> Bagian ini dipertahankan sebagai catatan sejarah opsi yang pernah dipertimbangkan — keputusan final (on-premise/cloud VM, dikelola Tim IT) ada di pihak Tim IT dan di luar visibilitas sesi pengembangan ini.

| Opsi | Kelebihan | Kekurangan |
|---|---|---|
| **On-premise (server fisik/VM milik perusahaan)** | Kontrol penuh, data tidak keluar infrastruktur perusahaan, tidak ada biaya bulanan cloud | Perlu maintenance hardware sendiri, butuh IT untuk setup awal & patching |
| **Cloud VM (mis. AWS/GCP/Azure/DigitalOcean)** | Setup cepat, scaling mudah, ada opsi managed database & backup otomatis | Ada biaya bulanan berjalan, data tersimpan di infrastruktur pihak ketiga |
| **PaaS (mis. Render/Vercel)** | Paling minim maintenance, deploy otomatis dari GitHub | Kurang fleksibel, ada limit di plan gratis — persis masalah yang dulu dialami dgn ngrok DAN yang membuat Vercel Blob (file storage) di-suspend karena kuota transfer data habis; opsi ini terbukti kurang cocok untuk kebutuhan storage aplikasi ini |

---
*Dokumen ini direvisi 6 November 2026 untuk mencerminkan bahwa migrasi server sudah selesai dan model storage lampiran sudah berubah ke local disk. Spesifikasi hardware/OS presisi dari server aktual sebaiknya dikonfirmasi langsung ke Tim IT, bukan diasumsikan dari dokumen ini.*
