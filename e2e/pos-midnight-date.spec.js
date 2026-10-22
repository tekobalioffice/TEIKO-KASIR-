import { test, expect } from './fixtures.js';
import { supa, TEST_OUTLET, seedOutlet } from './lib/supa.js';
import { reportIds, newReportId, reportById, fillSisa, closeShift } from './lib/shift.js';

/**
 * Staf buka shift lewat tengah malam (00.30, sebelum 08.00) sementara kemarin shift
 * dibuka tapi tak pernah ditutup → laporan HARUS masuk tanggal KEMARIN, bukan tanggal HP.
 * (Bug PDK 18→19 Okt 2026.) Jam browser dipalsukan; tanggal unik jauh di masa depan.
 */
test.use({ storageState: 'e2e/.auth/branch.json' });

const TZ_OFFSET_H = 8; // Asia/Makassar
// Tanggal NYATA (WITA), bukan masa depan: JWT Supabase dianggap kedaluwarsa kalau jam
// dipalsukan jauh. Outlet test sdk tak punya laporan di tanggal-tanggal ini.
const day = new Date(new Date(Date.now() + TZ_OFFSET_H * 36e5).toISOString().split('T')[0] + 'T00:00:00Z');
const plusDays = (d, n) => new Date(d.getTime() + n * 864e5).toISOString().split('T')[0];
const TODAY = plusDays(day, 0);
const YESTERDAY = plusDays(day, -1);
let logId;

test.skip(!process.env.E2E_BRANCH_USER, 'butuh E2E_BRANCH_USER/PASS (staf outlet test)');

test.beforeEach(async () => {
  await seedOutlet(TEST_OUTLET);
  // kemarin: shift dibuka (12.00 WITA) tapi tak pernah ditutup
  const { data, error } = await supa.from('stock_restock_log').insert([{
    branch_name: TEST_OUTLET, item_name: 'Status Aktivitas', qty_added: 0, qty_before: 0, qty_after: 0,
    petugas_name: 'e2e (Online - Buka Input Shift 1)',
    created_at: `${YESTERDAY}T0${12 - TZ_OFFSET_H}:00:00Z`,
  }]).select('id');
  if (error) throw error;
  logId = data[0].id;
});

test.afterEach(async () => {
  if (logId) await supa.from('stock_restock_log').delete().eq('id', logId);
  await supa.from('sales_reports').delete().eq('branch_name', TEST_OUTLET).in('date', [YESTERDAY, TODAY]);
});

test('staf buka 00.30 → laporan masuk tanggal kemarin', async ({ page, testOutlet }) => {
  test.setTimeout(300_000);
  await page.clock.install({ time: new Date(`${TODAY}T00:30:00+08:00`) });
  await page.goto('/branch/pos');

  await expect(page.getByText('Mulai Sesi Kasir')).toBeVisible({ timeout: 20_000 });
  // auto-arah ke kemarin: banner menyebut tanggal kemarin
  await expect(page.getByText(new RegExp(`tanggal ${YESTERDAY}`))).toBeVisible({ timeout: 20_000 });
  expect(await page.getByText(new RegExp(`tanggal ${TODAY}`)).count()).toBe(0);

  const before = await reportIds();
  await page.getByRole('button', { name: /Buka Kasir/i }).click();
  await expect(page.getByText('Input Laporan Shift')).toBeVisible({ timeout: 25_000 });
  const shift = (await page.getByRole('button', { name: /Tutup Shift \d/i }).first().innerText()).match(/\d/)[0];
  await fillSisa(page, 1, 40);
  await closeShift(page, shift);

  await expect.poll(async () => (await newReportId(before)) != null, { timeout: 45_000 }).toBe(true);
  const rep = await reportById(await newReportId(before));
  expect(rep.date).toBe(YESTERDAY);
});
