# Websiteapp NPI — Website Edition

Versi website mandiri dari "Websiteapp NPI" (sebelumnya Google Apps Script +
Google Sheets). Backend Node.js/Express/Prisma + PostgreSQL, frontend
React/Vite. Lihat rencana lengkap & progres fase di
`C:\Users\abdad\.claude\plans\keen-beaming-hellman.md`.

## Status saat ini: Fase 0-3 selesai. Menunggu file data untuk Fase 4 (migrasi)

Yang sudah bisa dipakai (seluruh modul fungsional versi lama sudah dibangun ulang):
- Login (NIK + password), sesi server-side dengan sliding expiration 30 menit
- Proteksi brute-force login (5x salah → kunci 5 menit)
- Ganti password (wajib untuk user hasil seed/migrasi pertama kali)
- User Management penuh (Create/Update/Delete/List) — khusus Full Access
- Import Referensi Order/PO & Code Tanki dari file CSV/Excel — khusus Full Access
- **Premix, Aftermix, Milling, Colour Matching, Packing, Production Process
  Entry**: form input + history (filter by Order + export CSV), lampiran untuk
  Premix/Aftermix
- **Creating Product Spek**: CRUD penuh (Edit/Delete khusus Full Access)
- **Input Check Results**: CRUD + upload appearance file + evaluasi pass/fail
  otomatis dari string spec (mis. "40-45", "<=28") + cetak Check Sheet & COA
  (halaman print A4 siap pakai, menggantikan pola window.open lama)
- **Approval Schedule**: input 21-field (dgn autofill dari histori Order
  sebelumnya) + Lot History (status & processing time otomatis, filter per
  kolom, export CSV) + lampiran (otomatis tercatat ke Remark) + **Approval
  Dashboard** (KPI age-bucket, grafik batang by Tech Name/Plant)
- Kerangka aplikasi (sidebar menu sama seperti versi lama, topbar, routing).
  Menu yang memang belum pernah diimplementasikan di versi lama (Production
  Label, Purchase Requisition, Tank/Production Order Monitoring, COOISPI
  Master Data, menu Employee master) tetap tampil sebagai "Coming Soon".

Belum dikerjakan: **Fase 4 — skrip migrasi data lama**. Menunggu Anda export
Sheet-sheet berikut ke CSV/Excel dan mengirimkannya: `USER`, `Approval
Schedule Log`, `Premix Log`, `Aftermix Log`, `Milling Log`, `Colour Matching
Log`, `Packing Log`, `Product Spec Log`, `Check Results Log`, referensi
PO/Order, dan daftar Code Tanki. Skrip importnya akan dibuat begitu file
tersedia supaya cocok dengan struktur kolom sebenarnya (bukan tebakan).

### Sebelum bisa dicoba langsung

Sistem ini butuh PostgreSQL yang hidup (lihat bagian "Menjalankan dengan
Docker" di atas). Belum ada uji coba end-to-end (login/CRUD sungguhan) karena
PC pengembangan belum punya Docker/Postgres terpasang — baru diverifikasi
lewat typecheck & build (semua bersih, 0 error) di setiap fase. Setelah
Postgres/Docker tersedia, jalankan `docker compose up -d --build` lalu
`docker compose exec api npm run seed`, dan coba alur: login → isi salah satu
form produksi → cek muncul di History → export CSV → (Full Access) coba User
Management & Import Master Data.

Catatan keamanan dependency: paket `xlsx` (SheetJS) tidak dipakai karena versi
npm-nya punya kerawanan HIGH severity tanpa fix resmi — diganti `exceljs`.
Masih ada 2 advisory MODERATE yang diterima sebagai risiko rendah: `esbuild`
(hanya memengaruhi `vite dev`, tidak dipakai di build produksi/nginx) dan
`uuid` transitif di dalam `exceljs` (dipakai hanya di endpoint import CSV
khusus admin Full Access). Jalankan `npm audit` sewaktu-waktu untuk cek ulang.

## Menjalankan dengan Docker (paling mudah)

Prasyarat: [Docker Desktop](https://www.docker.com/products/docker-desktop/)
terpasang (Windows/Mac/Linux — bisa untuk server lokal pabrik maupun VPS).

```powershell
docker compose up -d --build
docker compose exec api npm run seed   # buat akun Full Access pertama
```

- Website: http://localhost:8080
- API langsung (opsional, untuk debug): http://localhost:4000/api/health
- Login pertama pakai NIK & password dari `SEED_ADMIN_NIK` /
  `SEED_ADMIN_PASSWORD` di `docker-compose.yml` (default NIK `000001`,
  password `ChangeMe123!`) — Anda akan diminta ganti password saat login
  pertama.

Untuk pindah ke VPS nanti: copy folder project ini, jalankan perintah yang
sama di server tsb (ubah `CORS_ORIGIN` di `docker-compose.yml` ke domain
publiknya). Tidak ada perubahan kode.

## Menjalankan tanpa Docker (development)

Prasyarat: Node.js 20+, PostgreSQL 16 berjalan lokal.

```powershell
# 1. Install semua dependency (root + server + web, via npm workspaces)
npm install

# 2. Siapkan database
copy server\.env.example server\.env
# edit server\.env, sesuaikan DATABASE_URL ke Postgres lokal Anda
cd server
npx prisma migrate dev --name init
npm run seed
cd ..

# 3. Jalankan backend & frontend di 2 terminal terpisah
npm run dev:server   # http://localhost:4000
npm run dev:web      # http://localhost:5173 (proxy /api ke :4000)
```

## Struktur project

```
websiteapp-npi/
├─ docker-compose.yml
├─ server/            Express + TypeScript + Prisma (PostgreSQL)
│  ├─ prisma/schema.prisma   skema seluruh modul (termasuk yg belum dibangun)
│  └─ src/
│     ├─ modules/     auth, users, masterdata (bertambah tiap fase)
│     ├─ middleware/  requireAuth / requireWrite / requireFullAccess
│     └─ scripts/     seed.ts (+ skrip import migrasi di Fase 4)
└─ web/               React + Vite + TypeScript
   └─ src/
      ├─ layout/       Sidebar, Topbar, AppLayout, struktur menu (menu.tsx)
      ├─ auth/          AuthContext, ProtectedRoute
      ├─ api/           client fetch + penyimpanan sesi (sessionStorage)
      └─ pages/         1 folder per modul
```

## Catatan keamanan & perbedaan dari versi Apps Script

- Tidak ada lagi akun "Developer" khusus di luar tabel user — admin pertama
  dibuat lewat `npm run seed`, login lewat jalur yang sama seperti user lain.
- Password lama (hash SHA-256 di Sheet USER) tidak bisa dipulihkan ke
  plaintext. Saat migrasi data user (Fase 4), setiap akun akan mendapat
  password sementara = NIK masing-masing dan wajib ganti password di login
  pertama — informasikan ke tim sebelum go-live.
- Endpoint List User sekarang khusus Full Access (di versi lama, siapa pun
  yang login bisa memanggil `listUsers`) — perbaikan otorisasi.
- Sinkronisasi dua-arah ke Google Sheets mirror (khusus modul Approval) tidak
  dibawa ke versi ini — sudah tidak relevan karena data kini bisa
  difilter/diedit/diexport langsung di website.
