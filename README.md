# DOKUMEN TEKNIS & SPESIFIKASI PROYEK
## SISTEM ABSENSI PEGAWAI PT. CAREFASTINDO INDONESIA
### (ANDROID APP & WEBSITE ADMIN PANEL)

Dokumen ini disusun sebagai dokumentasi teknis resmi untuk pengembangan sistem **Absensi Pegawai PT. Carefastindo Indonesia V1.0.0 (Build Release)** yang mencakup aplikasi mobile Android (khusus Pegawai) dan Website Admin Panel (khusus Super Admin).

Aplikasi ini dirancang dan dikembangkan sebagai bagian dari Tugas Akhir (Skripsi) untuk memenuhi syarat kelulusan jenjang Strata-1 (S1) Teknik Informatika di **Universitas Potensi Utama**.

---

## 📂 1. Struktur Folder Proyek
Untuk memastikan keamanan dan mencegah kerusakan kode lama, proyek ini dipisahkan menjadi dua folder mandiri:
```
absensi_carefastindo/
├── android/          ← Seluruh kode asli aplikasi Android (Mobile App Pegawai)
├── website/          ← Seluruh kode website admin panel Next.js (Admin Workspace)
└── README.md         ← Dokumen panduan utama ini
```

---

## 🛠️ 2. Spesifikasi Teknologi

### A. Aplikasi Android (`/android`)
Aplikasi mobile native yang digunakan oleh pegawai untuk melakukan presensi secara langsung di lapangan.
*   **Bahasa Pemrograman:** Kotlin Native (100% Android SDK Modern).
*   **Target Android SDK:** Android SDK 33 (Target Android 13/14).
*   **Sistem Bangun:** Gradle Kotlin DSL dengan Kotlin Compiler `2.0.0`.
*   **Layout Engine:** XML Layouts dengan arsitektur **ViewBinding**.
*   **Library Utama:** Supabase Kotlin SDK, Google Play Services Location API (Geofencing), Google ML Kit Barcode Scanning (QR Scanner), dan iText 7.

### B. Website Admin Panel (`/website`)
Dashboard web yang digunakan oleh Super Admin untuk memantau kehadiran, mengelola jadwal shift, pengumuman, permohonan cuti, laporan vendor, serta generate QR Code.
*   **Framework Utama:** Next.js 14 (App Router) + TypeScript + Tailwind CSS.
*   **Design System:** shadcn/ui (slate/white dengan aksen biru soft).
*   **Data Fetching:** **TanStack Query (React Query) v5** dengan caching, auto-refresh, dan skeleton loading.
*   **Realtime Sync:** **Supabase Realtime (Postgres Changes)** untuk memantau data absensi secara instan tanpa reload halaman.
*   **Animasi:** **Framer Motion** untuk transisi perpindahan halaman, efek rendering modal detail, dan micro-interactions pada tombol.
*   **Visualisasi:** **Chart.js** & `react-chartjs-2` untuk grafik mingguan & donut chart harian.
*   **Dokumen & Ekspor:** **pdfmake** (untuk generate file PDF) & **xlsx** (untuk generate file Excel).

---

## 🏗️ 3. Arsitektur Perangkat Lunak & Alur Kerja

### A. Aplikasi Android (MVVM Pattern)
```mermaid
graph LR
    View[Views / Activities / XML] <-->|ViewBinding / StateFlow| ViewModel[ViewModels]
    ViewModel <-->|Coroutines Dispatchers.IO| Supabase[Supabase API / Database]
```

### B. Website Admin Panel (React Query + Realtime Pattern)
```mermaid
graph TD
    Client[Next.js Client Components] <-->|React Query Hooks| Cache[(React Query Cache)]
    Cache <-->|Supabase Client Fetch| DB[(Supabase Database)]
    DB -.->|Realtime Event Broadcast| Realtime[Supabase Realtime Client]
    Realtime -.->|Invalidate Queries| Cache
```

---

## 📂 4. Skema Database Supabase (PostgreSQL Schema)
Berikut adalah daftar tabel database relasional yang digunakan oleh sistem absensi (Pegawai & Admin):

1.  **`users`**: Identitas lengkap pengguna (ID, nama, email, password, role seperti `superadmin`, `spv`, `leader`, `cleaner`, `housekeeping`, `gardener`, `gondola`).
2.  **`attendance`**: Log harian presensi masuk, istirahat, pulang, koordinat lokasi absensi (GPS), foto selfie, status kehadiran (`hadir`, `izin`, `sakit`, `alfa`), dan catatan.
3.  **`leave_requests`**: Berkas pengajuan cuti, sakit, atau izin pegawai beserta alasan dan bukti lampiran file pendukung.
4.  **`shifts`**: Master data shift kerja (ID, nama shift, jam masuk, jam pulang).
5.  **`user_shifts`**: Relasi penugasan shift harian/mingguan pegawai beserta tanggal efektif berlaku.
6.  **`qr_code_logs`**: Log historis data QR Code presensi yang dihasilkan sistem beserta waktu generate dan masa kedaluwarsa (berlaku 30 menit).
7.  **`announcements`**: Pengumuman broadcast yang dikirim oleh superadmin yang bisa ditargetkan per-role atau ke seluruh pegawai.
8.  **`contracts`**: Informasi kontrak kerja pegawai (nomor kontrak, tanggal mulai, tanggal berakhir, dan status keaktifan).
9.  **`payrolls`**: Rekap slip gaji bulanan pegawai beserta total perhitungan gaji pokok, potongan keterlambatan, dan tunjangan.

---

## 🌟 5. Fitur Utama Sistem

### A. Aplikasi Android (Employee Workspace)
*   **Autentikasi Aman:** Login dan integrasi lupa kata sandi langsung ke email pegawai.
*   **Dashboard Kehadiran:** Menampilkan status kehadiran hari ini, jam digital, kuota keterlambatan, dan tombol riak (*ripple effect*).
*   **Presensi Double Verification:** Verifikasi pemindaian QR Code kantor dan Geofencing koordinat GPS pegawai.
*   **Bukti Lampiran Izin:** Form pengajuan izin/sakit langsung mengunggah file bukti fisik ke *Supabase Storage Public Bucket*.

### B. Website Admin Panel (Admin Management Hub)
*   **Dashboard Desktop-Like:** Grafik trend mingguan, donut chart persentase harian, realtime counter statistik (Hadir, Izin, Sakit, Alfa), dan tabel 5 data log absensi terakhir.
*   **Attendance Board:** Filter multi-kolom (tanggal, shift, status, nama), modal detail absensi (lokasi GPS & foto selfie), serta download laporan PDF & Excel.
*   **Shift & User Setup:** Pengaturan shift aktif pegawai, log riwayat pergantian shift, dan pendaftaran shift baru secara efektif.
*   **QR Generator:** Generate QR Code dinamis dengan durasi kedaluwarsa 30 menit + countdown timer.
*   **Announcements Broadcast:** Pengiriman pengumuman tertarget per-role atau all-employee dengan status persentase pembacaan.
*   **Reports Export:** 4 modul pelaporan independen (Harian, Bulanan, Vendor, Kontrak) dengan ekspor instan Excel & PDF.
*   **Leave Requests Panel:** Verifikasi permohonan cuti, sakit, dan izin pegawai dengan tombol persetujuan cepat serta bulk-actions (Approve/Reject All) yang dilengkapi konfirmasi dialog keamanan.

---

## 🚀 6. Cara Menjalankan Project

### A. Menjalankan Aplikasi Android (`/android`)
1.  Buka folder `android/` menggunakan **Android Studio**.
2.  Lakukan sinkronisasi Gradle (Gradle Sync) dan pastikan semua dependencies terunduh dengan benar.
3.  Hubungkan perangkat Android fisik atau Emulator.
4.  Klik tombol **Run 'app'**.

### B. Menjalankan Website Admin Panel (`/website`)
1.  Buka terminal Anda dan masuk ke folder website:
    ```bash
    cd website
    ```
2.  Pastikan berkas `.env.local` telah terkonfigurasi dengan Supabase URL dan Anon Key Anda.
3.  Jalankan server pengembangan lokal:
    ```bash
    npm run dev
    ```
4.  Buka browser Anda dan akses halaman `http://localhost:3000`.

---
*Dokumen ini diperbarui secara resmi pasca implementasi modul Next.js Admin Panel.*
*© 2026 M. Juffri Siregar. All Rights Reserved.*
