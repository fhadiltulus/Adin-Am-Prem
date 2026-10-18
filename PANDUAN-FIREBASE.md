# Panduan Firebase + Admin Panel — Adinn AM Premium

## Status saat ini
- Login / Register: **Firebase Authentication (Email/Password)** — data tersimpan di cloud
- Data plan: **Cloud Firestore**, sinkron realtime
- Order paket: user tekan tombol → **langsung diarahkan ke WhatsApp kamu** dengan draft pesan otomatis
- Setelah kamu terima pembayaran manual (transfer/e-wallet dari chat WA), kamu **konfirmasi lewat Admin Panel** di website → paket langsung aktif untuk akun itu
- **Tidak ada credit gratis lagi.** Akun baru TIDAK bisa aktivasi AM Prem sama sekali sampai admin mengaktifkan paketnya. Tidak ada pengecualian.
- Sistem plan: **unlimited aktivasi** selama masa aktif
  - Silver = unlimited aktivasi selama 7 hari
  - Gold = unlimited aktivasi selama 30 hari
  - Platinum = unlimited aktivasi selama 1 tahun — **rahasia**, tidak ditampilkan di halaman Paket publik, cuma bisa diaktifkan admin langsung dari Admin Panel (dipakai buat kasih akses VIP tanpa lewat WA order)
  - Begitu paket habis masa aktifnya, otomatis balik ke status "tidak ada paket aktif" dan tidak bisa aktivasi lagi
- **Kode Voucher**: admin bisa bikin kode diskon (persen) dari Admin Panel, sekarang bisa dikasih **batas maks pemakaian** (misal cuma 1x, atau 50x), sistem otomatis nolak kalau sudah mencapai batas. User masukkan kode itu di halaman Paket sebelum order → harga yang tampil & dikirim ke WA otomatis berkurang sesuai diskon
- **Harga Paket**: admin bisa ubah harga Silver/Gold/Platinum langsung dari Admin Panel (tersimpan di Firestore `settings/prices`), berlaku realtime ke semua user tanpa perlu update kode
- **Pengumuman**: admin bisa kirim info ke semua user (misal "Adin akan update Desember nanti") dari Admin Panel, langsung tampil realtime di halaman Beranda semua user yang sedang login
- **Intro Admin**: begitu login admin berhasil, muncul video selamat datang full-screen sekali per sesi browser (bisa di-skip)
- **Animasi Sukses**: begitu user berhasil aktivasi akun AM Prem, muncul animasi confetti + badge sukses
- Navigasi app sekarang pakai **bottom navigation**: Beranda, Aktivitas, Profil. Halaman Paket diakses lewat tombol di Beranda/Profil (bukan tab utama)
- Admin Panel: tersembunyi, hanya bisa dibuka lewat trigger rahasia + login akun admin khusus

`firebase-config.js` berisi config project `adin-am-prem2207`, sudah terpasang.

⚠️ **PENTING kalau kamu upgrade dari versi sebelumnya**: Security Rules di bagian B **wajib di-update ulang** (ada penambahan buat collection `settings` dan aturan baru di `vouchers` supaya batas pemakaian voucher bisa jalan). Kalau rules lama belum diganti, fitur atur harga & limit voucher bakal gagal dengan error "permission-denied".

---

## A. Setup Firebase (kalau belum / project baru)

1. https://console.firebase.google.com → buat/masuk project
2. **Build → Authentication → Sign-in method → Email/Password → Enable**
3. **Build → Authentication → Settings → Authorized domains** → tambahkan domain hosting kamu (mis. `adin-amprem.pages.dev`)
4. **Build → Firestore Database → Create database → Production mode** → lokasi asia-southeast2 → Enable
5. Tab **Rules** → paste rules di bagian B → **Publish**
6. Project Settings → Your apps → copy `firebaseConfig` → pasang di `firebase-config.js`

---

## B. Security Rules (wajib di-Publish)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isAdmin() {
      return request.auth != null
        && exists(/databases/$(database)/documents/admins/$(request.auth.uid));
    }

    // Peta username -> uid/email, dipakai saat login pakai username
    match /usernames/{username} {
      allow read: if true;
      allow create: if request.auth != null
                    && request.resource.data.uid == request.auth.uid;
      allow update, delete: if false;
    }

    match /users/{userId} {
      // User baca datanya sendiri, admin baca semua (buat panel admin)
      allow read: if request.auth != null
                  && (request.auth.uid == userId || isAdmin());

      // Akun baru dibuat tanpa credit/plan (harus diaktifkan admin dulu)
      allow create: if request.auth != null
                    && request.auth.uid == userId
                    && request.resource.data.credits == 0
                    && request.resource.data.plan == "free"
                    && request.resource.data.planExpire == null;

      // HANYA admin yang boleh mengubah plan/credits. User tidak punya izin
      // menulis apapun ke dokumennya sendiri setelah dibuat — murni read-only.
      // Ini sengaja ketat: mencegah user mengaktifkan paket sendiri lewat
      // DevTools/Firestore API tanpa lewat admin.
      allow update: if isAdmin();

      allow delete: if false;
    }

    // Daftar UID admin. Hanya bisa ditambah manual lewat Firebase Console
    // (tidak ada yang bisa nulis dari aplikasi/browser).
    match /admins/{adminId} {
      allow read: if request.auth != null && request.auth.uid == adminId;
      allow write: if false;
    }

    // Kode voucher diskon. User (login) boleh baca buat validasi kode.
    // Admin bebas bikin/ubah/hapus. User BIASA cuma boleh nambah field
    // usedCount sendiri (+1 per klik order), tidak bisa ubah field lain
    // (discount, active, maxUses, dst) dan tidak bisa lewatin batas maxUses.
    // Ini yang bikin fitur "voucher cuma bisa dipakai N kali" jalan aman
    // tanpa perlu Cloud Function.
    match /vouchers/{code} {
      allow read: if request.auth != null;
      allow create, delete: if isAdmin();
      allow update: if isAdmin() || (
        request.auth != null &&
        request.resource.data.diff(resource.data).affectedKeys().hasOnly(['usedCount']) &&
        request.resource.data.usedCount == resource.data.usedCount + 1 &&
        (resource.data.maxUses == null || resource.data.usedCount < resource.data.maxUses)
      );
    }

    // Pengumuman buat semua user. User (login) boleh baca (buat ditampilkan
    // di Beranda), cuma admin yang boleh bikin/ubah/hapus.
    match /announcements/{id} {
      allow read: if request.auth != null;
      allow write: if isAdmin();
    }

    // Harga paket Silver/Gold/Platinum yang bisa diubah admin dari Admin Panel.
    // Semua user login boleh baca (buat nampilin harga di halaman Paket),
    // cuma admin yang boleh mengubahnya.
    match /settings/{docId} {
      allow read: if request.auth != null;
      allow write: if isAdmin();
    }
  }
}
```

**Kenapa ini lebih aman dari versi sebelumnya:** sekarang user **tidak punya izin menulis apapun** ke dokumennya sendiri setelah akun dibuat — bukan cuma "disembunyikan di UI", tapi benar-benar ditolak oleh Firestore di level server. Jadi walau ada yang paham DevTools/Firestore API dan mencoba mengubah `plan` atau `planExpire` miliknya sendiri secara langsung, permintaannya akan ditolak (`permission-denied`). Satu-satunya jalan mengaktifkan paket adalah lewat Admin Panel oleh akun yang terdaftar di collection `admins`. Ini menutup celah yang ada di rules versi sebelumnya.

---

## C. Cara membuat akun Admin pertama

Admin di sini = **akun biasa** yang didaftarkan lewat form Daftar di website, lalu ditandai sebagai admin manual lewat Firebase Console. Tidak ada pendaftaran admin dari aplikasi (sengaja, biar aman).

1. Daftar akun baru seperti biasa di website (pakai email/username khusus kamu sendiri, bukan email pembeli)
2. Buka **Firebase Console → Authentication → Users** → cari akun tadi → copy **User UID**-nya
3. Buka **Firestore Database → Data** → klik **Start collection** → Collection ID: `admins`
4. Document ID: **paste UID tadi** (persis, jangan diketik manual) → tambah 1 field apa saja, misalnya field `role` (string) isi `owner` → Save

Selesai. Akun itu sekarang jadi admin.

---

## D. Cara masuk ke Admin Panel (tersembunyi)

1. Buka website, di layar Login/Daftar, **tap teks "© 2026 Adinn AM Premium" di bagian bawah sebanyak 5 kali** (dalam 3 detik) → muncul form **Login Admin**
2. Masukkan email + password akun admin (yang sudah didaftarkan di langkah C)
3. Kalau akun itu memang terdaftar di collection `admins`, langsung masuk ke Admin Panel
4. Di card **Cari Akun**: cari akun pembeli (username/email) → tekan **7 Hari Silver** / **30 Hari Gold** / **1 Tahun Platinum** untuk aktifkan, atau **Reset Free** untuk mengembalikan ke status tidak ada paket
5. Di card **Kelola Voucher**: buat kode diskon baru (kode + persen diskon + durasi berlaku opsional) → user bisa pakai kode itu di halaman Paket sebelum order
6. Di card **Pengumuman**: tulis pesan → tekan Kirim Pengumuman → langsung tampil realtime di Beranda semua user yang sedang login. Tekan **Sembunyikan** kapan saja untuk menariknya kembali, atau **Hapus** untuk menghapus permanen

Trigger ini sengaja tidak terlihat sebagai tombol biasa — jangan diberitahu ke orang lain selain kamu.

**Soal paket Platinum:** paket ini sengaja tidak ditampilkan di halaman Paket publik (tidak ada tombol order-nya). Cuma bisa diaktifkan langsung dari Admin Panel, cocok buat kasih akses 1 tahun ke pelanggan VIP tanpa perlu dipublikasikan ke semua orang.

---

## E. Alur order paket (untuk pembeli)

1. User pilih Silver/Gold di menu Paket → boleh masukkan kode voucher dulu kalau ada (harga otomatis update)
2. Tombol "Order Silver/Gold" membuka WhatsApp ke nomor kamu dengan pesan siap kirim (berisi username, email, dan harga akhir setelah voucher kalau dipakai)
3. User transfer/bayar ke kamu secara manual di luar sistem
4. Setelah kamu terima pembayaran, buka Admin Panel → cari akun user itu → aktifkan paketnya
5. User langsung bisa pakai unlimited aktivasi sampai masa paketnya habis (dicek otomatis tiap kali mereka buka app)

**Penting:** akun baru TIDAK dapat credit/akses apapun secara otomatis. Selama tidak ada paket aktif yang di-set admin, tombol Kirim & Aktivasi di halaman Aktivasi akan selalu ditolak — tidak ada jalan pintas.

---

## F. Navigasi baru (bottom nav)

- **Beranda** — pengumuman terbaru (kalau ada), status paket, dan 2 tombol cepat: "Aktivasi AM Prem" & "Order Paket"
- **Aktivitas** — form aktivasi AM Prem yang lama (kirim Magic Link + verifikasi)
- **Profil** — avatar, username, email, status paket, tombol "Order Paket", tombol Hubungi Owner, dan tombol Keluar Akun
- **Paket** bukan tab utama lagi — halaman ini muncul sebagai "subpage" yang dibuka dari tombol di Beranda atau Profil, dengan tombol panah kembali di kiri atas

---

## G. Checklist publish

- [ ] index.html, style.css, script.js, firebase-config.js, logo.png, admin-intro.mp4 di folder yang sama
- [ ] Email/Password Authentication aktif
- [ ] Firestore dibuat + Rules di bagian B sudah di-Publish (versi terbaru, dengan `vouchers` + batas pemakaian, `announcements`, `settings`, dan update khusus admin)
- [ ] Domain hosting sudah masuk Authorized domains
- [ ] Sudah bikin 1 akun admin (bagian C) dan berhasil masuk Admin Panel (bagian D)
- [ ] Coba daftar akun baru → pastikan TIDAK bisa aktivasi AM Prem sebelum ada paket aktif
- [ ] Coba tekan "Order Silver" → WhatsApp terbuka dengan draft pesan
- [ ] Dari Admin Panel, ubah harga Silver/Gold/Platinum → cek halaman Paket user langsung berubah tanpa reload
- [ ] Dari Admin Panel, buat 1 voucher test dengan Maks Pemakaian = 1 → coba pakai & order sekali, lalu coba order lagi dengan kode sama → harus ditolak "batas maksimal pemakaian"
- [ ] Dari Admin Panel, aktifkan Silver ke akun test → cek status di app user berubah jadi "Unlimited" & bisa aktivasi
- [ ] Coba aktivasi AM Prem di akun test itu → pastikan animasi confetti + badge sukses muncul
- [ ] Dari Admin Panel, tekan "Reset Free" ke akun test itu lagi → cek langsung kembali terkunci
- [ ] Dari Admin Panel, kirim 1 pengumuman test → cek langsung muncul di Beranda (coba di HP lain / akun lain biar yakin realtime)
- [ ] Logout lalu login lagi sebagai admin → cek video intro selamat datang muncul, tombol Lewati & mute berfungsi
- [ ] Cek 3 tombol bottom nav (Beranda/Aktivitas/Profil) semua bisa dipindah-pindah, dan tombol "Order Paket" di Beranda/Profil bisa buka halaman Paket + tombol kembali berfungsi
