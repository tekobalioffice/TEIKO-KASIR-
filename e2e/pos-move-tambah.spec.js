import { test, expect } from './fixtures.js';
import { supa, TEST_OUTLET } from './lib/supa.js';

/**
 * Cek Pengiriman: Pindah Tambah S1<->S2 + Kembalikan. Data sendiri (laporan S1/S2
 * tanggal unik di outlet test + 1 kiriman approved) -> tak menyentuh data asli.
 */
const D = new Date(Date.UTC(2045, 0, 1) + (Math.floor(Date.now() / 1000) % 4000) * 864e5).toISOString().split('T')[0];
const ITEM = 'E2E Cao Jelly';
const row = (o) => ({ name: ITEM, variant: 'Standar', price: 2000, ...o });
// Kiriman 15 datang di S1 tapi baru di-ACC di S2 -> S1: 10+0-10 != 4 (tak match), S2: 4+15-4 != 0 (tak match)
const S1 = row({ display_awal: 10, tambah: 0, sisa_input: 4, sisa: 4, total_fisik: 21, qty: 21, masuk_net: 10 });
const S2 = row({ display_awal: 4, tambah: 15, sisa_input: 0, sisa: 0, total_fisik: 4, qty: 4, masuk_net: 19 });
const bal = (d) => d.display_awal + d.tambah - d.total_fisik - d.sisa_input; // 0 = match

let s1Id, s2Id, actId;
const rep = async (id) => (await supa.from('sales_reports').select('details,total_revenue').eq('id', id).single()).data;
const det = (r) => r.details.find((d) => d.name === ITEM);
const tambah = async () => [det(await rep(s1Id)).tambah, det(await rep(s2Id)).tambah];

test.beforeAll(async () => {
  // sisa run gagal sebelumnya
  await supa.from('sales_reports').delete().eq('branch_name', TEST_OUTLET).eq('date', D);
  const base = { branch_name: TEST_OUTLET, date: D, total_revenue: 0, cash_akhir: 0 };
  const a = await supa.from('sales_reports').insert({ ...base, shift: '1', details: [S1] }).select().single();
  const b = await supa.from('sales_reports').insert({ ...base, shift: '2', details: [S2] }).select().single();
  if (a.error || b.error) throw a.error || b.error;
  s1Id = a.data.id; s2Id = b.data.id;
  // anon key tak bisa DELETE pending_stock_actions (RLS) -> pakai ulang kiriman e2e lama, jangan numpuk baris
  const old = await supa.from('pending_stock_actions').select('id').eq('created_by', 'e2e').eq('item_name', ITEM)
    .eq('status', 'approved').order('created_at', { ascending: false }).limit(1);
  let k = old.data?.[0] ? { data: old.data[0] } : await supa.from('pending_stock_actions').insert({
    action_type: 'pengiriman_display', item_name: ITEM, qty: 15, source_branch: 'GUDANG (e2e)',
    target_branch: TEST_OUTLET, created_by: 'e2e', status: 'approved', note: 'Di-ACC e2e',
  }).select().single();
  if (k.error) throw k.error;
  await supa.from('pending_stock_actions').update({ note: 'Di-ACC e2e', created_at: new Date().toISOString() }).eq('id', k.data.id);
  actId = k.data.id;
});
test.afterAll(async () => {
  await supa.from('sales_reports').delete().in('id', [s1Id, s2Id].filter(Boolean));
});

async function openCard(page) {
  await page.addInitScript(([b, d]) => {
    localStorage.setItem('cekPengiriman_start', d); localStorage.setItem('cekPengiriman_end', d);
  }, [TEST_OUTLET, new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0]]);
  await page.goto('/admin/cek-pengiriman');
  await page.getByRole('button', { name: /Tampilkan Riwayat/ }).click();
  await page.getByText(TEST_OUTLET, { exact: true }).filter({ visible: true }).first().click(); // buka grup outlet test
  const card = () => page.locator('div').filter({ hasText: `15 unit — ${ITEM}` }).filter({ has: page.getByRole('button', { name: /Batalkan/ }) }).last();
  const dateIn = () => card().locator('input[type="date"]');
  const go = async (name) => {
    if (await dateIn().count()) await dateIn().fill(D);
    const dl = page.waitForEvent('download', { timeout: 30_000 }).catch(() => null);
    await card().getByRole('button', { name }).click();
    await dl;
  };
  return go;
}

test.describe.configure({ mode: 'serial' });

test('Pindah Tambah ke Shift 1 / Kembalikan / ke Shift 2 / Kembalikan', async ({ page }) => {
  test.setTimeout(120_000);
  const go = await openCard(page);
  const card = () => page.locator('div').filter({ hasText: `15 unit — ${ITEM}` }).filter({ has: page.getByRole('button', { name: /Batalkan/ }) }).last();

  // sebelum: dua-duanya tak match
  expect([bal(det(await rep(s1Id))), bal(det(await rep(s2Id)))]).toEqual([-15, 15]);

  // S2 -> S1: cuma Tambah yang geser, Sisa/Awal/Jual tetap, dua baris jadi match
  await go(/Pindah Tambah ke Shift 1/);
  await expect.poll(tambah, { timeout: 20_000 }).toEqual([15, 0]);
  const d1 = det(await rep(s1Id)), d2 = det(await rep(s2Id));
  expect(d1).toMatchObject({ display_awal: 10, tambah: 15, total_fisik: 21, sisa_input: 4 });
  expect(d2).toMatchObject({ display_awal: 4, tambah: 0, total_fisik: 4, sisa_input: 0 });
  expect([bal(d1), bal(d2)]).toEqual([0, 0]);
  await expect(card().getByRole('button', { name: /Kembalikan Tambah ke Shift 2/ })).toBeVisible();

  // undo -> persis kondisi awal
  await go(/Kembalikan Tambah ke Shift 2/);
  await expect.poll(tambah, { timeout: 20_000 }).toEqual([0, 15]);
  expect(det(await rep(s1Id))).toMatchObject({ sisa_input: 4, tambah: 0, display_awal: 10 });
  expect(det(await rep(s2Id))).toMatchObject({ display_awal: 4, tambah: 15, sisa_input: 0 });

  // arah lama masih jalan: S1 -> S2 butuh Tambah S1 >= 15, jadi harus ditolak (alert), data tak berubah
  await go(/Pindah Tambah ke Shift 2/);
  expect(await tambah()).toEqual([0, 15]);
});

test('Pindah Tambah ke Shift 2 (Jual + omzet ikut pindah) / Kembalikan', async ({ page }) => {
  test.setTimeout(120_000);
  // kiriman 15 nyangkut di Tambah S1, 11 unit sudah kejual sebelum Tutup Shift 1 (Sisa S1 4 < 15)
  const o1 = row({ display_awal: 10, tambah: 15, sisa_input: 4, sisa: 4, total_fisik: 21, qty: 21, masuk_net: 25 });
  const o2 = row({ display_awal: 4, tambah: 0, sisa_input: 0, sisa: 0, total_fisik: 4, qty: 4, masuk_net: 4 });
  const u1 = await supa.from('sales_reports').update({ details: [o1], total_revenue: 42000, cash_akhir: 42000 }).eq('id', s1Id);
  const u2 = await supa.from('sales_reports').update({ details: [o2], total_revenue: 8000, cash_akhir: 8000 }).eq('id', s2Id);
  expect(u1.error || u2.error).toBeFalsy();
  const go = await openCard(page);

  await go(/Pindah Tambah ke Shift 2/);
  await expect.poll(tambah, { timeout: 20_000 }).toEqual([0, 15]);
  const [r1, r2] = [await rep(s1Id), await rep(s2Id)];
  expect(det(r1)).toMatchObject({ tambah: 0, sisa_input: 0, total_fisik: 10 }); // 10+0-10=0
  expect(det(r2)).toMatchObject({ display_awal: 0, tambah: 15, sisa_input: 0, total_fisik: 15 }); // 0+15-15=0
  expect([r1.total_revenue, r2.total_revenue]).toEqual([20000, 30000]); // 11 x 2000 pindah, total tetap 50000

  await go(/Kembalikan Tambah ke Shift 1/);
  await expect.poll(tambah, { timeout: 20_000 }).toEqual([15, 0]);
  const [q1, q2] = [await rep(s1Id), await rep(s2Id)];
  expect(det(q1)).toMatchObject({ tambah: 15, sisa_input: 4, total_fisik: 21 });
  expect(det(q2)).toMatchObject({ display_awal: 4, tambah: 0, sisa_input: 0, total_fisik: 4 });
  expect([q1.total_revenue, q2.total_revenue]).toEqual([42000, 8000]);
});
