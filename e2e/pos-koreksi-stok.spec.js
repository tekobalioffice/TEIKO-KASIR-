import { test, expect } from './fixtures.js';
import { supa, TEST_OUTLET } from './lib/supa.js';
import { num } from './lib/shift.js';

/**
 * Regresi fix F2: Penyesuaian Stok > "Ambil Stok Akhir Kemarin" harus prefill
 * kolom Awal dari `sisa_input ?? sisa` laporan terakhir SEBELUM hari ini
 * (bukan sisa_input saja). Test hanya prefill — TIDAK klik Simpan.
 */
test('Ambil Stok Akhir Kemarin — prefill dari sisa_input ?? sisa', async ({ page, testOutlet }) => {
  test.setTimeout(120_000);

  const today = new Date().toISOString().split('T')[0];
  const { data } = await supa.from('sales_reports')
    .select('date, shift, details').eq('branch_name', testOutlet)
    .lt('date', today).order('date', { ascending: false }).order('shift', { ascending: false }).limit(1);
  test.skip(!data?.length, 'tak ada laporan sebelum hari ini utk outlet uji');

  const rep = data[0];
  const expected = {};
  for (const d of rep.details || []) {
    if (d._is_meta || d._is_inventory_snapshot || d._is_preclose_snapshot || !d.name) continue;
    const k = d.variant && d.variant !== 'Standar' ? `${d.name} ${d.variant}` : d.name;
    const v = d.sisa_input ?? d.sisa; // <-- inti fix F2
    if (v != null) expected[k] = num(v);
  }
  const withSisaOnly = (rep.details || []).some((d) => d.name && (d.sisa_input == null) && d.sisa != null);

  await page.goto('/admin/koreksi');
  await expect(page.getByRole('heading', { name: /Penyesuaian Stok/i })).toBeVisible({ timeout: 15_000 });
  await page.locator('select').first().selectOption(testOutlet);
  await page.waitForTimeout(800);

  await page.getByRole('button', { name: /Ambil Stok Akhir/i }).click();
  await expect(page.getByText(/item terisi dari Stok Akhir/i)).toBeVisible({ timeout: 20_000 });

  // cek beberapa baris: nilai di kolom Awal (data-koreksi-cell="awal:N") cocok expected
  const rows = page.locator('tr', { has: page.locator('[data-koreksi-cell^="awal:"]') });
  const n = Math.min(await rows.count(), 40);
  let matched = 0;
  const mism = [];
  for (let i = 0; i < n; i++) {
    const nameCell = (await rows.nth(i).locator('td').nth(1).textContent().catch(() => ''))?.trim();
    const val = await rows.nth(i).locator('[data-koreksi-cell^="awal:"]').inputValue().catch(() => '');
    if (!nameCell || val === '' || expected[nameCell] === undefined) continue;
    if (Math.abs(parseFloat(val) - expected[nameCell]) < 0.001) matched++;
    else mism.push(`${nameCell}: prefill ${val} ≠ ${expected[nameCell]}`);
  }
  test.info().annotations.push({ type: 'prefill', description: `cocok ${matched}, meleset ${mism.length}, ada item sisa-only: ${withSisaOnly}` });
  expect(matched, 'minimal beberapa item ter-prefill cocok').toBeGreaterThan(3);
  expect(mism, mism.slice(0, 15).join(' | ')).toEqual([]);
});
