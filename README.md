# POS Teiko

Sistem Point of Sale + manajemen stok multi-outlet untuk Teiko. Kasir input
penjualan & tutup shift, gudang kirim stok ke outlet, admin/owner pantau laporan
dan kartu stok. Produksi: **[pos.teiko.co.id](https://pos.teiko.co.id)**.

## Stack

- **React 19 + Vite 7** (JSX, tanpa TypeScript)
- **Supabase** — Postgres + Auth + RLS (URL & anon key di `src/supabase.js`)
- **React Router 7**, `@dnd-kit` (drag-drop urutan produk), `xlsx-js-style` (export Excel)
- **Playwright** — e2e test (`e2e/`)
- Deploy **Vercel** (lihat [Deploy](#deploy))

## Jalan lokal

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # output ke dist/
npm run preview    # serve hasil build
npm run lint
```

Tidak butuh file `.env` untuk menjalankan app — kredensial Supabase sudah ada di
`src/supabase.js`. `.env.local` hanya menyimpan `VERCEL_TOKEN` untuk deploy CLI.

## Peran (role)

| Role | Akses |
|---|---|
| **admin / owner** | Semua halaman `/admin/*` — laporan, kartu stok, koreksi, cabang, staff, inventory pusat |
| **gudang** | `/gudang/*` — kelola stok pusat, kirim ke outlet, cek pengiriman |
| **branch (kasir)** | `/branch/pos` — buka/tutup shift, input penjualan, drawer stok outlet |

## Konsep inti

- **Shift** — kasir buka Shift 1 / Shift 2, input Sisa fisik tiap item, lalu Tutup
  Shift → tulis `sales_reports` + potong stok + export Excel (laporan penjualan +
  kartu stok). Bisa **Buka Ulang Shift** untuk membatalkan & restore dari snapshot.
- **`branch_inventory`** per outlet punya 3 kolom eksplisit:
  `display_qty` (etalase), `safety_qty` (laci/gudang outlet), `tambah_qty`
  (kiriman masuk belum dipindah). `current_qty` = display + safety.
- **Drawer stok** — Pindah ke Display, Set Manual, Oper ke outlet lain, Kurasi/Buang.
  Semua aksi tercatat di `stock_restock_log` (jadi Kartu Stok & Riwayat Aktivitas Stok).
- **Auto-calc** — beberapa menu (Milk Tea, Teh Tarik, Es Teh, Full Cream) tidak
  diinput langsung; qty terjualnya diturunkan dari pemakaian bahan penggerak di FSO.
- **Koreksi Laporan** — edit Awal/Tambah/Pindah/Sisa/Jual per baris laporan;
  balance dijaga, dan kalau laporan terakhir, `branch_inventory` ikut disesuaikan.

## Struktur

```
src/
  pages/        halaman Admin*, BranchPOS, Login, dll
  layouts/      shell per-role (admin / branch / gudang)
  components/   BranchStockDrawer, modal, dll
  utils/        stockUtils (getStockKey/parseQty/...), exportExcel
  supabase.js   client Supabase
e2e/            Playwright — flow POS vs DB produksi (outlet test terisolasi)
*.sql           setup schema/RLS Supabase (jalankan manual di SQL editor)
```

## Deploy

Git push ke `main` **tidak** auto-deploy (webhook Vercel tidak jalan). Deploy
manual lewat CLI:

```bash
export VT=$(grep VERCEL_TOKEN .env.local | cut -d= -f2)
npx vercel deploy --prod --yes --token "$VT"
```

Build lokal lalu alias langsung ke `pos.teiko.co.id`.

## E2E test

Lihat [`e2e/README.md`](e2e/README.md). Ringkasnya: salin
`.env.test.local.example` → `.env.test.local`, isi kredensial + nama outlet test,
lalu `npm run e2e`.
