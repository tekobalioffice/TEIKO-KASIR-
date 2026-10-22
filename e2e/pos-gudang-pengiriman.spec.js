import { test, expect } from './fixtures.js';
import { supa, TEST_OUTLET } from './lib/supa.js';

/**
 * Mode Pengiriman dari sisi GUDANG (role "gudang", akun E2E_GUDANG_USER).
 * Gudang isi kolom "Kirim" per item di /gudang/inventory → Simpan → app bikin
 * baris `pending_stock_actions` (action_type pengiriman_display / pengiriman_gudang,
 * status pending) untuk outlet tujuan. branch_inventory outlet BELUM disentuh —
 * nunggu outlet klik Terima/Tolak (sisi ACC dicakup pos-pengiriman.spec.js).
 */
const GUDANG_STATE = 'e2e/.auth/gudang.json';
// Gate ke env var, BUKAN fs.existsSync — spec di-parse sebelum project `setup`
// jalan & bikin file-nya. Kalau env-nya ada, auth.setup pasti sudah nulis file.
const HAS = !!(process.env.E2E_GUDANG_USER && process.env.E2E_GUDANG_PASS);

const ITEM = 'Kresek';
const QTY = 5;

async function cleanup() {
  await supa.from('pending_stock_actions').delete()
    .eq('target_branch', TEST_OUTLET).eq('item_name', ITEM).ilike('action_type', 'pengiriman%');
}

async function outletStock() {
  const { data } = await supa.from('branch_inventory')
    .select('current_qty, display_qty, safety_qty, tambah_qty')
    .eq('branch_name', TEST_OUTLET).eq('item_name', ITEM).maybeSingle();
  return data;
}

test.describe('Gudang — Mode Pengiriman', () => {
  test.skip(!HAS, 'butuh akun gudang: isi E2E_GUDANG_USER / E2E_GUDANG_PASS di .env.test.local');
  test.use({ storageState: GUDANG_STATE });

  test.beforeAll(cleanup);
  test.afterAll(cleanup);

  test('Kirim stok → pending_stock_actions dibuat, stok outlet belum berubah', async ({ page }) => {
    test.setTimeout(120_000);
    const before = await outletStock();

    await page.goto('/gudang/inventory');
    // Mode Pengiriman = default untuk role gudang.
    await expect(page.getByRole('button', { name: /Mode Pengiriman/i })).toBeVisible({ timeout: 15_000 });

    // Pilih outlet tujuan (select yang punya <option value="sdk">).
    const branchSel = page.locator('select')
      .filter({ has: page.locator(`option[value="${TEST_OUTLET}"]`) }).first();
    await branchSel.selectOption(TEST_OUTLET);

    // Filter ke 1 item supaya input "Kirim" tidak ambigu.
    await page.getByPlaceholder(/Cari nama menu atau bahan/i).fill(ITEM);
    const kirim = page.locator('input[inputmode="decimal"]').first();
    await expect(kirim).toBeVisible({ timeout: 10_000 });
    await kirim.fill(String(QTY));

    await page.getByRole('button', { name: /Simpan Perubahan/i }).click();
    // alert "Kiriman terkirim, menunggu konfirmasi…" → auto-accept (fixtures.js)

    const latestPending = async () => {
      const { data } = await supa.from('pending_stock_actions')
        .select('qty, status, action_type, created_by')
        .eq('target_branch', TEST_OUTLET).eq('item_name', ITEM).ilike('action_type', 'pengiriman%')
        .order('created_at', { ascending: false }).limit(1);
      return data?.[0] ?? null;
    };
    await expect.poll(latestPending, { timeout: 25_000 })
      .toMatchObject({ qty: QTY, status: 'pending' });

    const row = await latestPending();
    expect(row.action_type).toMatch(/^pengiriman_(display|gudang)$/);
    expect(String(row.created_by)).toContain(process.env.E2E_GUDANG_USER);

    // Stok outlet TIDAK berubah — kiriman masih pending ACC.
    const after = await outletStock();
    if (before && after) {
      expect(after.current_qty).toBeCloseTo(before.current_qty ?? 0, 3);
      expect(after.display_qty ?? 0).toBeCloseTo(before.display_qty ?? 0, 3);
      expect(after.safety_qty ?? 0).toBeCloseTo(before.safety_qty ?? 0, 3);
      expect(after.tambah_qty ?? 0).toBeCloseTo(before.tambah_qty ?? 0, 3);
    }
  });
});
