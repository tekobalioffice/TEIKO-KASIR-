import { test as base, expect } from '@playwright/test';
import { TEST_OUTLET, outletExists } from './lib/supa.js';

/**
 * Fixture dasar:
 *  - auto-ACC semua window.confirm/alert (app pakai native dialog banyak sekali).
 *    Teks tiap dialog di-log biar kelihatan di trace kalau ada yang aneh.
 *  - `testOutlet`: nama outlet khusus test; test gagal cepat kalau belum dibuat.
 */
export const test = base.extend({
  autoDialog: [async ({ page }, use, testInfo) => {
    const ROUTINE = /^Berhasil memindahkan|^Shift \d berhasil dibuka|^Memulihkan isian|berhasil disimpan|sedang diunduh|Barang operan telah dikirim/i;
    page.on('dialog', async (d) => {
      const msg = d.message();
      // cuma catat dialog yang tidak rutin (biar output tidak kebanjiran)
      if (!ROUTINE.test(msg)) testInfo.annotations.push({ type: `dialog:${d.type()}`, description: msg.slice(0, 200) });
      try { await d.accept(); } catch { /* sudah ke-handle */ }
    });
    await use(undefined);
  }, { auto: true }],

  testOutlet: async ({}, use) => {
    if (!(await outletExists(TEST_OUTLET))) {
      throw new Error(
        `Outlet test "${TEST_OUTLET}" belum ada di DB. Buat lewat Admin > Cabang ` +
        `atau set E2E_TEST_OUTLET ke outlet test yang sudah ada.`
      );
    }
    await use(TEST_OUTLET);
  },
});

export { expect };
