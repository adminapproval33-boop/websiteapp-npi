# User Guide — Website NPI (Per Role)

Panduan langkah demi langkah penggunaan Website NPI, dikelompokkan berdasarkan peran pengguna. Login terlebih dahulu menggunakan NIK dan password yang diberikan Admin sebelum mengikuti panduan di bawah.

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
- **Milling**: mendukung banyak **Pass** (Fineness/Visco/Suhu) untuk satu Order — gunakan tombol tambah Pass kalau perlu lebih dari 1 kali giling.
- **Bongkaran**: TIDAK bergantung pada tahap lain, bisa diinput kapan saja. Cek tab **PWO Schedule & Queue** untuk lihat Order yang sudah siap (Colour Matching selesai) tapi belum diinput Bongkaran.
- **Packing**: tahap akhir, tidak ada prasyarat administrasi QC.

### 1.3 Antrian (PWO Queue)
Setiap tahap (kecuali Bongkaran) punya tab antrian yang menampilkan Order yang sudah memenuhi syarat tapi belum Anda input. Klik tombol **Input [Nama Tahap]** di baris antrian untuk langsung membawa data Order tsb ke form Input.

### 1.4 Menghapus Data
Kalau akun Anda punya akses **Input** di menu tsb, tombol **Hapus (🗑️)** akan muncul di History untuk data yang salah/perlu dihapus. Kalau tidak muncul, hubungi Admin.

---

## 2. Panduan untuk Tim Quality Control

### 2.1 Creating Product Spec
1. Buka **Portal Quality Control > Creating Product Spek**.
2. Isi Material Number/Description terkait.
3. Tambahkan baris parameter (No, Item Check, Standard Spec, Unit).
4. Simpan — spec ini akan jadi acuan otomatis saat Check Results diinput untuk Material yang sama.

### 2.2 Input Check Results
1. Buka **Portal Quality Control > Input Check Results**.
2. Cari Order, lalu isi hasil pengecekan aktual untuk tiap parameter yang sudah didefinisikan di Product Spec.
3. Sistem otomatis membandingkan hasil dengan standar dan menampilkan **verdict Pass/Fail**.
4. Simpan.

### 2.3 Input Admin QC
1. Buka **Portal Quality Control > Input Admin QC**.
2. Cari Order, isi **Admin QC Stage** (mis. Approval/Joint Lot), lalu isi tanggal **Lot Passed**, **QC to Approval**, **QC Passed** sesuai progres administrasi.
3. Data ini akan otomatis mengalirkan Order ke antrian menu **Approval**.

---

## 3. Panduan untuk Tim Approval / MRP-Sales

1. Buka **Production & MRP Schedule > Approval**.
2. Cek tab **List Antrian Approval** — berisi Order yang Admin QC Stage-nya sudah "Approval"/"Joint Lot" dan menunggu diproses, diurutkan FIFO (paling lama menunggu duluan).
3. Klik **Input Approval** pada baris yang mau diproses.
4. Lengkapi field administrasi (MRP PIC, Sales PIC, Prepare Produksi, Spray Man, Lot COA, dst).
5. Upload lampiran pendukung lewat tombol **Lampiran** kalau ada dokumen terkait.
6. Simpan.

---

## 4. Panduan untuk Operator Cetak Label Produksi

1. Buka **Production Label > Production Label Entry**.
2. Ketik nomor **Order**, tekan Enter — Material Number, Material Description, Batch, Order Qty, Plant otomatis terisi.
3. Field **Code Tanki**, **IU Plant**, **Other (Remark)** otomatis terisi dari input terakhir di modul lain — cek dan edit kalau perlu.
4. Lengkapi manual: **Lot No**, **Exp** (tanggal kadaluarsa), **Material Type** (pilih Paste/Kepala Warna/Assorted), **Drum Colour**.
5. Cek preview label di bawah form.
6. Klik **🖨️ Cetak Label** — data otomatis tersimpan ke Label History, lalu dialog print browser terbuka.
7. Pastikan printer tujuan **Honeywell PC42T**, ukuran kertas custom **100mm x 140mm**, scale **100%/Actual Size** (bukan Fit to Page).
8. Cek riwayat cetak di menu **Label History** kapan saja.

---

## 5. Panduan untuk Admin (Full Access)

### 5.1 User Management
1. Buka **Developer Tools > User Management**.
2. Klik **+ Tambah User** untuk akun baru — isi NIK, Nama, Department, dan level akses (Full Access/Input/View).
3. Untuk akses per-menu (View/Input/Hide), atur lewat tombol Edit pada user terkait.
4. Gunakan fitur bulk provisioning kalau perlu menambah banyak user Produksi sekaligus.

### 5.2 Master Data
1. Buka **Developer Tools > Master Data**.
2. **Referensi Order/PO**: import file Excel/CSV hasil ekspor SAP-COOISPI lewat tombol Import.
3. **Material Flow Proses**: atur urutan tahap wajib per Material.
4. **Master Tanki** / **Master Mesin**: kelola daftar kode tanki/mesin yang tersedia (dipakai dropdown di semua modul).
5. **Data Karyawan**: kelola daftar nama untuk dropdown SPV/Leader/Member di semua form input.

### 5.3 Dashboard Monitoring
Sebagai Admin, pantau kondisi keseluruhan lewat:
- **Production Order Monitoring** — status semua Order lintas tahap
- **Tank Monitoring** / **Mesin Monitoring** — okupansi real-time
- **Dashboard Produktivitas** — jumlah Order/Batch selesai per tim per periode

---

*Dokumen ini adalah draft awal. Mohon direview oleh perwakilan tiap role untuk memastikan langkah-langkahnya akurat sesuai kondisi lapangan, dan dilengkapi dengan screenshot pada revisi berikutnya.*
