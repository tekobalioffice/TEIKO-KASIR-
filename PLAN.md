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
- [ ] **Belum dijalankan ke project Supabase baru.** Schema.sql baru ditulis,
      belum di-run di SQL Editor. Tanpa ini, app tidak bisa login/kerja sama sekali.

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

## Keputusan yang masih nunggu user

- Kasir menggantikan opname, atau berjalan paralel sebagai pembanding?
  (asumsi saat ini: paralel, opname tetap jalan)
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
