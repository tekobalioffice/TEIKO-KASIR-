# Rencana: Mode Kasir di atas POS Teiko

Konteks: POS Teiko asli (`C:\FREELANCE\TEIKO\WEB\pos_teiko`) itu blind POS —
omzet dihitung dari selisih stok per shift, bukan dari transaksi. Permintaan
baru: tampilan kasir ala POS resto (grid produk + keranjang), cetak struk per
pesanan, harga khusus Gojek/Grab. Ini DITAMBAHKAN sebagai modul baru, bukan
mengganti alur opname yang sudah ada dan sudah diaudit.

Kerja jalan di clone ini: `C:\FREELANCE\SISTEM BARU TEIKO KEDEPAN\pos_teiko`.
Repo lokal, tanpa remote GitHub, tanpa link Vercel. DB pakai project Supabase
baru (`uuvbdvcwphptbzrqvsja`), bukan punya produksi.

## Status sekarang (per 2026-10-22)

- [x] Clone lengkap (`src/`, `public/`, `supabase/`, `scripts/`), git lokal baru.
- [x] `src/supabase.js` & `e2e/lib/supa.js` baca URL/key dari `.env.local`, bukan hardcode.
- [x] `.env.local` diisi URL + anon key project Supabase baru.
- [x] `supabase/schema.sql` — 11 tabel (outlets, users, products, operational_items,
      branch_inventory, sales_reports, stock_restock_log, pending_stock_actions,
      stock_distributions, profiles, warehouse_inventory), sudah dicocokkan ke
      kolom asli lewat screenshot Table Editor. RLS: authenticated full access.
- [x] `schema.sql` + `trigger_current_qty.sql` + `migrations_kasir.sql` sudah
      dijalankan di project Supabase baru — 14 tabel ada, trigger terbukti jalan.
- [x] Seed data (`scripts/seed-dev.mjs`): 1 admin (`teko.balioffice1@gmail.com`,
      role admin, cocokkan ke akun Auth yang sama), outlet "Pusat", 4 produk
      contoh, `branch_inventory` awal 20 per item.
- [x] `npm run dev` jalan, Supabase terhubung (tested lewat script, bukan lewat
      browser — belum ada yang klik login manual).
- [x] Login + buka halaman Kasir dari browser beneran — dikonfirmasi user,
      tidak ada error, halaman kebuka normal.
- [ ] Checkout 1 produk dari UI belum dikonfirmasi eksplisit (asumsi oke
      karena "semua aman" — cek lagi kalau nemu masalah pas coba bayar).
- [x] Highlight kartu terpilih + badge jumlah qty di grid kasir
      (`BranchKasir.jsx`).
- [x] Form harga Gojek/Grab di AdminProducts, wired ke
      `product_channel_prices` (kosong = pakai harga normal). Prefill saat
      edit produk.
- [ ] Foto produk masih placeholder ikon — belum ada yang diupload lewat
      AdminProducts (fiturnya sudah ada, tinggal diisi manual per produk).
- [ ] Belum dites: edit produk → isi harga Gojek/Grab → buka Kasir → pindah
      channel → harga di grid & keranjang ikut berubah.
- [x] Produk tanpa kategori tidak hilang lagi — fallback tab "Lainnya".
- [x] Banner "Omzet Kasir hari ini" disambungkan ke Input Penjualan — info
      pembanding, bukan sumber angka resmi (lihat "Keputusan yang sudah
      diputuskan" soal rumus revenue stok x harga normal yang tidak berubah).
- [x] **Kasir dikunci sampai shift dibuka di Input Penjualan.** Pakai sinyal
      yang sama (`localStorage.pos_active_session`) yang BranchPOS pakai
      sendiri. Belum ada shift aktif untuk cabang itu → Kasir nampilin layar
      "Belum Ada Shift Aktif" + tombol ke Input Penjualan, bukan grid produk.
- [x] Tombol "Kasir" ditaruh di halaman Input Laporan Shift sendiri (sebelah
      tombol Stok), bukan cuma di sidebar — lebih kelihatan, sesuai yang
      user minta. Muncul begitu shift sudah dibuka.
- [x] **Halaman Pengaturan baru** (`/admin/pengaturan`, sidebar menu
      "Pengaturan"): ukuran kertas struk (58mm default / 80mm), teks header
      & footer struk. Tabelnya `app_settings` (singleton row) — lihat
      `supabase/migrations_settings.sql`, **BELUM dijalankan di Supabase**,
      perlu Anda run dulu baru halaman ini kepakai (sebelum itu fallback ke
      default 58mm/TEIKO/Terima kasih, tidak error).
- [x] Kasir TIDAK dibatasi ke outlet "Pusat" saja — itu cuma outlet seed
      buat testing. Kasir ikut `selectedBranch` sesi yang lagi aktif, sama
      seperti Opname, jadi semua outlet bisa pakai begitu ada produk &
      shift aktif di cabang itu.

## Jadwal 3 hari

- **Hari 1 — DB jalan.** Anda jalankan `supabase/schema.sql` +
  `supabase/trigger_current_qty.sql` di SQL Editor project Supabase baru
  (saya tidak punya akses tulis DDL ke sana, ini satu-satunya langkah yang
  butuh Anda). Saya seed 1 outlet, 1 admin, beberapa produk, lalu
  `supabase/migrations_kasir.sql` (orders, order_items, product_channel_prices).
  Checkpoint: `npm run dev`, bisa login, halaman kebuka.
- **Hari 2 — Kasir jalan.** Halaman `BranchKasir.jsx`: grid produk + kategori +
  keranjang, pilih channel Offline/Gojek/Grab (harga otomatis ganti), tombol
  bayar → simpan order + potong stok. Checkpoint: transaksi end-to-end lewat
  UI, data masuk ke `orders`/`order_items`.
- **Hari 3 — Struk + harga channel + rapi.** Cetak struk per pesanan
  (`window.print`, CSS 58/80mm), input harga Gojek/Grab + upload foto di
  AdminProducts, push ke GitHub. Checkpoint: satu transaksi penuh dari grid
  sampai struk tercetak.

Hari 1 butuh satu aksi dari Anda (jalankan SQL). Hari 2–3 saya kerjakan
sendiri di sesi berikutnya, tinggal lanjut dari checklist di bawah.

## Langkah berikut, urut

1. **Jalankan `supabase/schema.sql`** di SQL Editor project Supabase baru,
   lalu jalankan `supabase/trigger_current_qty.sql`.
2. **Seed data minimal**: 1 outlet, 1 user admin, beberapa produk — supaya
   bisa login & lihat halaman jalan. Butuh buat user lewat Supabase Auth
   (email+password) lalu insert baris matching di `public.users`/`profiles`.
3. **`npm install` + `npm run dev`**, pastikan app kebuka & bisa login dengan
   data seed. Ini checkpoint: kalau gagal di sini, jangan lanjut ke modul baru
   dulu — DB/auth harus jalan dulu.
4. **Migrasi DB untuk fitur baru** (tabel baru, bukan ubah yang lama):
   - `orders` (branch, shift, channel: offline/gojek/grab, total, created_at)
   - `order_items` (order_id, product_id, qty, price saat itu)
   - `product_channel_prices` (product_id, channel, price) — harga khusus
     Gojek/Grab, fallback ke `products.price` kalau tidak ada baris.
   - kolom `image_url` di `products` sudah ada (dari skema lama) — tinggal isi.
5. **Halaman kasir baru** `src/pages/BranchKasir.jsx` + route di `App.jsx`:
   - Sidebar kategori kiri, grid produk tengah (pakai `image_url`), keranjang kanan.
   - Pilihan channel (Offline/Gojek/Grab) di atas keranjang — switch harga otomatis
     dari `product_channel_prices`.
   - Tombol bayar → insert `orders` + `order_items`, kurangi `branch_inventory`.
6. **Cetak struk**: komponen print-only + `window.print()` + CSS `@media print`
   lebar 58/80mm. Tidak pakai library baru.
7. **AdminProducts**: tambah input harga per channel (Gojek/Grab) dan upload foto
   (storage bucket `products` sudah ada, dipakai di kode lama).
8. **Laporan rekonsiliasi**: bandingkan total `orders` (sistem) vs omzet opname
   shift yang sudah ada — selisih jadi sinyal audit, bukan dibuang.
9. E2E test baru untuk alur kasir (ikut pola `e2e/pos-*.spec.js` yang sudah ada).

## Keputusan yang sudah diputuskan

- **(Diubah 2026-10-26) Kasir TIDAK motong stok.** Versi lama motong
  `display_qty` langsung, akibatnya Awal di form opname ikut turun dan
  Terjual (Awal − Sisa) jadi 0 — jualan Kasir hilang dari laporan shift.
  Sekarang tiap order dicatat dengan `orders.report_date` + `orders.shift`
  (sesi Input Penjualan aktif). BranchPOS baca `order_items` itu: Sisa kosong
  → Terjual = jumlah dari Kasir, placeholder Sisa = Awal + Tambah − Kasir,
  badge "(−N Kasir)" di tiap item. Sisa diisi manual tetap menang. Tutup Shift
  motong stok sekali (live − terjual) seperti biasa. Kartu Stok baru update
  saat Tutup Shift (sama seperti sebelum ada Kasir).
- Item auto-hitung (Es Teh, Teh Tarik, Milk Tea, Full Cream — dari
  cup/bahan): rumus cup/bahan tetap menang. Selama bahannya belum diopname
  (hasil 0), Terjual pakai angka Kasir.
- **Cup Ori / Cup Premi membatasi Kasir.** Tiap menu bercup (aturan
  `cupVariantOf` di `stockUtils.js`, sama dengan hitungan cup di
  calculateTotals) butuh 1 cup varian-nya. Stok cup = bahan bernama "cup" +
  "premi" / "ori"/"paper" (display + tambah) − cup terpakai lewat Kasir shift
  ini − keranjang. Bahan cup belum ada di branch_inventory = tidak dibatasi.
- **Kasir tidak boleh jual melebihi stok display.** Batas = `display_qty +
  tambah_qty` (kunci `getStockKey`, sama dengan form opname) − jualan Kasir
  shift ini − isi keranjang. Dicek saat tambah ke keranjang dan dicek ulang
  dari DB saat Bayar. Belum ada baris `branch_inventory` = stok 0 = tidak
  bisa dijual (sama dengan Awal 0 di form). Hanya auto-hitung dan
  `is_unlimited` yang tidak dibatasi stok item-nya (tetap kena batas cup).
  Kategori `Bahan` tidak tampil di Kasir.
- Konsumsi bahan per resep (gelas, sedotan, gula per cup, dll) **belum**
  otomatis dari kasir — itu tetap diisi manual staf saat opname, sama seperti
  sekarang. Baru layak diotomasi kalau ada data resep per produk (belum ada).

## Keputusan yang masih nunggu user

- Printer struk: thermal USB / Bluetooth / printer biasa?
- Input pesanan Gojek/Grab: manual oleh staf, atau integrasi otomatis nanti?
  (asumsi saat ini: manual)

## Batasan penting

- Saya (Claude Code) cuma jalan selama sesi terminal ini aktif. Tutup laptop =
  proses berhenti, tidak lanjut sendiri di background. File ini supaya sesi
  berikutnya (saya lagi, atau siapa pun) tahu persis titik berhenti & langkah
  selanjutnya tanpa mengulang dari nol.
- Kalau mau progres otomatis tanpa laptop menyala, itu perlu scheduled/cloud
  agent (fitur terpisah, perlu diatur & biasanya ada biaya/izin tersendiri) —
  belum diaktifkan di sini.
