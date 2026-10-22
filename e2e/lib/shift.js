import { expect } from '@playwright/test';
import { supa, TEST_OUTLET } from './supa.js';

/**
 * Tanggal (hampir pasti) unik per proses: epoch-detik + jitter acak → offset hari
 * dari 2006-01-01. Supaya Tutup Shift selalu "fresh": tak ada report sebelumnya
 * utk date+shift ini → tak masuk jalur "Buka Ulang Shift" yang me-restore stok &
 * bikin log Auto-Deduct dobel (lihat temuan F6).
 */
export const RUN_DATE = new Date(
  Date.UTC(2006, 0, 1)
  + ((Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 86400)) % 6000) * 864e5,
).toISOString().split('T')[0];

export async function reportIds() {
  const { data } = await supa.from('sales_reports').select('id').eq('branch_name', TEST_OUTLET);
  return new Set((data || []).map((r) => r.id));
}

export async function reportById(id) {
  const { data } = await supa.from('sales_reports')
    .select('id, date, shift, details, total_revenue').eq('id', id).single();
  return data;
}

/** id report baru (yang belum ada di `before`). */
export async function newReportId(before) {
  return [...(await reportIds())].find((id) => !before.has(id)) || null;
}

/**
 * Isi Sisa per item: jual `sell` unit (Sisa = Awal − sell) utk item dgn Awal ≥ 1.
 * Terjual > 0 tapi stok tak habis → kontinuitas shift berikutnya tetap bermakna.
 */
export async function fillSisa(page, sell = 1, max = Infinity) {
  const inputs = page.locator('.pos-stock-input[data-col="qty"]');
  await expect(inputs.first()).toBeVisible({ timeout: 20_000 });
  const phs = await inputs.evaluateAll((els) => els.map((e) => e.getAttribute('placeholder') || ''));
  let filled = 0;
  for (let i = 0; i < phs.length && filled < max; i++) {
    const ph = parseFloat(String(phs[i]).replace(/[^\d.]/g, '')) || 0;
    if (ph < 1) continue;
    await inputs.nth(i).fill(String(Math.max(0, Math.floor(ph) - sell)));
    filled++;
  }
  await expect(page.getByRole('button', { name: /Tutup Shift/i })).toBeEnabled({ timeout: 10_000 });
  return filled;
}

export async function closeShift(page, shift, setoran = '0') {
  await page.getByRole('button', { name: new RegExp(`Tutup Shift ${shift}`, 'i') }).click();
  await expect(page.getByText(/Konfirmasi Setoran/i)).toBeVisible({ timeout: 20_000 });
  await page.getByPlaceholder('0').last().fill(setoran);
  await page.getByRole('button', { name: /Simpan Final/i }).click();
  // TUNGGU app benar-benar selesai: simpan laporan + potong stok + Excel + reset
  // form → balik ke layar "Mulai Sesi Kasir". Kalau tidak, test berikutnya (mis.
  // openShift Shift 2) ketemu shift lama masih "aktif" & bikin selector meleset.
  await expect(page.getByText(/Konfirmasi Setoran/i)).toBeHidden({ timeout: 60_000 });
  await expect(page.getByText('Mulai Sesi Kasir')).toBeVisible({ timeout: 60_000 });
}

export const num = (v) => (v == null || v === '' ? 0 : Number(v));
export const detailKey = (d) => (d.variant && d.variant !== 'Standar' ? `${d.name} ${d.variant}` : d.name);
export const realRows = (rep) => (rep.details || []).filter((d) => d.name && !d._is_meta && !d._is_inventory_snapshot && !d._is_preclose_snapshot);
