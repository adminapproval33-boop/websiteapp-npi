# User Guide — Website NPI (Per Role)

Panduan langkah demi langkah penggunaan Website NPI, dikelompokkan berdasarkan peran pengguna. Login terlebih dahulu menggunakan NIK dan password yang diberikan Admin sebelum mengikuti panduan di bawah. Akses aplikasi di `http://mes.nipseapaint.com:8090`. *(Revisi 6 November 2026.)*

> **Catatan sesi login**: sistem hanya mengizinkan 1 sesi aktif per NIK. Kalau Anda login di perangkat baru saat sesi lama masih aktif, akan ada konfirmasi "paksa login" — sesi lama otomatis berakhir begitu Anda konfirmasi.

---

## 1. Panduan untuk Operator/SPV Produksi
*(Berlaku untuk tahap: Premix, Milling, Aftermix, Colour Matching, Bongkaran, Packing — polanya serupa di semua tahap ini)*

### 1.1 Alur Umum Input Data
1. Buka menu tahap Anda (mis. **Production & MRP Schedule > Milling**).
2. Pastikan berada di tab **Input**.
3. Ketik nomor **Order** di kolom pencarian, lalu tekan **Enter**.
   - Data Material Number, Material Description, Batch, Order Qty, Plant akan otomatis terisi dari Master Data.
   - Kalau Order ini sudah pernah diinput sebelumnya di tahap yang sama, form otomatis masuk **mode Edit** (bukan bikin baris baru).
4. Lengkapi field yang tersisa (SPV Produksi, Leader, Member, Code Tanki, IU Plant, Start/Finish, dst — field spesifik beda-beda tiap tahap).
5. Klik **Save Data**.
6. Cek hasilnya di tab **History** — cari nomor Order Anda untuk verifikasi.

### 1.2 Catatan Khusus per Tahap
- **Colour Matching**: hanya bisa diinput setelah tahap sebelumnya (Milling, atau Premix kalau Milling di-skip) sudah berstatus selesai (`- DN`). Kalau muncul pesan "belum menyelesaikan tahap X", cek dulu status Order di Production Order Monitoring.
- **Milling**: mendukung banyak **Pass** (Fineness/Visco/Suhu) untuk satu Order, dan mendukung **multi-tank** (tanki turunan) kalau satu Order memakai lebih dari satu tanki.
- **Bongkaran**: TIDAK bergantung pada tahap lain, bisa diinput kapan saja.
- **Packing**: tahap akhir, tidak ada prasyarat administrasi QC. Mendukung input Qty/Pcs per anggota tim (per-Member).
- **Order Type RF01/RF02 (Rework)**: dikecualikan dari semua aturan urutan tahap di atas — Order rework bisa langsung diinput ke tahap manapun tanpa perlu menunggu tahap sebelumnya.

### 1.3 Antrian & Penjadwalan (PWO Schedule & Queue)
Setiap tahap (kecuali Bongkaran) punya tab **PWO Schedule & Queue** dengan dua tampilan:
- **List**: daftar chip Order yang bisa di-drag (geser urutan) & dipilih banyak sekaligus (multi-select). Klik **Input [Nama Tahap]** pada chip untuk langsung membawa data Order tsb ke form Input.
- **Kalender**: tampilan mingguan. Di sini Anda bisa:
  - Melihat jadwal Order per hari.
  - **Booking Tanki** di muka — reservasi Code Tanki untuk Order yang direncanakan diproses nanti, sebelum input proses sungguhan dilakukan (lewat tombol **+Input Manual Schedule**, dengan Code Tanki opsional).
  - Melihat badge **"Cooispi ⚠/✅"** pada tiap kartu: ✅ artinya Order sudah cocok dengan data Master Data COOISPI (SAP); ⚠ artinya Order dijadwalkan manual dan belum/tidak cocok — cek kembali penomoran Order atau tunggu data SAP ter-import.
  - Kartu **Overdue** (⚠ belum dikerjakan) bisa dihapus (✕) atau digeser sama seperti kartu kalender biasa.

### 1.4 Pindah Tanki
Kalau tanki fisik yang dipakai suatu Order berubah di tengah proses (mis. tanki rusak, dipindah ke tanki lain) TANPA mengulang tahap produksi:
1. Buka **Pindah Tanki** (tombol di Production Order Monitoring, atau lewat pop-up Info Proses Order terkait).
2. Cari nomor **Order**.
3. Cek **Tanki Awal** yang ditampilkan (tanki yang sedang berlaku untuk Order ini).
4. Pilih **Tanki Baru**, isi **Alasan Pindah** (wajib).
5. Submit — sistem otomatis memperbarui Code Tanki di SEMUA baris proses historis Order tsb (Milling, Colour Matching, Approval, Packing, dll) yang masih mereferensikan tanki lama, dan mencatat jejaknya.
6. Cek tab **Riwayat** di pop-up yang sama untuk melihat semua pemindahan tanki yang pernah dilakukan — bisa di-Edit (akan mengeksekusi ulang pemindahan dengan data baru) atau Hapus (hanya menghapus catatan riwayatnya, tidak membatalkan perubahan tanki yang sudah terjadi).

> Order yang belum pernah diinput di modul manapun tidak bisa diproses Pindah Tanki (tidak ada yang bisa dipindah).

### 1.5 Melaporkan Kerusakan Tanki/Mesin (Maintenance)
1. Buka menu **Maintenance**.
2. Tab **Form Input**: isi Equipment Type (kode Tanki/Mesin), Deskripsi Kerusakan, Pelapor, Priority, lalu Simpan — No Dok akan dibuat otomatis.
3. Tanki/Mesin terkait otomatis berstatus "Rusak"/"Maintenance" di dashboard (Tank Monitoring/Mesin Monitoring) sampai pekerjaan selesai.
4. Teknisi akan melengkapi Jadwal Pengerjaan → Tanggal Mulai → Tanggal Selesai di tab **List Job Maintenance**; begitu Tanggal Selesai terisi, status Tanki/Mesin otomatis kembali normal tanpa perlu diubah manual.
5. Cek jadwal semua pekerjaan Maintenance di tab **Jadwal Pengerjaan** (tampilan kalender).

### 1.6 Menghapus Data
Kalau akun Anda punya akses **Input** di menu tsb, tombol **Hapus (🗑️)** akan muncul di History untuk data yang salah/perlu dihapus. Kalau tidak muncul, hubungi Admin.

---

## 2. Panduan untuk Tim Quality Control

### 2.1 Creating Product Spec
1. Buka **Portal Quality Control > Creating Product Spek**.
2. Isi Material Number/Description terkait.
3. Tambahkan baris parameter (No, Item Check, Standard Spec, Unit) — bisa diurutkan ulang dengan drag-and-drop.
4. Simpan — spec ini akan jadi acuan otomatis saat Check Results diinput untuk Material yang sama.

### 2.2 Input Check Results
1. Buka **Portal Quality Control > Input Check Results**.
2. Cari Order, lalu isi hasil pengecekan aktual untuk tiap parameter yang sudah didefinisikan di Product Spec.
3. Pilih **FLC** (First Lot Control): Reguler / FLC 1 / FLC 2 / FLC 3, sesuai status pengecekan Order ini.
4. Sistem otomatis membandingkan hasil dengan standar dan menampilkan **verdict Pass/Fail**.
5. Simpan.

### 2.3 Input Admin QC
1. Buka **Portal Quality Control > Input Admin QC**.
2. Cari Order, isi **Admin QC Stage** (Approval / Improve / **Assorted (NG)**), lalu isi tanggal **Lot Passed**, **QC to Approval**, **QC Passed** sesuai progres administrasi.
3. Data ini akan otomatis mengalirkan Order ke antrian menu **Approval** (kecuali Assorted (NG), yang punya alur tersendiri).

### 2.4 Membaca Dashboard Quality
1. Buka **Dashboard > Dashboard Quality** (dulu bernama "Quality Check Review").
2. Lihat status tiap Order: OK, Approval, Improve, Assorted (NG), atau On Check.
3. Perhatikan kolom/KPI **RFT (Right First Time)**: Order dengan status OK akan ditandai **Direct Passed** kalau seluruh riwayat Check Results-nya selalu Pass, atau **Not Direct Passed** kalau pernah ada hasil Fail sebelum akhirnya Pass.
4. Chart **RFT Rate per Bulan** menampilkan tren Direct Passed sepanjang tahun yang dipilih.
5. Gunakan breakdown **FLC** dan kolom **%GR** untuk analisis lebih lanjut.
6. Kolom **Long Time Proses** menunjukkan lama Order "menggantung" sejak sentuhan terakhir — untuk Order yang sudah Done, angka ini dibekukan di tanggal selesai aktualnya (tidak terus bertambah).

---

## 3. Panduan untuk Tim Approval / MRP-Sales

1. Buka **Production & MRP Schedule > Approval**.
2. Cek tab **List Antrian Approval** — berisi Order yang Admin QC Stage-nya sudah "Approval"/"Joint Lot" dan menunggu diproses, diurutkan FIFO (paling lama menunggu duluan).
3. Klik **Input Approval** pada baris yang mau diproses.
4. Lengkapi field administrasi (MRP PIC, Sales PIC, Prepare Produksi, Spray Man, Cust Segmen, Customer — bisa pakai autocomplete, Multiple Cust kalau ada pelanggan tambahan, Lot COA, dst).
5. Upload lampiran pendukung lewat tombol **Lampiran** kalau ada dokumen terkait.
6. Simpan — status Order akan berubah otomatis mengikuti kelengkapan field: **Prepare Approval → Wait Approval → Approval → Oke Approval** (begitu Finish App terisi).
7. Di tab **Lot History**, kolom %GR selalu menampilkan data terbaru dari SAP (live), dan bisa diedit langsung oleh akses Input.
8. *(Khusus 5 akun admin tertentu)* tombol **Sync ke Google Sheet** di Lot History akan menimpa isi Google Sheet "New List Approval" sesuai filter yang sedang aktif — kalau tombol ini tidak muncul/ditolak, berarti akun Anda memang tidak termasuk yang diberi akses.
9. Untuk monitoring khusus tahap Colour Matching, lihat **Dashboard > Dashboard Colour Matching**.

---

## 4. Panduan untuk Teknisi Maintenance

1. Buka menu **Maintenance**.
2. Tab **List Job Maintenance**: cari laporan kerusakan yang masuk (dari Operator Produksi atau dibuat sendiri).
3. Isi **Jadwal Pengerjaan** (tanggal rencana), lalu **Tanggal Mulai** (harus mengisi Jadwal Pengerjaan dulu), lalu **Tanggal Selesai** (harus mengisi Tanggal Mulai dulu) begitu pekerjaan tuntas.
4. Status job berubah otomatis: Pending → Dijadwalkan → Dikerjakan → Selesai, mengikuti tanggal yang terisi.
5. Begitu Tanggal Selesai terisi, status "Rusak/Maintenance" pada Tanki/Mesin terkait otomatis hilang — Tanki/Mesin bisa dipakai lagi tanpa langkah tambahan.
6. Klik **Print** untuk mencetak dokumen laporan Maintenance (No Dok sudah otomatis dari saat laporan dibuat, tidak berubah walau diedit).

---

## 5. Panduan untuk Operator Cetak Label Produksi

### 5.1 Label Entry SFG (cetak fisik)
1. Buka **Production Label > Label Entry SFG**.
2. Ketik nomor **Order**, tekan Enter — Material Number, Material Description, Batch, Order Qty, Plant otomatis terisi.
3. Field **Code Tanki**, **IU Plant**, **Other (Remark)** otomatis terisi dari input terakhir di modul lain — cek dan edit kalau perlu.
4. Lengkapi manual: **Lot No**, **Exp**, **Material Type**, **Drum Colour**.
5. Cek preview label di bawah form, lalu klik **🖨️ Cetak Label** — data otomatis tersimpan ke Label History, dialog print browser terbuka.
6. Pastikan printer tujuan **Honeywell PC42T**, ukuran kertas custom **100mm x 140mm**, scale **100%/Actual Size**.

> Catatan: untuk Material yang wajib melalui tahap Milling, Label Entry SFG baru bisa dipakai setelah Milling selesai (kecuali Order rework RF01/RF02).

### 5.2 Label Entry FG (tanpa cetak fisik)
1. Buka **Production Label > Label Entry FG**.
2. Cari lewat kolom **Order** ATAU kolom **Batch** — keduanya saling melengkapi (ketik salah satu, yang lain ikut terisi otomatis).
3. Lengkapi field (Qty Pack, Jumlah/Per, Shelf Life, Lot Passed, dst), lalu klik **💾 Save** (tidak ada tombol cetak di menu ini).
4. Kalau Material-nya terdaftar di **Master Data > Master Part Yamaha**, field **Item No. Yamaha / Viskositas / SG** akan otomatis tampil. Lengkapi Lot Passed dan Qty Pack (berisi angka) untuk mengaktifkan tombol **⭳ Download QR** — klik untuk mengunduh gambar QR Code format Yamaha.
5. Kalau Material-nya BUKAN Yamaha, field Item No. Yamaha akan menampilkan "Produk tidak pakai QR Code" dan tombol Download QR nonaktif — ini normal, Save tetap berjalan seperti biasa.

### 5.3 Label History
Cek riwayat cetak/simpan kapan saja di tab History pada masing-masing menu (SFG/FG terpisah).

---

## 6. Panduan untuk Admin (Full Access)

### 6.1 User Management
1. Buka **Developer Tools > User Management**.
2. Klik **+ Tambah User** untuk akun baru — isi NIK, Nama, Department, dan level akses (Full Access/Input/View).
3. Untuk akses per-menu (View/Input/Hide), atur lewat tombol Edit pada user terkait.
4. Gunakan fitur bulk provisioning kalau perlu menambah banyak user Produksi sekaligus.

### 6.2 Master Data
1. Buka **Developer Tools > Master Data**.
2. **Master Data Cooispi**: import file Excel/CSV hasil ekspor SAP-COOISPI lewat tombol Import.
3. **Material Flow Proses**: atur urutan tahap wajib per Material (import massal lewat file hanya bisa oleh Full Access; checklist per-Material di panel Info Proses bisa diedit akses Input juga).
4. **Master Data Tanki** / **Master Data Mesin**: kelola daftar kode tanki/mesin, termasuk status Damaged/Maintenance (otomatis ter-release lewat modul Maintenance).
5. **Employee Data**: kelola daftar nama & Email untuk dropdown di semua form input dan untuk notifikasi (1 email hanya boleh dipakai 1 karyawan).
6. **Master Part Yamaha**: kelola daftar Material yang memakai format QR Code Yamaha di Label Entry FG.

### 6.3 Backup & Storage
1. Buka **Developer Tools > Backup & Storage**.
2. Backup database berjalan otomatis setiap hari pada jam yang dikonfigurasi — kalau jam tersebut terlewat (server sedang down), sistem otomatis "mengejar" backup di pengecekan berikutnya hari yang sama.
3. Backup lama dihapus otomatis sesuai aturan retensi (umur dan/atau jumlah maksimum) yang dikonfigurasi.
4. Perhatikan indikator di halaman ini — akan muncul peringatan kalau backup terakhir sudah lebih dari 36 jam (staleness).
5. **Restore** dan **Hapus backup** hanya bisa dilakukan oleh 5 akun admin tertentu (bukan semua akun Full Access) — kalau tombolnya tidak ada/ditolak, ini bukan bug.
6. **Import & Export Data (Advance)**: export kategori data ke Excel, atau import file Excel untuk memperbarui data secara massal — selalu didahului snapshot backup otomatis sebagai jaring pengaman sebelum data ditulis.

### 6.4 Pengaturan SMTP & Notifikasi
1. Buka **Developer Tools > Pengaturan SMTP**.
2. Isi host/port/user/password SMTP (password tersimpan terenkripsi, tidak akan tampil lagi setelah disimpan — kosongkan field password saat edit kalau tidak ingin menggantinya).
3. Atur **threshold hari macet** (berapa hari kerja suatu Order dianggap "macet" di satu tahap) dan **jam pengiriman notifikasi** (presisi hingga menit, dihitung di zona WIB).
4. Setiap karyawan bisa opt-in sendiri menerima notifikasi "Order Macet" per tahap lewat Profile mereka masing-masing, selama Email mereka sudah terisi.

### 6.5 Dashboard Monitoring
Sebagai Admin, pantau kondisi keseluruhan lewat:
- **Production Order Monitoring** — status semua Order lintas tahap, kolom Tank Type, akses cepat ke Pindah Tanki & PWO Schedule
- **Tank Monitoring** / **Mesin Monitoring** — okupansi real-time, termasuk status Maintenance/Rusak
- **Dashboard Produktivitas** — jumlah Order/Batch selesai per tim per periode
- **Dashboard Colour Matching** / **Dashboard Quality** / **Dashboard Approval** — monitoring khusus per tahap

---

## 7. Papan Info & Chat (Semua Pengguna)

1. Buka halaman **Beranda** untuk melihat feed **Papan Info** — posting pengumuman/info, berikan komentar, lampirkan gambar (bisa lebih dari satu, tampil sbg galeri geser).
2. Gunakan `@nama` untuk mention rekan kerja, atau `#tagar` untuk topik tertentu — bisa dicari lewat kotak pencarian di atas feed.
3. Gunakan ikon chat untuk mengobrol langsung dengan rekan kerja yang sedang online — status online & waktu aktif terakhir ditampilkan per kontak.

---

*Dokumen ini direvisi 6 November 2026. Mohon direview oleh perwakilan tiap role untuk memastikan langkah-langkahnya akurat sesuai kondisi lapangan, dan dilengkapi dengan screenshot pada revisi berikutnya.*
