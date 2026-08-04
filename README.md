# Websiteapp NPI — Website Edition

Versi website mandiri dari "Websiteapp NPI" (sebelumnya Google Apps Script +
Google Sheets). Backend Node.js/Express/Prisma + PostgreSQL, frontend
React/Vite, monorepo lewat npm workspaces (`server/` + `web/`).

> Dokumentasi bisnis/end-user (BRD, Knowledge Base, User Guide, SIT/UAT test
> case) ada di folder [`docs/`](./docs). README ini fokus ke sisi teknis/
> source code untuk developer.

## Status saat ini (4 Agustus 2026)

Seluruh alur produksi utama sudah dibangun dan dipakai aktif secara internal:
- **Auth & User Management**: login NIK+password, sesi server-side (sliding
  expiration), proteksi brute-force, ganti password wajib di login pertama,
  3 level akses global (Full Access/Input/View) + kontrol akses **per-menu**
  (View/Input/Hide) untuk 10 menu produksi/QC — lihat `server/src/lib/menuAccess.ts`.
- **Production & MRP Schedule**: Premix, Milling (multi-Pass), Aftermix,
  Colour Matching, Bongkaran, Approval, Packing — tiap tahap py History,
  PWO Queue/antrian, dan sebagian digerbangi urutan tahap baku
  (`server/src/lib/stageGate.ts`, sumbernya Master Data "Material Flow Proses").
- **Portal Quality Control**: Creating Product Spec, Input Check Results
  (evaluasi Pass/Fail otomatis vs spec), Input Admin QC (Lot Passed/QC to
  App/QC Passed, standalone dari Approval).
- **Production Label**: cetak label produksi (barcode CODE39 Order & Batch +
  QR Code 9-field) untuk printer Honeywell PC42T (100mm x 140mm), tersimpan
  ke Label History tiap kali dicetak.
- **Dashboard**: Produktivitas (per IU Plant/periode), Approval, Production
  Order Monitoring (Proses Bar lintas tahap), Tank Monitoring, Mesin Monitoring.
- **Master Data**: Referensi Order/PO (import dari ekspor SAP-COOISPI),
  Material Flow Proses, Master Tanki, Master Mesin, Data Karyawan.
- **File storage**: lampiran/upload disimpan ke **Vercel Blob** (bukan disk
  lokal) — lihat catatan keamanan dependency di bawah.

**Belum dikerjakan**: Purchase Requisition (PR Entry/History/Monitoring) —
masih placeholder "Coming Soon" di menu, belum pernah diimplementasikan
(termasuk di versi Apps Script sebelumnya).

Catatan keamanan dependency: paket `xlsx` (SheetJS) tidak dipakai karena versi
npm-nya punya kerawanan HIGH severity tanpa fix resmi — diganti `exceljs`.
Jalankan `npm audit` sewaktu-waktu untuk cek ulang.

## Menjalankan tanpa Docker (jalur yang diverifikasi & dipakai sehari-hari)

Prasyarat: Node.js 20+, **PostgreSQL 18** terpasang & berjalan sebagai service lokal.

```powershell
# 1. Install semua dependency (root + server + web, via npm workspaces)
npm install

# 2. Siapkan database
copy server\.env.example server\.env
# edit server\.env: DATABASE_URL, BLOB_READ_WRITE_TOKEN (Vercel Blob), dst
cd server
npx prisma migrate dev
npm run seed        # buat akun Full Access pertama (NIK/password dari .env)
cd ..

# 3. Jalankan backend & frontend di 2 terminal terpisah
npm run dev:server   # http://localhost:4000  (health check: /api/health)
npm run dev:web      # http://localhost:5173  (proxy /api ke :4000, host:true jadi bisa diakses dari LAN)
```

Kalau butuh diakses dari luar jaringan kantor (demo/presentasi), jalankan
`ngrok http 5173` — cukup tunnel frontend saja, `/api` sudah di-proxy Vite.

## Menjalankan dengan Docker (belum diverifikasi ulang, cek dulu sebelum dipakai)

`docker-compose.yml` disiapkan sejak fase awal project, tapi **berpotensi usang**
dan belum di-update mengikuti perubahan terbaru — dua hal yang perlu dicek/
disesuaikan dulu sebelum dipakai:
- Image `postgres:16-alpine` di compose vs **PostgreSQL 18** yang dipakai jalur
  native saat ini (sebaiknya disamakan supaya perilaku identik).
- Env var `UPLOAD_DIR` (disk lokal) di compose sudah tidak relevan — kode
  saat ini upload lampiran ke **Vercel Blob** (`BLOB_READ_WRITE_TOKEN`), bukan
  disk lokal lagi.

```powershell
docker compose up -d --build
docker compose exec api npm run seed
```

## Struktur project

```
websiteapp-npi/
├─ docker-compose.yml      (lihat catatan di atas -- perlu diverifikasi ulang)
├─ docs/                   BRD, Knowledge Base, User Guide, SIT/UAT test cases
├─ server/                 Express + TypeScript + Prisma (PostgreSQL)
│  ├─ prisma/schema.prisma     skema seluruh modul + migrations/
│  └─ src/
│     ├─ modules/          1 folder per modul: auth, users, masterdata,
│     │                    premixAftermix, milling, colourMatching,
│     │                    bongkaran, packing, productSpec, checkResults,
│     │                    approval, adminQc, dashboard, productionLabel,
│     │                    tankManualInput, productionOrderManualInput
│     ├─ middleware/       requireAuth / requireWrite / requireFullAccess /
│     │                    requireMenuView / requireMenuInput
│     ├─ lib/              menuAccess.ts (kontrol akses per-menu),
│     │                    stageGate.ts (urutan tahap baku), session.ts
│     └─ scripts/          seed.ts
└─ web/                    React + Vite + TypeScript
   └─ src/
      ├─ layout/           Sidebar, Topbar, AppLayout, struktur menu (menu.tsx)
      ├─ auth/             AuthContext, ProtectedRoute
      ├─ api/              client fetch + penyimpanan sesi (sessionStorage)
      ├─ lib/              menuAccess.ts (mirror sisi frontend), printFit,
      │                    datetime, useResizableColWidths, dsb
      ├─ components/       DataTable, OrderLookup, EmployeeNameSelect,
      │                    BarcodeSvg, dsb -- dipakai lintas modul
      └─ pages/            1 folder per modul (mirror struktur server/modules)
```

## Catatan keamanan & perbedaan dari versi Apps Script

- Tidak ada lagi akun "Developer" khusus di luar tabel user — admin pertama
  dibuat lewat `npm run seed`, login lewat jalur yang sama seperti user lain.
- Password lama (hash SHA-256 di Sheet USER) tidak bisa dipulihkan ke
  plaintext.
- Endpoint List User khusus Full Access (di versi lama, siapa pun yang login
  bisa memanggil `listUsers`) — perbaikan otorisasi.
- Sinkronisasi dua-arah ke Google Sheets mirror (khusus modul Approval) tidak
  dibawa ke versi ini.
- Kontrol akses per-menu (View/Input/Hide) dan aturan "Input-level bisa hapus
  History menu miliknya sendiri" adalah fitur baru yang tidak ada di versi
  Apps Script — lihat `docs/KnowledgeBase.md` bagian Role & Akses.
