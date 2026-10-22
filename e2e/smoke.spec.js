import { test, expect } from './fixtures.js';

// Smoke: sesi admin valid & halaman inti ke-render tanpa ErrorBoundary.
// Ini yang pertama harus hijau sebelum flow transaksi ditulis.

const PAGES = [
  ['/admin', /Dashboard Overview/i],
  ['/admin/pos', /Mulai Sesi Kasir|Input Laporan Shift/i],
  ['/admin/stock', /Leaderboard Penjualan/i],
  ['/admin/operasional-check', /Input Form Stok Barang Checking/i],
  ['/admin/branches', /Kelola Cabang Fisik/i],
  ['/admin/riwayat-stok', /Riwayat Aktivitas Stok/i],
];

for (const [path, marker] of PAGES) {
  test(`halaman ${path} render`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByText('Terjadi Kesalahan Aplikasi')).toHaveCount(0);
    await expect(page.getByText(marker).first()).toBeVisible();
  });
}

test('outlet test tersedia', async ({ testOutlet }) => {
  expect(testOutlet).toBeTruthy();
});
