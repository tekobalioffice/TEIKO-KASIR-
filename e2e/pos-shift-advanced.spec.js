import { test, expect } from './fixtures.js';
import { supa, TEST_OUTLET, seedOutlet, inventorySnapshot } from './lib/supa.js';
import { openShift } from './lib/drawer.js';
import { reportIds, reportById, newReportId, fillSisa, closeShift, num, detailKey, realRows } from './lib/shift.js';

/**
 * Flow shift lanjutan — tiap test independen (bisa dijalankan sendiri via -g):
 *  1. Tutup Shift 1 lalu Shift 2 (lanjutan hari sama) — sisa S2 = display_qty
 *  2. Koreksi Laporan per-baris — patch details + sesuaikan stok (laporan terakhir)
 *  3. Buka Ulang Shift — restore stok ke sebelum Tutup Shift (+ probe F6)
 *
 * BUKAN serial: tiap test bikin shift+laporannya sendiri. Serial dulu bikin 1
 * kegagalan nge-skip 2 test lain & retry-nya ngulang semua (mahal di mesin RAM ketat).
 */

const DRIVER = /^(Gula Milk Tea|Black Tea)\b/;
const plusDays = (d, n) => new Date(new Date(d).getTime() + n * 864e5).toISOString().split('T')[0];

// BASE  = tanggal masa-depan-dekat & unik per proses → shift + laporan test ini fresh
//         (tak masuk jalur Buka Ulang Shift). Dipakai test "Tutup Shift 1→2" & "Buka Ulang".
// LATEST = beberapa hari SESUDAH laporan sdk paling akhir yang ADA → dijamin jadi
//         "laporan terakhir" (isLatest). Cuma Koreksi Laporan (F7) yang butuh ini —
//         spec pakai anon key, tak bisa hapus polusi tanggal dari run sebelumnya.
const BASE = new Date(Date.UTC(2040, 0, 1) + (Math.floor(Date.now() / 1000) % 4000) * 864e5)
  .toISOString().split('T')[0];
let LATEST;
test.beforeAll(async () => {
  const { data } = await supa.from('sales_reports')
    .select('date').eq('branch_name', TEST_OUTLET)
    .order('date', { ascending: false }).limit(1);
  const last = data?.[0]?.date ? new Date(`${data[0].date}T00:00:00Z`) : new Date();
  LATEST = new Date(last.getTime() + 5 * 864e5).toISOString().split('T')[0];
});

test.beforeEach(async () => {
  if (process.env.E2E_NOSEED !== '1') await seedOutlet(TEST_OUTLET);
});

test('Tutup Shift 1 lalu Shift 2 — sisa S2 = display_qty tiap item', async ({ page, testOutlet }) => {
  test.setTimeout(600_000);
  const D = BASE;
  let before = await reportIds();
  await openShift(page, testOutlet, '1', D);
  await fillSisa(page, 1, 40);
  await closeShift(page, 1);
  await expect.poll(async () => (await newReportId(before)) != null, { timeout: 45_000 }).toBe(true);

  before = await reportIds();
  await openShift(page, testOutlet, '2', D);
  await fillSisa(page, 1, 40);
  await closeShift(page, 2);
  await expect.poll(async () => (await newReportId(before)) != null, { timeout: 45_000 }).toBe(true);
  const s2 = await reportById(await newReportId(before));
  expect(String(s2.shift)).toBe('2');

  const inv = await inventorySnapshot(testOutlet);
  const bad = [];
  let checked = 0;
  for (const d of realRows(s2)) {
    if (DRIVER.test(detailKey(d)) || num(d.display_awal) <= 0) continue;
    const row = inv[detailKey(d)] ?? inv[d.name];
    if (!row) continue;
    checked++;
    if (Math.abs(num(row.display_qty) - num(d.sisa_input ?? d.sisa)) > 0.02)
      bad.push(`${detailKey(d)}: display ${row.display_qty} ≠ sisa S2 ${d.sisa_input ?? d.sisa}`);
  }
  test.info().annotations.push({ type: 'shift2-sync', description: `dicek ${checked}, drift ${bad.length}` });
  expect(checked).toBeGreaterThan(15);
  expect(bad, bad.slice(0, 20).join(' | ')).toEqual([]);
});

test('Koreksi Laporan per-baris — patch details + sesuaikan stok', async ({ page, testOutlet }) => {
  test.setTimeout(600_000);
  // LATEST → laporan sdk terakhir + 5 hari → dijamin isLatest (uji jalur
  // branch_inventory.display_qty ikut dikoreksi).
  const D = LATEST;

  // tutup shift 1 dulu supaya ada laporan terakhir utk dikoreksi
  const before = await reportIds();
  await openShift(page, testOutlet, '1', D);
  await fillSisa(page, 2, 40);
  await closeShift(page, 1);
  await expect.poll(async () => (await newReportId(before)) != null, { timeout: 45_000 }).toBe(true);
  const repId = await newReportId(before);
  const rep = await reportById(repId);

  const target = realRows(rep).find((d) =>
    num(d.display_awal) > 1 && num(d.sisa_input ?? d.sisa) >= 1 &&
    !DRIVER.test(detailKey(d)) && (!d.variant || d.variant === 'Standar'));
  expect(target, 'ada item cocok utk dikoreksi').toBeTruthy();
  const key = target.name;
  const invBefore = num((await inventorySnapshot(testOutlet))[key].display_qty);
  const oldSisa = num(target.sisa_input ?? target.sisa);
  const newSisa = oldSisa + 1;
  const newAwal = num(target.display_awal) + 1; // jaga balance

  await page.goto('/admin/koreksi-laporan');
  await page.locator('select').first().selectOption(testOutlet);
  await page.locator('input[type="date"]').fill(D);
  await page.locator('select').last().selectOption('1');
  await page.getByRole('button', { name: /Muat Laporan/i }).click();
  await expect(page.getByText(key, { exact: true })).toBeVisible({ timeout: 15_000 });
  // isLatest = persis logika app: tak ada report sdk yg lebih baru dari (D, shift 1)
  const { data: later } = await supa.from('sales_reports').select('id')
    .eq('branch_name', testOutlet).or(`date.gt.${D},and(date.eq.${D},shift.gt.1)`);
  const isLatest = !later?.length;

  const cells = page.locator('tr', { has: page.getByText(key, { exact: true }) }).locator('input.input-field');
  await cells.nth(0).fill(String(newAwal)); // Awal
  await cells.nth(4).fill(String(newSisa)); // Sisa
  await page.getByRole('button', { name: /^Simpan/i }).click(); // confirm auto-accept

  // FUNGSI INTI: details laporan di-patch (Awal & Sisa baru tersimpan, balance dijaga)
  await expect.poll(async () => {
    const d = realRows(await reportById(repId)).find((x) => x.name === key);
    return d ? [num(d.sisa_input), num(d.display_awal)].join(',') : null;
  }, { timeout: 25_000 }).toBe(`${newSisa},${newAwal}`);

  // branch_inventory.display_qty: ikut (newSisa−oldSisa) HANYA kalau laporan terakhir.
  await new Promise((r) => setTimeout(r, 4000));
  const after = num((await inventorySnapshot(testOutlet))[key]?.display_qty);
  const adjusted = Math.abs(after - (invBefore + (newSisa - oldSisa))) < 0.5;
  test.info().annotations.push({
    type: 'koreksi',
    description: `${key}: isLatest=${isLatest} · display ${invBefore}→${after} · stok disesuaikan: ${adjusted}`,
  });
  if (!isLatest) {
    expect(after, 'stok cabang tidak berubah (bukan laporan terakhir)').toBeCloseTo(invBefore, 1);
  } else {
    // F7 (fixed): koreksi Sisa pada laporan terakhir harus ikut menyesuaikan
    // branch_inventory.display_qty — kalau tidak, shift berikutnya baca Awal lama.
    expect(
      after,
      `F7: display_qty ikut koreksi Sisa (${invBefore} → ${invBefore + (newSisa - oldSisa)}), dapat ${after}`,
    ).toBeCloseTo(invBefore + (newSisa - oldSisa), 1);
  }
});

test('Buka Ulang Shift — stok di-restore ke sebelum Tutup Shift (+ probe F6)', async ({ page, testOutlet }) => {
  test.setTimeout(600_000);
  const D = plusDays(BASE, 20);
  const probe = 'Kresek';

  await openShift(page, testOutlet, '1', D);
  const invPre = num((await inventorySnapshot(testOutlet))[probe].display_qty);
  await fillSisa(page, 2, 30);
  // pastikan `probe` ikut terjual (bisa di luar 30 pertama)
  const probeRow = page.locator('div').filter({ has: page.getByText(probe, { exact: true }) })
    .filter({ has: page.locator('.pos-stock-input[data-col="qty"]') }).last();
  await probeRow.locator('.pos-stock-input[data-col="qty"]').fill(String(Math.max(0, invPre - 2)));
  // patokan waktu SEBELUM close pertama → query di bawah mencakup log Auto-Deduct
  // close-1 maupun close-2, jadi hitungannya deterministik (bukan balapan dgn insert).
  const tsStart = Date.now() - 3000;
  await closeShift(page, 1);
  await expect.poll(async () => num((await inventorySnapshot(testOutlet))[probe].display_qty), { timeout: 30_000 })
    .toBeCloseTo(invPre - 2, 1);

  // buka lagi shift+tanggal sama → jalur Buka Ulang Shift (confirm auto-accept)
  await openShift(page, testOutlet, '1', D);
  await expect.poll(async () => num((await inventorySnapshot(testOutlet))[probe].display_qty), { timeout: 30_000 })
    .toBeCloseTo(invPre, 1); // di-restore

  // Tutup lagi (reclose) → cek F6: log Auto-Deduct dari close pertama harus hilang/ditandai,
  // bukan numpuk. Kalau numpuk, "Penjualan" di Kartu Stok jadi 2×.
  await fillSisa(page, 2, 30);
  await probeRow.locator('.pos-stock-input[data-col="qty"]').fill(String(Math.max(0, invPre - 2)));
  await closeShift(page, 1);
  await expect.poll(async () => num((await inventorySnapshot(testOutlet))[probe].display_qty), { timeout: 30_000 })
    .toBeCloseTo(invPre - 2, 1); // stok fisik: tetap benar (−2)

  await new Promise((r) => setTimeout(r, 4000));
  const { data: logs } = await supa.from('stock_restock_log')
    .select('qty_added, created_at').eq('branch_name', testOutlet).eq('item_name', probe)
    .ilike('petugas_name', '%Auto-Deduct Shift 1%')
    .gte('created_at', new Date(tsStart).toISOString());
  const n = (logs || []).length;
  const totQty = (logs || []).reduce((a, l) => a + num(l.qty_added), 0);
  test.info().annotations.push({
    type: 'F6-reopen-reclose',
    description: `${probe}: close-1 → Buka Ulang → close-2 = ${n} entri Auto-Deduct, total qty ${totQty}. Stok fisik ${invPre}→${invPre - 2}.`,
  });
  // F6 (fixed): Buka Ulang Shift menghapus log Auto-Deduct milik close yang dibatalkan.
  // Sisa harusnya 1 entri = 1 shift terjual (−2), bukan 2 entri / −4 (Kartu Stok berlipat).
  expect(n, `F6: log Auto-Deduct close-1 dihapus saat Buka Ulang → sisa 1 entri, dapat ${n}`).toBe(1);
  expect(totQty, `F6: total Auto-Deduct = 1 shift terjual (−2), dapat ${totQty}`).toBeCloseTo(-2, 1);
});
