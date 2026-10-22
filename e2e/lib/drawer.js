import { expect } from '@playwright/test';

/**
 * Helper UI untuk BranchPOS + BranchStockDrawer.
 * App belum punya data-testid; selector diturunkan dari teks / title / struktur.
 */

export const MODE = {
  toDisplay: { pill: 'Ke Display', title: 'Pindah ke Display', h: 'Pindah ke Display' },
  toStok:    { pill: 'Ke Stok',    title: 'Pindah ke Stok',    h: 'Pindah ke Stok' },
  oper:      { pill: 'Oper',       title: 'Oper Stok ke Cabang Lain', h: 'Oper Stok' },
  kurasi:    { pill: 'Kurasi',     title: 'Kurasi/Kurangi Stok', h: 'Kurasi Stok' },
  tambah:    { pill: 'Tambah',     title: 'Tambah Stok',       h: 'Tambah Stok' },
};

export async function openShift(page, outlet, shift = '1', date = null) {
  await page.goto('/admin/pos');
  if (await page.getByText('Input Laporan Shift').isVisible().catch(() => false)) {
    if (!date) {
      const chip = page.locator('.glass-panel').getByText(outlet, { exact: true });
      if (await chip.isVisible().catch(() => false)) return;
    }
    await page.getByRole('button', { name: 'Ganti Cabang' }).click();
  }
  await expect(page.getByText('Mulai Sesi Kasir')).toBeVisible({ timeout: 15_000 });
  const cabang = page.locator('select').first();
  // option value = nama outlet bersih; label bisa ada " • draft S1" → pilih by value.
  await expect(cabang.locator(`option[value="${outlet}"]`)).toHaveCount(1, { timeout: 15_000 });
  await cabang.selectOption(outlet);
  if (date) await page.locator('input[type="date"]').fill(date); // khusus admin
  // Pilih cabang/tanggal men-trigger fetch (inventory + checkExistingShifts). Saat
  // hasilnya balik, layar "Mulai Sesi Kasir" re-render → <select> & tombol sempat
  // detach. Tunggu tenang dulu, lalu retry aksi yang kena race.
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await expect.poll(async () => {
    try {
      const sel = page.locator('select').last();
      await sel.selectOption(shift, { timeout: 2_000 });
      return await sel.inputValue();
    } catch { return null; }
  }, { timeout: 20_000 }).toBe(shift);
  // Klik "Buka Kasir": layar transisi ke input screen di tengah klik (tombol detach)
  // → jangan gantung nunggu post-click; verifikasi lewat munculnya layar input.
  await page.getByRole('button', { name: /Buka Kasir/i }).click({ timeout: 10_000 }).catch(() => {});
  await expect(page.getByText('Input Laporan Shift')).toBeVisible({ timeout: 25_000 });
}

export async function openDrawer(page) {
  // tombol "Stok" di header (bukan tombol "Stok" toggle di banner kiriman).
  await page.locator('.page-title').getByRole('button', { name: 'Stok', exact: true }).click();
  await expect(page.getByText('Stok Inventaris')).toBeVisible();
  await settle(page);
}

/**
 * Drawer sering re-fetch (livePorsiSisa di dep useEffect) → loading=true bikin
 * mode-bar + daftar item unmount sebentar. Tunggu sampai tenang.
 */
export async function settle(page) {
  await expect(page.getByRole('button', { name: 'Ke Display' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Memuat...')).toHaveCount(0, { timeout: 10_000 });
}

/** Baris item = div yang memuat nama (persis) DAN tombol aksi mode aktif. */
function row(page, name, title) {
  return page
    .locator('div')
    .filter({ has: page.getByText(name, { exact: true }) })
    .filter({ has: page.getByTitle(title) })
    .last();
}

export async function setMode(page, mode) {
  await settle(page);
  // pill mode ada di baris kontrol di atas daftar item (bukan tombol per-baris).
  const bar = page.getByRole('button', { name: 'Ke Display' }).locator('..');
  await bar.getByRole('button', { name: MODE[mode].pill, exact: true }).click();
  // tunggu baris re-render dgn tombol aksi mode ini (title mode ATAU title "kosong")
  const t = MODE[mode].title;
  const empty = { toDisplay: 'Safety Stok Kosong', toStok: 'Display Stok Kosong' }[mode];
  await expect
    .poll(async () =>
      (await page.getByTitle(t).count()) + (empty ? await page.getByTitle(empty).count() : 0),
    { timeout: 10_000 })
    .toBeGreaterThan(0);
}

async function submit(page, qty, dest) {
  // input modal = satu-satunya dgn placeholder "boleh 0.5"; input .pos-stock-input halaman utama juga inputmode=decimal
  const qtyInput = page.getByPlaceholder(/boleh 0\.5/);
  const modal = page.locator('form').filter({ has: qtyInput });
  if (dest) await modal.locator('select').selectOption({ label: dest });
  await qtyInput.fill(String(qty));
  await modal.getByRole('button', { name: 'Simpan' }).click();
  await expect(qtyInput).toHaveCount(0, { timeout: 15_000 });
  // tunggu re-fetch drawer (loading flicker) beres sebelum lanjut item berikutnya
  await settle(page);
}

/**
 * Aksi satu item — mode HARUS sudah di-set (setMode) sebelum loop.
 * @returns 'done' | 'skip-disabled' | 'skip-absent'
 */
export async function rowAction(page, mode, name, { qty = 1, dest } = {}) {
  const m = MODE[mode];
  const r = row(page, name, m.title);
  if ((await r.count()) === 0) return 'skip-absent';
  const btn = r.getByTitle(m.title);
  if (await btn.isDisabled().catch(() => true)) return 'skip-disabled';
  await btn.click();
  await submit(page, qty, dest);
  return 'done';
}

/** Set mode lalu aksi — buat probe / one-off. */
export async function doAction(page, mode, name, opts = {}) {
  await setMode(page, mode);
  return rowAction(page, mode, name, opts);
}
