// Data fix: CS Shift 1 tgl 2026-10-09 ditutup dari HP berisi app versi lama (pra 29 Sep).
// Guard anti-dobel versi lama ngeliat "Auto-Deduct Shift 1" susulan 8 Okt (ditulis 9 Okt 15:37)
// -> potong stok S1 dilewati. Laporan tersimpan, tapi display_qty/current_qty tak terpotong,
// jadi Awal Shift 2 != Sisa Shift 1.
// Target per item: display = sisa_input S1 + Pindah ke Display sesudah Buka Shift 2.
// Usage: node scripts/_fix_cs_s1_9okt.mjs          (dry run)
//        node scripts/_fix_cs_s1_9okt.mjs apply
import { supabase } from '../src/supabase.js';
import { getStockKey, getDetailKey } from '../src/utils/stockUtils.js';

const BRANCH = 'CS';
const REPORT_ID = '652a8a0b-08ec-4f07-8fe0-9c89ce335606';
const apply = process.argv[2] === 'apply';

const { data: rep } = await supabase.from('sales_reports').select('details').eq('id', REPORT_ID).single();
const sisaByKey = {};
for (const d of rep.details) {
  if (d._is_meta || d._is_inventory_snapshot || !d.name || d.sisa_input == null) continue;
  const k = getStockKey(d);
  // Beberapa menu bisa map ke stockKey sama — utamakan baris yang memang item itu sendiri.
  if (!(k in sisaByKey) || getDetailKey(d) === k) sisaByKey[k] = Number(d.sisa_input) || 0;
}

const { data: openS2 } = await supabase.from('stock_restock_log').select('created_at')
  .eq('branch_name', BRANCH).eq('item_name', 'Status Aktivitas')
  .ilike('petugas_name', '%Buka Input Shift 2%').order('created_at', { ascending: false }).limit(1);
const s2Open = openS2[0].created_at;
const { data: pindah } = await supabase.from('stock_restock_log').select('item_name, qty_added')
  .eq('branch_name', BRANCH).ilike('petugas_name', '%(Pindah ke Display)%').gt('created_at', s2Open);
const pindahByKey = {};
(pindah || []).forEach(l => { pindahByKey[l.item_name] = (pindahByKey[l.item_name] || 0) + Math.abs(Number(l.qty_added) || 0); });

const { data: inv } = await supabase.from('branch_inventory')
  .select('item_name, display_qty, current_qty').eq('branch_name', BRANCH);

const round = n => Math.round(n * 1000) / 1000;
const fixes = [];
for (const row of inv) {
  if (!(row.item_name in sisaByKey)) continue;
  const target = round(sisaByKey[row.item_name] + (pindahByKey[row.item_name] || 0));
  const delta = round(target - (row.display_qty ?? 0));
  if (Math.abs(delta) < 0.001) continue;
  fixes.push({ ...row, target, delta });
}

console.log(`Buka Shift 2: ${s2Open}. ${fixes.length} item:`);
fixes.forEach(f => console.log(`  ${f.item_name.padEnd(22)} display ${f.display_qty} -> ${f.target} (${f.delta}), current ${f.current_qty} -> ${round(f.current_qty + f.delta)}`));
if (!apply) { console.log('\nDry run. Jalankan dengan "apply" untuk menulis.'); process.exit(0); }

for (const f of fixes) {
  const newCurrent = round((f.current_qty ?? 0) + f.delta);
  const { error } = await supabase.from('branch_inventory')
    .update({ display_qty: f.target, current_qty: newCurrent })
    .eq('branch_name', BRANCH).eq('item_name', f.item_name);
  if (error) { console.error(f.item_name, error.message); continue; }
  await supabase.from('stock_restock_log').insert([{
    branch_name: BRANCH, item_name: f.item_name, qty_added: f.delta,
    qty_before: f.current_qty, qty_after: newCurrent,
    petugas_name: 'kbagastya (Potong Stok S1 9 Okt tertunda — app lama tak potong)',
  }]);
}
console.log('Selesai.');
