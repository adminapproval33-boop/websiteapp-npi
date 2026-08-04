# Spesifikasi Server — Website NPI

Dokumen ini disiapkan sebagai bahan diskusi dengan Tim IT terkait migrasi dari setup sementara (laptop kerja + ngrok) ke server permanen. Angka-angka di bawah adalah **estimasi awal** untuk aplikasi internal skala kecil-menengah (bukan aplikasi publik/high-traffic) — sebaiknya disesuaikan lagi setelah server berjalan & dipantau penggunaan aktualnya.

---

## 1. Ringkasan Kebutuhan

Website NPI adalah aplikasi web internal (Node.js/Express + PostgreSQL di backend, React/Vite di frontend) untuk pencatatan & monitoring produksi, dipakai oleh staf Produksi/QC/Approval di satu lokasi pabrik. Karakteristik beban:
- Jumlah user bersamaan (concurrent) diperkirakan **puluhan**, bukan ratusan/ribuan
- Data yang disimpan berupa teks/metadata (bukan file media besar — lampiran/upload disimpan ke Vercel Blob, storage cloud pihak ketiga, **bukan** di server lokal)
- Trafik didominasi jam kerja pabrik (bukan 24/7 intensif)

## 2. Spesifikasi Software

| Komponen | Kebutuhan |
|---|---|
| Sistem Operasi | Linux (Ubuntu Server 22.04/24.04 LTS direkomendasikan) **atau** Windows Server 2019/2022 |
| Runtime | Node.js 20 LTS atau lebih baru |
| Database | PostgreSQL 18 (harus sama/kompatibel dengan versi development saat ini) |
| Web server / reverse proxy | Nginx atau Caddy (untuk serve frontend build + reverse proxy ke backend, plus SSL) |
| SSL/TLS | Sertifikat SSL (Let's Encrypt gratis, atau sertifikat internal perusahaan) — wajib kalau diakses lewat internet |
| Process manager | PM2 atau systemd service (supaya backend Node.js otomatis restart kalau crash/reboot server) |

## 3. Spesifikasi Hardware

| | Minimum | Direkomendasikan |
|---|---|---|
| **CPU** | 2 vCPU / core | 4 vCPU / core |
| **RAM** | 4 GB | 8 GB |
| **Storage** | 50 GB SSD | 100 GB SSD (untuk ruang tumbuh database + backup lokal) |
| **Uptime** | Server nyala 24/7, bukan dimatikan harian (beda dari setup laptop saat ini) |

> Estimasi ini untuk **1 instance** menjalankan backend + database + frontend static di server yang sama. Kalau ke depan traffic/data tumbuh signifikan, database bisa dipisah ke server/instance sendiri.

## 4. Kebutuhan Jaringan

- **IP Statis** (baik untuk akses internal-only maupun kalau nanti diekspos ke internet)
- **Domain** (opsional tapi direkomendasikan, mis. `npi.nipponpaint.internal` atau subdomain resmi perusahaan) — lebih rapi & memungkinkan SSL yang valid dibanding akses via IP
- **Firewall**: buka port 443 (HTTPS) untuk akses publik/internal, atau cukup port internal kalau aplikasi hanya untuk jaringan kantor (tidak perlu expose ke internet sama sekali kalau memang tidak dibutuhkan)
- Tentukan: apakah aplikasi ini perlu diakses **dari luar jaringan kantor** (mis. dari pabrik lain, WFH) atau **cukup intranet/LAN saja** — ini menentukan apakah perlu domain+SSL publik atau cukup akses internal

## 5. Storage & Backup

- Ukuran database saat ini masih kecil (aplikasi baru mulai dipakai aktif awal Agustus 2026) — akan bertambah seiring waktu berjalan (estimasi pertumbuhan perlu dipantau setelah beberapa bulan produksi berjalan)
- **Backup database rutin** (harian) sangat direkomendasikan — bisa pakai `pg_dump` terjadwal (cron/Task Scheduler) ke storage terpisah (bukan di disk yang sama)
- Lampiran/file upload **tidak perlu dibackup di server ini** — sudah tersimpan terpisah di Vercel Blob (cloud storage pihak ketiga)

## 6. Keamanan

- Akses database (`PostgreSQL`) **tidak boleh terekspos langsung ke internet** — hanya backend aplikasi yang boleh konek ke database (localhost/internal network saja)
- Environment variable sensitif (`DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, dll — lihat `server/.env.example`) disimpan aman di server, tidak pernah masuk ke source code/git
- Rencanakan proses rotasi/pergantian password database & token pihak ketiga secara berkala
- SSL/TLS wajib kalau aplikasi diakses lewat internet (bukan cuma intranet)

## 7. Opsi Deployment

| Opsi | Kelebihan | Kekurangan |
|---|---|---|
| **On-premise (server fisik/VM milik perusahaan)** | Kontrol penuh, data tidak keluar infrastruktur perusahaan, tidak ada biaya bulanan cloud | Perlu maintenance hardware sendiri, butuh IT untuk setup awal & patching |
| **Cloud VM (mis. AWS/GCP/Azure/DigitalOcean)** | Setup cepat, scaling mudah, ada opsi managed database & backup otomatis | Ada biaya bulanan berjalan, data tersimpan di infrastruktur pihak ketiga |
| **PaaS (mis. Render/Vercel — sempat disiapkan sbg opsi di kode, lihat komentar `API_BASE`)** | Paling minim maintenance, deploy otomatis dari GitHub | Kurang fleksibel untuk kebutuhan khusus, ada limit di plan gratis (persis masalah yang dialami dgn ngrok) |

**Rekomendasi diskusi dengan Tim IT**: pilih opsi yang sesuai kebijakan infrastruktur & keamanan data internal Nippon Paint — dokumen ini disiapkan supaya diskusi bisa langsung ke opsi konkret, bukan mulai dari nol.

---
*Dokumen ini adalah draft awal berbasis estimasi kebutuhan aplikasi skala kecil-menengah. Mohon direview & disesuaikan oleh Tim IT sesuai standar infrastruktur dan kebijakan keamanan Nippon Paint yang berlaku.*
