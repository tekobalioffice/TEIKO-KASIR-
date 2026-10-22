# E2E — Playwright

Test flow POS terhadap **DB produksi**, dibatasi ke satu outlet test (`sdk`).

## Setup

1. `cp .env.test.local.example .env.test.local` lalu isi:
   - `E2E_ADMIN_USER` / `E2E_ADMIN_PASS` — akun admin/owner
   - `E2E_BRANCH_USER` / `E2E_BRANCH_PASS` — akun cabang (opsional, flow staff)
   - `E2E_GUDANG_USER` / `E2E_GUDANG_PASS` — akun gudang (opsional, flow Mode Pengiriman)
   - `E2E_TEST_OUTLET` — nama outlet test (default `sdk`)
2. Outlet test harus sudah ada di **Admin > Cabang**.
3. Browser: config pakai `channel: chrome` (Google Chrome terpasang). Kalau mau
   pakai chromium bawaan Playwright: `npx playwright install chromium` lalu buang
   `channel` di `playwright.config.js`.

## Jalan

```
npm run e2e                       # semua, headless
npm run e2e:headed                # lihat browser
npm run e2e:ui                    # mode UI (debug)
npm run e2e -- e2e/pos-flows.spec.js -g kurasi
E2E_FULL=1 npm run e2e -- pos-flows.spec.js   # sweep SEMUA item (~30 mnt)
E2E_NOSEED=1 npm run e2e          # jangan reset stok outlet dulu
```

`webServer` otomatis `npm run dev` kalau belum jalan.

## Spec

| File | Cakupan |
|------|---------|
| `smoke.spec.js` | sesi admin valid + 6 halaman inti render |
| `pos-flows.spec.js` | sweep drawer: **tambah / ke display / ke stok / kurasi / oper** — tiap item, assert delta di DB, "jangan ada miss" |
| `pos-report.spec.js` | **penjualan → Tutup Shift** bikin `sales_reports`; **Cek Laporan** unduh Excel & diparse; **kontinuitas** Sisa Shift 1 = display awal Shift 2 |
| `pos-pengiriman.spec.js` | kiriman gudang → **ACC → Display / → Stok**, **ACC operan masuk** (transfer), **Tolak kiriman** |
| `pos-gudang-pengiriman.spec.js` | sisi **gudang**: isi "Kirim" di `/gudang/inventory` → Simpan → `pending_stock_actions` dibuat, stok outlet belum berubah (butuh `E2E_GUDANG_*`, else skip) |
| `pos-shift-advanced.spec.js` | Tutup Shift 1→2 kontinuitas · Koreksi Laporan sesuaikan stok (F7) · Buka Ulang Shift restore + log Auto-Deduct tunggal (F6) |
| `pos-audit.spec.js` | balance tiap baris laporan · log Auto-Deduct = terjual · Excel FORM STOK balance |
| `pos-koreksi-stok.spec.js` | Penyesuaian Stok "Ambil Stok Akhir" prefill `sisa_input ?? sisa` (F2) |

## Mekanisme

- **Seed**: `beforeAll` di pos-flows & pos-report reset `branch_inventory` outlet test
  ke baseline (current 30 / display 15 / safety 15) + hapus `pending_stock_actions`
  pending. Tanpa ini, run berulang menguras stok → sweep semua skip.
- **Tanggal unik**: pos-report pakai `RUN_DATE` (epoch-menit → tanggal 2015-xx) supaya
  Tutup Shift selalu "fresh", tidak masuk jalur "Buka Ulang Shift" yang me-restore
  stok dari snapshot lama.
- **Dialog**: fixture `autoDialog` auto-accept semua `confirm/alert/prompt`.
- **Assert via DB**: `e2e/lib/supa.js` (anon key, sama dgn app) baca
  `branch_inventory` / `stock_restock_log` / `pending_stock_actions` / `sales_reports`.

## Temuan

- **F6** (Buka Ulang Shift → log Auto-Deduct dobel) & **F7** (Koreksi Laporan
  laporan terakhir tak sesuaikan `branch_inventory.display_qty`) — sudah di-fix,
  probe di `pos-shift-advanced` sekarang `expect()` beneran (bukan annotate).
- **F1** (driver drift Gula Milk Tea / Black Tea) — tak tereproduksi di data
  produksi (dicek 3 outlet: display = `sisa_input`). Probe `driver-drift` di
  `pos-report` dibiarkan sebagai tripwire.

## Catatan

- App belum ada `data-testid`; selector dari teks / `title` / struktur
  (`.pos-stock-input`, `.page-title`, dst). Kalau UI berubah, sesuaikan helper
  di `e2e/lib/drawer.js`.
- Serial (`workers: 1`) — transaksi ke DB tidak boleh balapan.
