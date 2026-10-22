import { test, expect } from './fixtures.js';
import { supa } from './lib/supa.js';
import { openShift } from './lib/drawer.js';
import { fillSisa, closeShift } from './lib/shift.js';

/**
 * ============================================================================
 * SEED BRANCH "testing" — riwayat penjualan 1-16 Sept 2026
 * ============================================================================
 * One-off data-seed (bukan regression test rutin). Bikin cabang "testing",
 * isi stok awal 5 display / 5 safety per item (disalin dari cabang "CS" biar
 * daftar item persis sama seperti cabang asli — hindari item hilang / bug
 * stockKey mapping), lalu tutup Shift 1 & Shift 2 SUNGGUHAN lewat UI admin
 * (bukan insert SQL langsung) untuk tiap tanggal 1-16 Sept — 1 unit terjual
 * per produk per shift.
 *
 * 4 produk (Es Teh, Teh Tarik, Full Cream, Milk Tea) adalah is_unlimited:
 * "Terjual"-nya BUKAN dari Sisa sendiri, tapi diturunkan otomatis dari
 * konsumsi bahan baku lain (lihat getProductSoldQty di BranchPOS.jsx):
 *   - Milk Tea      = Gula Milk Tea (Ori/Premi) terjual
 *   - Teh Tarik     = Black Tea terjual − Gula Milk Tea terjual
 *   - Full Cream Ori= round(Diamond Besar terjual × 5) − Coffee Cream terjual
 *   - Full Cream Premi = round(Ultra Milk Besar terjual × 4)
 *   - Es Teh        = total Cup terjual − semua minuman lain (CUP_SUBTRACTOR_DRINKS) terjual
 * fillSisa(sell=1) seragam bikin 3 dari 4 itu SALAH (Teh Tarik jadi 0, Full
 * Cream jadi 4, Es Teh jadi 0) karena baru menjamin bahan baku −1, bukan hasil
 * rumus = 1. `sellOnePerProduct()` di bawah menghitung & menimpa baris bahan
 * baku pemicu (Black Tea, Diamond Besar, Ultra Milk Besar, Paper Cup, Cup
 * (Flat) Premi) supaya rumusnya balik ke tepat 1, lalu VERIFIKASI angka
 * "Terjual (Auto)" yang benar-benar dirender sebelum Tutup Shift — kalau
 * meleset, test gagal keras (bukan nyimpen data salah diam-diam).
 * ============================================================================
 */

const BRANCH = 'testing';
const DISPLAY = 5;
const SAFETY = 5;
const SOURCE_BRANCH = 'CS'; // template daftar item

// Paper Cup & Cup (Flat) Premi = pool bersama SEMUA minuman (Es Teh = totalCup − minuman
// lain terjual, lihat sellOnePerProduct). Dengan ~20-25 minuman lain per bucket, 5 unit
// (baseline) jauh kurang — butuh headroom gede biar Sisa tak pernah minus.
const RESTOCK_OVERRIDE = { 'Paper Cup': 80, 'Cup (Flat) Premi': 80 };

const DATES = Array.from({ length: 16 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
const SHIFTS = ['1', '2'];

// ── DOM helpers: cari baris "Form Stok Outlet" by nama item (+ varian) ─────
// Struktur (BranchPOS.jsx ~3190-3260): group div (border) > [header div fontWeight
// 700 berisi nomor+nama item, lalu N variant-row div berisi input .pos-stock-input].
async function getRowInfo(page, itemName, variant /* 'Ori'|'Premi'|null */) {
  return page.evaluate(({ itemName, variant }) => {
    const inputs = Array.from(document.querySelectorAll('.pos-stock-input[data-col="qty"]'));
    for (let idx = 0; idx < inputs.length; idx++) {
      let node = inputs[idx];
      let rowDiv = null;
      let group = null;
      for (let i = 0; i < 12 && node; i++) {
        node = node.parentElement;
        if (node && node.parentElement) {
          const parent = node.parentElement;
          const header = parent.firstElementChild;
          if (header && header !== node && header.style && header.style.fontWeight === '700') {
            rowDiv = node; group = parent; break;
          }
        }
      }
      if (!group) continue;
      const gName = group.firstElementChild.textContent || '';
      if (!gName.includes(itemName)) continue;
      if (variant) {
        const rowText = rowDiv.textContent || '';
        const hasPremi = /Premi/.test(rowText);
        const hasOri = /\bOri\b/.test(rowText);
        const rowVariant = hasPremi ? 'Premi' : (hasOri ? 'Ori' : null);
        if (rowVariant !== variant) continue;
      }
      return { idx, rowText: rowDiv.textContent || '', placeholder: inputs[idx].getAttribute('placeholder') || '' };
    }
    return null;
  }, { itemName, variant });
}

const parseAuto = (rowText) => {
  const m = rowText.match(/([\d.]+)\s*Terjual/);
  return m ? parseFloat(m[1]) : null;
};
// "(Total 2 Cup - 23 Minuman Lain)" → { totalCup, minumanLain }. Dipakai buat Es Teh:
// nilai "Terjual" sendiri bisa ke-CLAMP di 0 (max(0, totalCup-minumanLain)) kalau minus —
// breakdown mentah ini yang jadi sumber kebenaran buat hitung delta, bukan angka clamped.
const parseEsTehBreakdown = (rowText) => {
  const m = rowText.match(/Total\s+([\d.]+)\s*Cup\s*-\s*([\d.]+)\s*Minuman Lain/);
  return m ? { totalCup: parseFloat(m[1]), minumanLain: parseFloat(m[2]) } : null;
};
const parseAwal = (placeholder) => parseFloat(String(placeholder).replace(/[^\d.]/g, '')) || 0;

async function setSisaAtIndex(page, idx, value) {
  await page.locator('.pos-stock-input[data-col="qty"]').nth(idx).fill(String(value));
}

async function setSisaByName(page, itemName, variant, value) {
  const info = await getRowInfo(page, itemName, variant);
  if (!info) throw new Error(`Baris tidak ketemu: ${itemName} ${variant || ''}`);
  await setSisaAtIndex(page, info.idx, value);
  return info;
}

/**
 * Isi Sisa semua item = jual 1 unit per produk, TERMASUK 4 produk Auto-hitung.
 * Return jumlah baris manual yang ke-isi (dari fillSisa) buat sanity check.
 */
async function sellOnePerProduct(page) {
  const filled = await fillSisa(page, 1); // baseline seragam utk ~87 baris manual

  // Teh Tarik = BlackTea − GulaMilkTea(=1). Target 1 → BlackTea harus 2.
  for (const v of ['Ori', 'Premi']) {
    const info = await getRowInfo(page, `Black Tea ${v}`, null);
    if (!info) continue; // item tak ada di cabang ini, skip
    const awal = parseAwal(info.placeholder);
    await setSisaAtIndex(page, info.idx, Math.max(0, awal - 2));
  }

  // Full Cream Ori = round(DiamondBesar×5) − CoffeeCream(=1). Target 1 → Diamond Besar = 0.4.
  {
    const info = await getRowInfo(page, 'Diamond Besar', null);
    if (info) {
      const awal = parseAwal(info.placeholder);
      await setSisaAtIndex(page, info.idx, awal - 0.4);
    }
  }
  // Full Cream Premi = round(UltraMilkBesar×4). Target 1 → Ultra Milk Besar = 0.25.
  {
    const info = await getRowInfo(page, 'Ultra Milk Besar', null);
    if (info) {
      const awal = parseAwal(info.placeholder);
      await setSisaAtIndex(page, info.idx, awal - 0.25);
    }
  }

  // Verifikasi Teh Tarik & Full Cream sebelum lanjut ke Es Teh (Es Teh butuh nilai final keduanya).
  for (const [name, variants] of [['Teh Tarik', ['Ori', 'Premi']], ['Full Cream', ['Ori', 'Premi']]]) {
    for (const v of variants) {
      const info = await getRowInfo(page, name, v);
      if (!info) continue;
      const val = parseAuto(info.rowText);
      if (val === null || Math.abs(val - 1) > 0.01) {
        throw new Error(`${name} ${v} Terjual (Auto) = ${val}, target 1 — cek formula/driver.`);
      }
    }
  }

  // Es Teh = totalCup − semua minuman lain (max(0,...) — bisa CLAMPED, jangan pakai angka
  // "Terjual" itu sendiri buat hitung delta). Pakai breakdown mentah (Total X Cup - Y Minuman
  // Lain) sbg sumber kebenaran: target totalCup = Y+1, delta = target − X. Geser lewat driver
  // cup KHUSUS per bucket (Paper Cup → Ori, Cup (Flat) Premi → Premi) — item ini TIDAK ada di
  // CUP_SUBTRACTOR_DRINKS jadi cuma nggeser totalCup, tak menyentuh sisi "Minuman Lain".
  const cupDriver = { Ori: 'Paper Cup', Premi: 'Cup (Flat) Premi' };
  for (const v of ['Ori', 'Premi']) {
    const esInfo = await getRowInfo(page, 'Es Teh', v);
    if (!esInfo) continue;
    const brk = parseEsTehBreakdown(esInfo.rowText);
    if (!brk) throw new Error(`Breakdown Es Teh ${v} tak kebaca dari: "${esInfo.rowText.slice(0, 120)}"`);
    const target = brk.minumanLain + 1;
    const delta = target - brk.totalCup; // >0 → perlu jual lebih banyak cup (Sisa driver turun)
    if (Math.abs(delta) > 1e-6) {
      const driverName = cupDriver[v];
      const dInfo = await getRowInfo(page, driverName, null);
      if (!dInfo) throw new Error(`Driver cup "${driverName}" tidak ketemu buat koreksi Es Teh ${v}.`);
      const curVal = await page.locator('.pos-stock-input[data-col="qty"]').nth(dInfo.idx).inputValue();
      const curSisa = parseFloat(curVal) || 0;
      const newSisa = curSisa - delta;
      if (newSisa < 0) {
        throw new Error(`Stok "${driverName}" kurang buat Es Teh ${v} (butuh sisa ${newSisa}, cek seed restock — perbesar Awal item ini).`);
      }
      await setSisaAtIndex(page, dInfo.idx, newSisa);
    }
  }

  // Verifikasi akhir: ke-4 produk Auto (Ori+Premi) harus persis 1.
  for (const [name, variants] of [
    ['Es Teh', ['Ori', 'Premi']], ['Teh Tarik', ['Ori', 'Premi']],
    ['Full Cream', ['Ori', 'Premi']], ['Milk Tea', ['Ori', 'Premi']],
  ]) {
    for (const v of variants) {
      const info = await getRowInfo(page, name, v);
      if (!info) continue;
      const val = parseAuto(info.rowText);
      if (val === null || Math.abs(val - 1) > 0.01) {
        throw new Error(`VERIFIKASI GAGAL: ${name} ${v} = ${val}, target 1 unit terjual.`);
      }
    }
  }

  return filled;
}

test.describe.serial('seed cabang testing — histori 1-16 Sept', () => {
  test('setup: buat cabang + seed inventaris', async ({ page }) => {
    const { data: existing } = await supa.from('outlets').select('name').eq('name', BRANCH).maybeSingle();
    if (!existing) {
      await page.goto('/admin/branches');
      await page.getByRole('button', { name: /Tambah Cabang Baru/i }).click();
      await page.getByPlaceholder('Cabang Seturan').fill(BRANCH);
      await page.getByPlaceholder(/Jl\. Seturan Raya/i).fill('Cabang testing — dibuat otomatis untuk simulasi data TA.');
      await page.getByRole('button', { name: /Simpan Cabang/i }).click();
      await expect(page.getByText(BRANCH, { exact: true })).toBeVisible({ timeout: 15_000 });
    }

    const { data: items, error: itemsErr } = await supa
      .from('branch_inventory').select('item_name').eq('branch_name', SOURCE_BRANCH);
    expect(itemsErr).toBeFalsy();
    expect(items.length).toBeGreaterThan(0);

    // CS tak stok SEMUA bahan (mis. OatMilk buat Matcha Oat Latte, Bubble Besar) — kalau
    // hilang, hard-block "stok awal 0" muncul begitu produk itu ikut kejual (kita jual SEMUA
    // produk). Union-kan sama katalog operational_items penuh biar tak ada yang kelewat.
    const { data: opItems } = await supa.from('operational_items').select('name');
    const nameSet = new Set(items.map((i) => i.item_name));
    for (const op of (opItems || [])) if (!nameSet.has(op.name)) { nameSet.add(op.name); items.push({ item_name: op.name }); }

    const rows = items.map((i) => ({
      branch_name: BRANCH, item_name: i.item_name, display_qty: DISPLAY, safety_qty: SAFETY, current_qty: DISPLAY + SAFETY,
    }));
    const { error } = await supa.from('branch_inventory')
      .upsert(rows, { onConflict: 'branch_name,item_name' });
    expect(error).toBeFalsy();
  });

  for (const date of DATES) {
    for (const shift of SHIFTS) {
      test(`Shift ${shift} @ ${date}`, async ({ page }) => {
        const { data: existingReport } = await supa.from('sales_reports')
          .select('id').eq('branch_name', BRANCH).eq('date', date).eq('shift', shift).maybeSingle();
        if (existingReport) { test.skip(true, 'laporan sudah ada — skip (idempotent)'); return; }

        // TANPA restock — stok cuma diisi sekali di awal (setup). Begitu semua item
        // display_qty sudah 0, berhenti (jangan buka shift yang dijamin gagal hasSales).
        const { data: invRows } = await supa.from('branch_inventory')
          .select('display_qty').eq('branch_name', BRANCH);
        const stillHasStock = invRows.some((r) => (r.display_qty || 0) >= 1);
        if (!stillHasStock) { test.skip(true, 'stok sudah habis semua — berhenti, tak di-restock lagi'); return; }

        await openShift(page, BRANCH, shift, date);
        const inputs = page.locator('.pos-stock-input[data-col="qty"]');
        await expect(inputs.first()).toBeVisible({ timeout: 20_000 });
        const phs = await inputs.evaluateAll((els) => els.map((e) => parseFloat((e.getAttribute('placeholder') || '').replace(/[^\d.]/g, '')) || 0));
        if (!phs.some((v) => v >= 1)) {
          test.skip(true, 'stok sudah habis semua (Awal 0 di form) — berhenti di sini.');
          return;
        }
        const sold = await fillSisa(page, 1);
        expect(sold).toBeGreaterThan(0);
        await closeShift(page, shift, '0');

        const { data: rep } = await supa.from('sales_reports')
          .select('id').eq('branch_name', BRANCH).eq('date', date).eq('shift', shift).maybeSingle();
        expect(rep).toBeTruthy();
      });
    }
  }
});
