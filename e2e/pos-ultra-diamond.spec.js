import { test, expect } from './fixtures.js';
import { supa, TEST_OUTLET } from './lib/supa.js';
import { openShift, openDrawer, setMode } from './lib/drawer.js';
import { read as xlsxRead, utils as xlsxUtils } from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Tombol "Jadi Diamond" (Ultra Milk Besar -> Diamond Besar, Gudang->Gudang) dan blok
 * Shift 1 basi (getStaleShift1Date). Hanya menyentuh outlet test.
 */
test.describe.configure({ mode: 'serial' });

const ULTRA = 'Ultra Milk Besar', DIAMOND = 'Diamond Besar', META = 'Ultra di Diamond Besar';
const inv = async (n) => (await supa.from('branch_inventory').select('*').eq('branch_name', TEST_OUTLET).eq('item_name', n).single()).data;
const status = (petugas, created_at) => supa.from('stock_restock_log').insert({
  branch_name: TEST_OUTLET, item_name: 'Status Aktivitas', qty_added: 0, qty_before: 0, qty_after: 0,
  petugas_name: petugas, ...(created_at ? { created_at } : {}),
});

test.beforeAll(async () => {
  for (const [n, d] of [[ULTRA, 3], [DIAMOND, 2]]) {
    const { error } = await supa.from('branch_inventory').upsert(
      { branch_name: TEST_OUTLET, item_name: n, display_qty: 0, safety_qty: d, current_qty: d, tambah_qty: 0 },
      { onConflict: 'branch_name,item_name' });
    if (error) throw error;
  }
  await status('e2e (Tutup Shift 2)', new Date(Date.now() - 48 * 3600e3).toISOString()); // pastikan tak ada Shift 1 basi dari run lain
});

test('Jadi Diamond: Ultra -1, Diamond +1, display tak berubah, meta tercatat', async ({ page, testOutlet }) => {
  test.setTimeout(120_000);
  await openShift(page, testOutlet, '1');
  await openDrawer(page);
  await setMode(page, 'toDisplay');
  await page.getByTitle(/Jadikan Diamond Besar/).click();
  const qtyInput = page.getByPlaceholder(/boleh 0\.5/);
  await qtyInput.fill('1');
  await page.locator('form').filter({ has: qtyInput }).getByRole('button', { name: 'Simpan' }).click();
  await expect(qtyInput).toHaveCount(0, { timeout: 15_000 });

  await expect.poll(async () => (await inv(ULTRA)).safety_qty).toBe(2);
  expect(await inv(ULTRA)).toMatchObject({ current_qty: 2, display_qty: 0 });
  expect(await inv(DIAMOND)).toMatchObject({ current_qty: 3, safety_qty: 3, display_qty: 0 });
  const { data: m } = await supa.from('stock_restock_log').select('qty_after').eq('branch_name', TEST_OUTLET)
    .eq('item_name', META).order('created_at', { ascending: false }).limit(1);
  expect(Number(m[0].qty_after)).toBeGreaterThanOrEqual(1);
  // catatan di log: sumber "(Jadi Diamond Besar)", tujuan "(Dari Ultra Milk Besar)"
  const { data: notes } = await supa.from('stock_restock_log').select('item_name, petugas_name').eq('branch_name', TEST_OUTLET)
    .in('item_name', [ULTRA, DIAMOND]).order('created_at', { ascending: false }).limit(2);
  expect(notes.find(n => n.item_name === ULTRA).petugas_name).toContain('Jadi Diamond Besar');
  expect(notes.find(n => n.item_name === DIAMOND).petugas_name).toContain('Dari Ultra Milk Besar');
});

test('Excel Cek Laporan: baris Diamond Besar menulis "N(ultra)+M"', async ({ page, testOutlet }) => {
  test.setTimeout(120_000);
  await openShift(page, testOutlet, '1');
  // baris Diamond Besar di layar input menampilkan hasil konversi Ultra
  await expect(page.getByText(/Hasil konversi Ultra: \d/).first()).toBeVisible({ timeout: 15_000 });
  // isi Sisa tiap item (Awal-1) supaya Cek Laporan boleh jalan; Diamond Besar ikut terisi
  const inputs = page.locator('.pos-stock-input[data-col="qty"]');
  await expect(inputs.first()).toBeVisible({ timeout: 20_000 });
  for (let i = 0, n = await inputs.count(); i < n; i++) {
    const ph = parseFloat(String(await inputs.nth(i).getAttribute('placeholder') || '').replace(/[^\d.]/g, '')) || 0;
    if (ph >= 1) await inputs.nth(i).fill(String(Math.floor(ph) - 1));
  }
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByRole('button', { name: /Cek Laporan/i }).click(),
  ]);
  const file = path.join('test-results', `ultra-${Date.now()}.xlsx`);
  await dl.saveAs(file);
  const wb = xlsxRead(fs.readFileSync(file));
  fs.rmSync(file, { force: true });
  const rows = wb.SheetNames.flatMap(n => xlsxUtils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' }));
  const dia = rows.find(r => String(r[1] ?? r[0]).includes('Diamond Besar') || r.some(c => c === 'Diamond Besar'));
  expect(dia, 'baris Diamond Besar').toBeTruthy();
  expect(dia.some(c => /^\d+(\.\d+)?\(ultra\)(\+\d+(\.\d+)?)?$/.test(String(c))), JSON.stringify(dia)).toBe(true);
});

test('Shift 1 kemarin belum ditutup: aksi stok TIDAK diblok (porsi hangus otomatis)', async ({ page, testOutlet }) => {
  test.setTimeout(120_000);
  await openShift(page, testOutlet, '1');
  await openDrawer(page);
  await setMode(page, 'toDisplay');
  const before = await inv(ULTRA);
  // openShift menulis log Buka hari ini; buang supaya log terbaru = Buka S1 kemarin yang tak pernah ditutup.
  await supa.from('stock_restock_log').delete().eq('branch_name', TEST_OUTLET).eq('item_name', 'Status Aktivitas')
    .gt('created_at', new Date(Date.now() - 30 * 3600e3).toISOString());
  await status('e2e (Buka Input Shift 1)', new Date(Date.now() - 30 * 3600e3).toISOString());
  let msg = '';
  page.removeAllListeners('dialog');
  page.on('dialog', async (d) => { msg = d.message(); await d.accept(); });
  await page.getByTitle(/Jadikan Diamond Besar/).click();
  const qtyInput = page.getByPlaceholder(/boleh 0\.5/);
  await qtyInput.fill('1');
  await page.locator('form').filter({ has: qtyInput }).getByRole('button', { name: 'Simpan' }).click();
  await expect(qtyInput).toHaveCount(0, { timeout: 15_000 });
  expect(msg).not.toMatch(/belum ditutup/);
  await expect.poll(async () => (await inv(ULTRA)).safety_qty).toBe(before.safety_qty - 1);
});

test.afterAll(async () => {
  await status('e2e (Tutup Shift 2)'); // bersihkan: log terbaru = Tutup
});
