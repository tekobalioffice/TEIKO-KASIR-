import { test, expect } from './fixtures.js';
import { inventorySnapshot, latestLogs, supa, seedOutlet, TEST_OUTLET } from './lib/supa.js';
import { openShift, openDrawer, setMode, rowAction } from './lib/drawer.js';

/**
 * Sweep item lewat tiap mode drawer, sebagai Admin di outlet test.
 * "jangan ada miss": tiap item non-skip harus berubah di DB sesuai mode.
 *
 * Default: SAMPLE item (cepat, buat loop debug).
 * Full 90+ item: set E2E_FULL=1 (lambat, ~30 mnt).
 *
 * Mode: tambah, toDisplay, toStok, kurasi, oper.
 * Penjualan + Excel + kontinuitas shift → pos-report.spec.js.
 */

test.describe.configure({ mode: 'serial' });

// Reset stok outlet test ke baseline sebelum sweep (run berulang jadi deterministik).
test.beforeAll(async () => {
  if (process.env.E2E_NOSEED !== '1') await seedOutlet(TEST_OUTLET);
});

const VIRTUAL = /^Porsi Bubble/;
const FULL = process.env.E2E_FULL === '1';
const SAMPLE = [
  'Gula Milk Tea Ori', 'Milo Ori', 'Diamond BC', 'Kresek', 'Bubble Besar',
];

async function targetItems(outlet) {
  const snap = await inventorySnapshot(outlet);
  const all = Object.keys(snap).filter((n) => !VIRTUAL.test(n));
  const list = FULL ? all.sort() : SAMPLE.filter((n) => all.includes(n));
  return { snap, list };
}

async function sweep(page, outlet, mode, opts = {}) {
  if (!opts.reuse) {
    await openShift(page, outlet, '1');
    await openDrawer(page);
  }
  await setMode(page, mode);
  const { snap, list } = await targetItems(outlet);
  const done = [];
  const skipped = {};
  for (const name of list) {
    const r = await test.step(`${mode} · ${name}`, () =>
      rowAction(page, mode, name, opts).catch((e) => `err:${e.message.split('\n')[0]}`));
    if (r === 'done') done.push(name);
    else skipped[name] = r;
  }
  return { done, skipped, snapBefore: snap };
}

test('sweep tambah — total stok naik', async ({ page, testOutlet }) => {
  test.setTimeout(FULL ? 1_800_000 : 240_000);
  const { done, skipped, snapBefore } = await sweep(page, testOutlet, 'tambah', { qty: 1 });
  expect(done.length, `skip: ${JSON.stringify(skipped)}`).toBeGreaterThan(0);

  const after = await inventorySnapshot(testOutlet);
  const missed = done.filter((n) => (after[n]?.current_qty ?? 0) < (snapBefore[n]?.current_qty ?? 0) + 1 - 1e-6);
  expect(missed, `tidak nambah: ${missed.join(', ')}`).toEqual([]);
});

test('sweep ke display — display naik, total tetap', async ({ page, testOutlet }) => {
  test.setTimeout(FULL ? 1_800_000 : 240_000);
  const { done, skipped, snapBefore } = await sweep(page, testOutlet, 'toDisplay', { qty: 1 });
  expect(done.length, `skip: ${JSON.stringify(skipped)}`).toBeGreaterThan(0);

  const after = await inventorySnapshot(testOutlet);
  const bad = done.filter((n) => {
    const b = snapBefore[n], a = after[n];
    return Math.abs((a.current_qty ?? 0) - (b.current_qty ?? 0)) > 1e-6
      || (a.display_qty ?? 0) < (b.display_qty ?? 0) + 1 - 1e-6;
  });
  expect(bad, `ke display salah: ${bad.join(', ')}`).toEqual([]);
});

test('sweep ke stok — safety naik, total tetap', async ({ page, testOutlet }) => {
  test.setTimeout(FULL ? 1_800_000 : 240_000);
  const { done, skipped, snapBefore } = await sweep(page, testOutlet, 'toStok', { qty: 1 });
  expect(done.length, `skip: ${JSON.stringify(skipped)}`).toBeGreaterThan(0);

  const after = await inventorySnapshot(testOutlet);
  const bad = done.filter((n) => {
    const b = snapBefore[n], a = after[n];
    return Math.abs((a.current_qty ?? 0) - (b.current_qty ?? 0)) > 1e-6
      || (a.safety_qty ?? 0) < (b.safety_qty ?? 0) + 1 - 1e-6;
  });
  expect(bad, `ke stok salah: ${bad.join(', ')}`).toEqual([]);
});

test('sweep kurasi — total & display turun', async ({ page, testOutlet }) => {
  test.setTimeout(FULL ? 1_800_000 : 300_000);
  await sweep(page, testOutlet, 'toDisplay', { qty: 1 }); // pastikan ada display
  const { done, skipped, snapBefore } = await sweep(page, testOutlet, 'kurasi', { qty: 1, reuse: true });
  expect(done.length, `skip: ${JSON.stringify(skipped)}`).toBeGreaterThan(0);

  const after = await inventorySnapshot(testOutlet);
  const bad = done.filter((n) => (after[n]?.current_qty ?? 0) > (snapBefore[n]?.current_qty ?? 0) - 1 + 1e-6);
  expect(bad, `kurasi tidak motong: ${bad.join(', ')}`).toEqual([]);
  expect((await latestLogs(testOutlet, 200)).some((l) => /Kurasi/i.test(l.petugas_name))).toBe(true);
});

test('sweep oper — 1 unit ke outlet lain, pending ACC', async ({ page, testOutlet }) => {
  test.setTimeout(FULL ? 1_800_000 : 240_000);
  const { data: others } = await supa.from('outlets').select('name').neq('name', testOutlet).order('name');
  test.skip(!others?.length, 'butuh outlet lain');
  const dest = others[0].name;

  const { done, skipped } = await sweep(page, testOutlet, 'oper', { qty: 1, dest });
  expect(done.length, `skip: ${JSON.stringify(skipped)}`).toBeGreaterThan(0);

  const { data: pend } = await supa
    .from('pending_stock_actions').select('item_name')
    .eq('source_branch', testOutlet).eq('target_branch', dest).eq('status', 'pending');
  const names = new Set((pend || []).map((p) => p.item_name));
  const missed = done.filter((n) => !names.has(n));
  expect(missed, `oper tak jadi pending: ${missed.join(', ')}`).toEqual([]);
});
