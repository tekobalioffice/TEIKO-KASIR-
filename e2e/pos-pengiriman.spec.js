import { test, expect } from './fixtures.js';
import { supa, TEST_OUTLET, inventorySnapshot, seedOutlet, latestLogs } from './lib/supa.js';
import { openShift } from './lib/drawer.js';

/**
 * Mode PENGIRIMAN: gudang kirim barang → muncul di banner "Kiriman" BranchPOS →
 * outlet ACC / Tolak. Kiriman di-seed lewat pending_stock_actions.
 *
 *  pengiriman_display → ACC: tambah_qty += qty (masuk Awal sbg Pindahan)
 *  pengiriman_gudang  → ACC: safety_qty += qty, current_qty += qty
 *  transfer (dari cabang lain) → ACC: display_qty += qty, current_qty += qty
 */
test.describe.configure({ mode: 'serial' });

const SRC = 'GUDANG PUSAT (e2e)';

async function seedKiriman(rows) {
  await supa.from('pending_stock_actions').delete().eq('target_branch', TEST_OUTLET).eq('created_by', SRC);
  const { data, error } = await supa.from('pending_stock_actions').insert(
    rows.map((r) => ({ ...r, source_branch: SRC, target_branch: TEST_OUTLET, created_by: SRC, status: 'pending' })),
  ).select();
  if (error) throw error;
  return data;
}
async function pendingStatus(id) {
  const { data } = await supa.from('pending_stock_actions').select('status').eq('id', id).maybeSingle();
  return data?.status ?? 'gone';
}

// kartu banner utk 1 kiriman = div yg memuat nama item & tombol "ACC Terima"
function card(page, itemName) {
  return page.locator('div')
    .filter({ has: page.getByText(itemName, { exact: false }) })
    .filter({ has: page.getByRole('button', { name: /ACC Terima/i }) })
    .last();
}

test.beforeAll(async () => {
  if (process.env.E2E_NOSEED !== '1') await seedOutlet(TEST_OUTLET);
});

test('ACC kiriman → Display & → Stok (Safety)', async ({ page, testOutlet }) => {
  test.setTimeout(180_000);
  const [kd, kg] = await seedKiriman([
    { action_type: 'pengiriman_display', item_name: 'Kresek', qty: 4 },
    { action_type: 'pengiriman_gudang', item_name: 'Diamond BC', qty: 3 },
  ]);
  const before = await inventorySnapshot(testOutlet);

  await openShift(page, testOutlet, '1');
  await expect(page.getByText(/Kiriman Baru/i).first()).toBeVisible({ timeout: 20_000 });

  await card(page, 'Kresek').getByRole('button', { name: /ACC Terima/i }).click();
  await expect.poll(() => pendingStatus(kd.id), { timeout: 20_000 }).not.toBe('pending');

  await card(page, 'Diamond BC').getByRole('button', { name: /ACC Terima/i }).click();
  await expect.poll(() => pendingStatus(kg.id), { timeout: 20_000 }).not.toBe('pending');

  const after = await inventorySnapshot(testOutlet);
  // pengiriman_display → tambah_qty naik
  expect(after['Kresek'].tambah_qty ?? 0).toBeCloseTo((before['Kresek'].tambah_qty ?? 0) + 4, 3);
  // pengiriman_gudang → safety + current naik
  expect(after['Diamond BC'].safety_qty).toBeCloseTo(before['Diamond BC'].safety_qty + 3, 3);
  expect(after['Diamond BC'].current_qty).toBeCloseTo(before['Diamond BC'].current_qty + 3, 3);

  const logs = await latestLogs(testOutlet, 30);
  expect(logs.some((l) => /Kiriman dari Gudang diterima/i.test(l.petugas_name))).toBe(true);
});

test('ACC operan masuk dari cabang lain (transfer)', async ({ page, testOutlet }) => {
  test.setTimeout(180_000);
  const [t] = await seedKiriman([{ action_type: 'transfer', item_name: 'Milo Ori', qty: 2 }]);
  const before = await inventorySnapshot(testOutlet);

  await openShift(page, testOutlet, '1');
  await expect(page.getByText(/Kiriman Barang Masuk/i).first()).toBeVisible({ timeout: 20_000 });
  await card(page, 'Milo Ori').getByRole('button', { name: /ACC Terima/i }).click();
  await expect.poll(() => pendingStatus(t.id), { timeout: 20_000 }).not.toBe('pending');

  const after = await inventorySnapshot(testOutlet);
  expect(after['Milo Ori'].display_qty).toBeCloseTo(before['Milo Ori'].display_qty + 2, 3);
  expect(after['Milo Ori'].current_qty).toBeCloseTo(before['Milo Ori'].current_qty + 2, 3);
});

test('Tolak kiriman → stok tidak berubah', async ({ page, testOutlet }) => {
  test.setTimeout(180_000);
  const [k] = await seedKiriman([{ action_type: 'pengiriman_display', item_name: 'Kresek', qty: 9 }]);
  const before = await inventorySnapshot(testOutlet);

  await openShift(page, testOutlet, '1');
  const c = page.locator('div')
    .filter({ has: page.getByText('Kresek', { exact: false }) })
    .filter({ has: page.getByRole('button', { name: /^Tolak$/ }) }).last();
  await c.getByRole('button', { name: /^Tolak$/ }).click();
  // window.prompt alasan → auto-accept fixture (default '')
  await expect.poll(() => pendingStatus(k.id), { timeout: 20_000 }).not.toBe('pending');

  const after = await inventorySnapshot(testOutlet);
  expect(after['Kresek'].current_qty).toBeCloseTo(before['Kresek'].current_qty, 3);
  expect(after['Kresek'].tambah_qty ?? 0).toBeCloseTo(before['Kresek'].tambah_qty ?? 0, 3);
});
