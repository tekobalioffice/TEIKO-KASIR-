import { test, expect } from './fixtures.js';
import { supa, TEST_OUTLET, seedOutlet, inventorySnapshot } from './lib/supa.js';
import { openShift } from './lib/drawer.js';
import { reportIds, reportById, newReportId, fillSisa, closeShift, num, detailKey, realRows } from './lib/shift.js';

//
import { read as xlsxRead, utils as xlsxUtils } from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Audit integritas: tutup 1 shift lalu cek —
 *  A. balance baris laporan: Awal + Tambah + Pindah − Jual = Sisa
 *  B. log Auto-Deduct: total potong = total terjual per item
 *  C. Excel FORM STOK: angka tiap baris balance sendiri
 *
 * Bahan penggerak auto-calc (Gula Milk Tea / Black Tea) di-kecualikan dari cek
 * stok — driftnya sudah dicatat sebagai temuan F1.
 */
test.describe.configure({ mode: 'serial' });

const DRIVER = /^(Gula Milk Tea|Black Tea)\b/;
// is_unlimited: tak punya stok display asli (Awal & Sisa default), jadi tak ikut cek balance stok.
const UNLIMITED = /^(Es Teh|Teh Tarik|Full Cream|Milk Tea)\b/;
// Sebelum semua report outlet: Awal Shift 1 = Sisa report hari sebelumnya, jadi tak boleh ada report lebih lama yang ikut terbaca.
let AUDIT_DATE = null;
const SELL = 2;
let repId = null;
let xlsxFile = null;
let logIdsBefore = new Set();

async function autoDeductLogs() {
  // 400 terbaru — tanpa order+limit, supabase cap 1000 baris & snapshot before/after
  // bisa beda isi (outlet uji sudah ratusan log dari run berulang).
  const { data } = await supa.from('stock_restock_log')
    .select('id, item_name, qty_added')
    .eq('branch_name', TEST_OUTLET).ilike('petugas_name', '%Auto-Deduct Shift 1%')
    .order('created_at', { ascending: false }).limit(400);
  return data || [];
}

test.beforeAll(async () => {
  if (process.env.E2E_NOSEED !== '1') await seedOutlet(TEST_OUTLET);
  const { data } = await supa.from('sales_reports').select('date').eq('branch_name', TEST_OUTLET).order('date').limit(1);
  const first = new Date(`${data?.[0]?.date ?? '2006-01-02'}T00:00:00Z`);
  AUDIT_DATE = new Date(first.getTime() - 864e5).toISOString().split('T')[0];
});

test('tutup shift + unduh Excel (fixture untuk audit)', async ({ page, testOutlet }) => {
  test.setTimeout(200_000);
  const before = await reportIds();
  await openShift(page, testOutlet, '1', AUDIT_DATE);
  await fillSisa(page, SELL);

  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByRole('button', { name: /Cek Laporan/i }).click(),
  ]);
  xlsxFile = path.join('test-results', `audit-${Date.now()}.xlsx`);
  await dl.saveAs(xlsxFile);

  await fillSisa(page, SELL); // ulangi isian (state form tetap, tapi aman)
  logIdsBefore = new Set((await autoDeductLogs()).map((l) => l.id));
  await closeShift(page, 1);
  await expect.poll(async () => (await newReportId(before)) != null, { timeout: 45_000 }).toBe(true);
  repId = await newReportId(before);
  expect(repId).toBeTruthy();

  // Tunggu Promise.all(stockJobs) di processSubmit selesai — insert log Auto-Deduct
  // async setelah report tersimpan. Tanpa ini test B balapan & lihat 0.
  await expect.poll(async () => (await autoDeductLogs()).filter((l) => !logIdsBefore.has(l.id)).length, { timeout: 30_000 })
    .toBeGreaterThan(50);
});

test('A. balance baris laporan: Awal + Tambah + Pindah − Jual = Sisa', async () => {
  test.skip(!repId, 'butuh report');
  const rep = await reportById(repId);
  const bad = [];
  let checked = 0;
  for (const d of realRows(rep)) {
    if (DRIVER.test(detailKey(d)) || UNLIMITED.test(detailKey(d))) continue;
    const awal = num(d.display_awal), tambah = num(d.tambah), pindah = num(d.pindah_display);
    const jual = num(d.qty ?? d.terjual_fisik), sisa = num(d.sisa_input ?? d.sisa);
    // baris tanpa dimensi stok (auto-calc / sales-only) — lewati
    if (awal === 0 && tambah === 0 && pindah === 0 && sisa === 0) continue;
    checked++;
    const lhs = awal + tambah + pindah - jual;
    if (Math.abs(lhs - sisa) > 0.02)
      bad.push(`${detailKey(d)}: ${awal}+${tambah}+${pindah}−${jual} = ${lhs.toFixed(2)} ≠ sisa ${sisa}`);
  }
  test.info().annotations.push({ type: 'balance', description: `dicek ${checked}, tidak balance ${bad.length}` });
  expect(checked).toBeGreaterThan(20);
  expect(bad, bad.slice(0, 20).join(' | ')).toEqual([]);
});

test('B. log Auto-Deduct = total terjual per item', async () => {
  test.skip(!repId, 'butuh report');
  const rep = await reportById(repId);
  const inv = await inventorySnapshot(TEST_OUTLET); // menu auto-calc (Milk Tea, dst) tak ada di sini
  const deducted = {};
  for (const l of await autoDeductLogs()) {
    if (logIdsBefore.has(l.id)) continue; // hanya log yang lahir dari close di test ini
    deducted[l.item_name] = (deducted[l.item_name] || 0) + Math.abs(num(l.qty_added));
  }

  const mism = [];
  let checked = 0;
  for (const d of realRows(rep)) {
    if (DRIVER.test(detailKey(d))) continue;
    const k = detailKey(d);
    // menu auto-calc (Milk Tea, Teh Tarik, Matcha Oat Latte, ...) tak punya baris
    // di branch_inventory — potongannya di bahan baku. Lewati.
    if (!(inv[k] ?? inv[d.name])) continue;
    const sold = num(d.terjual_fisik ?? d.qty);
    if (sold <= 0) continue;
    checked++;
    const got = deducted[detailKey(d)] ?? deducted[d.name] ?? 0;
    if (Math.abs(got - sold) > 0.02) mism.push(`${detailKey(d)}: terjual ${sold}, log potong ${got}`);
  }
  test.info().annotations.push({ type: 'auto-deduct', description: `dicek ${checked}, selisih ${mism.length}` });
  expect(checked).toBeGreaterThan(10);
  expect(mism, mism.slice(0, 20).join(' | ')).toEqual([]);
});

test('C. Excel FORM STOK — tiap baris: Awal + Tambah − Penjualan = Sisa', async () => {
  test.skip(!xlsxFile || !fs.existsSync(xlsxFile), 'butuh Excel');
  const wb = xlsxRead(fs.readFileSync(xlsxFile));
  const sheetName = wb.SheetNames.find((s) => /stok|kartu/i.test(s)) || wb.SheetNames[0];
  const rows = xlsxUtils.sheet_to_json(wb.Sheets[sheetName], { header: 1, blankrows: false });

  // header "Awal/Tambah/Penjualan/Sisa" ada di salah satu baris atas
  const hdrIdx = rows.findIndex((r) => r.join('|').toLowerCase().includes('penjualan') && r.join('|').toLowerCase().includes('sisa'));
  expect(hdrIdx, 'header FORM STOK ketemu').toBeGreaterThan(-1);

  const N = (v) => { const n = parseFloat(String(v).replace(',', '.').replace(/[^\d.\-/]/g, '')); return Number.isFinite(n) ? n : null; };
  const bad = [];
  let checked = 0;
  for (let i = hdrIdx + 2; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[1] || /jumlah|total|keterangan/i.test(String(r[1]))) continue;
    // shift 1: kolom (0-idx) 2..3 Awal, 4..5 Tambah, 6..7 Penjualan, 8..9 Sisa
    const awal = (N(r[2]) ?? 0) + (N(r[3]) ?? 0);
    const tambah = (N(r[4]) ?? 0) + (N(r[5]) ?? 0);
    const jual = (N(r[6]) ?? 0) + (N(r[7]) ?? 0);
    const sisa = (N(r[8]) ?? 0) + (N(r[9]) ?? 0);
    if (awal === 0 && tambah === 0 && jual === 0 && sisa === 0) continue;
    checked++;
    if (Math.abs(awal + tambah - jual - sisa) > 0.6) // toleransi longgar: item box-porsi ditransform
      bad.push(`${r[1]}: ${awal}+${tambah}−${jual} vs sisa ${sisa}`);
  }
  test.info().annotations.push({ type: 'excel-balance', description: `sheet "${sheetName}" · dicek ${checked} · tak balance ${bad.length}` });
  expect(checked).toBeGreaterThan(15);
  // ≥ 80% baris harus balance (sisanya item box-porsi yg kolom Penjualan-nya ditransform ke porsi)
  expect(bad.length, bad.slice(0, 25).join(' | ')).toBeLessThan(checked * 0.2);

  fs.rmSync(xlsxFile, { force: true });
});
