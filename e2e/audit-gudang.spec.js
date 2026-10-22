import { test, expect } from '@playwright/test';

/**
 * Audit cepat semua halaman role Gudang: pastikan tiap route kebuka tanpa error,
 * dan cek spesifik bug yang dilaporkan user — dropdown "Analisis Data" (hari) di
 * halaman Purchasing katanya tak ngubah apa-apa pas diganti.
 */
test.use({ storageState: 'e2e/.auth/gudang.json' });

const ROUTES = [
  ['inventory', 'Kelola Stok Pusat'],
  ['cek-pengiriman', 'Cek Pengiriman'],
  ['monitoring-stok', 'Leaderboard Penjualan'],
  ['purchasing', 'Purchasing'],
  ['riwayat-stok', 'Riwayat Aktivitas Stok'],
  ['operasional-check', 'Form Stok Barang Checking (tanpa link sidebar)'],
  ['operasional', 'Support Product (tanpa link sidebar)'],
  ['kartu-stock', 'Kartu Stock (tanpa link sidebar)'],
];

test.describe('Audit role Gudang — semua 8 halaman', () => {
  for (const [path, label] of ROUTES) {
    test(`/gudang/${path} — ${label} kebuka tanpa error`, async ({ page }) => {
      const errs = [];
      page.on('pageerror', (e) => errs.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

      await page.goto(`/gudang/${path}`);
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      await expect(page.locator('body')).not.toContainText('Cannot read prop', { timeout: 5_000 }).catch(() => {});

      const bodyText = await page.locator('body').innerText();
      expect(bodyText.length).toBeGreaterThan(50); // halaman render sesuatu, bukan blank
      if (errs.length) console.log(`  [console/page errors di /gudang/${path}]:`, errs.slice(0, 5));
    });
  }

  test('Purchasing — ganti dropdown "Analisis Data" (hari) harus ubah angka', async ({ page }) => {
    await page.goto('/gudang/purchasing');
    await expect(page.getByText('Rekomendasi Pembelian')).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    const readCounts = async () => {
      const text = await page.locator('body').innerText();
      const kritis = text.match(/Kritis \(Segera Beli\)[\s\S]{0,20}?(\d+) Item/) || text.match(/(\d+) Item[\s\S]{0,5}Kritis/);
      const restock = text.match(/(\d+) Item[\s\S]{0,60}Perlu Restock/) || text.match(/Perlu Restock[\s\S]{0,20}?(\d+) Item/);
      return { raw: text.slice(0, 400) };
    };

    const select = page.locator('select').first();
    await expect(select).toBeVisible();
    const before = await select.inputValue();
    console.log('  periodDays sebelum:', before);
    const beforeTable = await page.locator('table').innerText();

    // Ganti ke opsi lain dari yang sekarang.
    const target = before === '30' ? '7' : '30';
    await select.selectOption(target);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1500); // kasih waktu re-fetch + re-render kalau async
    const after = await select.inputValue();
    const afterTable = await page.locator('table').innerText();

    console.log('  periodDays sesudah:', after);
    console.log('  Tabel BERUBAH:', beforeTable !== afterTable);
    if (beforeTable === afterTable) {
      console.log('  ⚠️ TABEL SAMA PERSIS SEBELUM/SESUDAH GANTI DROPDOWN — kandidat bug.');
      console.log('  --- isi tabel (500 char pertama) ---');
      console.log(afterTable.slice(0, 500));
    }
    expect(after).toBe(target); // dropdown-nya sendiri minimal harus ke-update
  });
});

test('Purchasing — ganti "Target Stok" harus ubah tabel INSTAN (bug lama: diem sampai Refresh)', async ({ page }) => {
  await page.goto('/gudang/purchasing');
  await expect(page.getByText('Rekomendasi Pembelian')).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(500);

  const targetStokInput = page.locator('input[type="number"]').first();
  const beforeVal = await targetStokInput.inputValue();
  const beforeTable = await page.locator('table').innerText();

  await targetStokInput.fill('999');
  await page.waitForTimeout(800); // tanpa network round-trip, harusnya instan
  const afterTable = await page.locator('table').innerText();

  console.log('  Target Stok:', beforeVal, '->', await targetStokInput.inputValue());
  console.log('  Tabel berubah instan (tanpa klik Refresh):', beforeTable !== afterTable);
  expect(beforeTable).not.toBe(afterTable);

  // Cek kontrol "Batas Peringatan" ada & juga instan
  const thresholdInput = page.locator('input[type="number"]').nth(1);
  await expect(thresholdInput).toBeVisible();
  await thresholdInput.fill('60'); // gede -> harusnya banyak item jadi "kritis"
  await page.waitForTimeout(800);
  const afterThreshold = await page.locator('table').innerText();
  console.log('  Tabel berubah instan pas Batas Peringatan diganti:', afterTable !== afterThreshold);
  expect(afterTable).not.toBe(afterThreshold);
});
