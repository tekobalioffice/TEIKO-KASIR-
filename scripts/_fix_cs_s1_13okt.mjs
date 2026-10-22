// Data fix: CS Shift 1 tgl 2026-10-13 ditutup (07:58Z) tanpa potong stok — tak ada satu pun log
// "Auto-Deduct Shift 1". HP CS PAGI kemungkinan masih jalan build pra-11 Okt (sebelum d4a5937):
// sesi S2 12 Okt di HP itu dipindah ke S1 13 (migrateStaleSession, sengaja tanpa log Buka), jadi
// guard anti-dobel versi lama mundur ke "Buka Shift 1" 12 Okt, nangkep Auto-Deduct S1 12 Okt
// -> "sudah dipotong" -> potong stok dilewati. Akibat: display = Awal S1 + kiriman, S2 tak nyambung.
// Perbaikan per item: potong terjual S1 (total_fisik) dari display sekarang — sama kayak Tutup Shift
// (display live − terjual). Snapshot pre-close dari build lama tak bisa dipercaya (beberapa item
// lebih kecil dari display sebelum/sesudahnya). Item yang dikoreksi admin sesudah tutup dilewati.
// Usage: node scripts/_fix_cs_s1_13okt.mjs          (dry run)
//        node scripts/_fix_cs_s1_13okt.mjs apply
import { supabase } from '../src/supabase.js';
import { getStockKey, getDetailKey } from '../src/utils/stockUtils.js';

const BRANCH = 'CS';
const REPORT_ID = 'd4c387af-3136-4ab3-be41-cb65d89017af';
const apply = process.argv[2] === 'apply';

const { data: done } = await supabase.from('stock_restock_log').select('id').eq('branch_name', BRANCH)
  .ilike('petugas_name', '%Auto-Deduct Shift 1%').gte('created_at', '2026-10-13T07:58:00Z');
if (done.length) { console.log('Sudah ada Auto-Deduct S1 sesudah tutup — batal.'); process.exit(1); }

const { data: rep } = await supabase.from('sales_reports').select('details').eq('id', REPORT_ID).single();
const { data: kor } = await supabase.from('stock_restock_log').select('item_name').eq('branch_name', BRANCH)
  .ilike('petugas_name', '%(Koreksi)%').gte('created_at', '2026-10-13T07:58:00Z');
const skip = new Set(kor.map(k => k.item_name));
const sisaByKey = {}, soldByKey = {};
for (const d of rep.details) {
  if (d._is_meta || d._is_inventory_snapshot || !d.name || d.sisa_input == null) continue;
  const k = getStockKey(d);
  if (!(k in sisaByKey) || getDetailKey(d) === k) { sisaByKey[k] = Number(d.sisa_input) || 0; soldByKey[k] = Number(d.total_fisik) || 0; }
}
const { data: inv } = await supabase.from('branch_inventory').select('item_name, display_qty, current_qty').eq('branch_name', BRANCH);
const round = n => Math.round(n * 1000) / 1000;
const fixes = [];
for (const row of inv) {
  const sold = round(soldByKey[row.item_name] || 0);
  if (sold <= 0) continue;
  if (skip.has(row.item_name)) { console.log(`  LEWATI (dikoreksi admin) ${row.item_name}: display ${row.display_qty}, terjual S1 ${sold}`); continue; }
  const target = round(Math.max(0, row.display_qty - sold));
  if (Math.abs(target - row.display_qty) < 0.001) continue; // mis. Es Teh (stok selalu 0)
  fixes.push({ ...row, sold, target, sisa: sisaByKey[row.item_name] });
}
console.log(`${fixes.length} item:`);
fixes.forEach(f => console.log(`  ${f.item_name.padEnd(22)} display ${f.display_qty} -> ${f.target} (terjual ${f.sold}; sisa laporan ${f.sisa})${Math.abs(f.target - f.sisa) > 0.001 ? '  <-- BEDA' : ''}`));
// Kiriman ACC ke display (tambah_qty) tak masuk sisa_input di build lama -> Awal S2 (= sisa S1)
// kurang. Betulkan sisa_input laporan: display pre-close + tambah_qty − terjual.
const pre = rep.details.find(d => d._is_preclose_snapshot);
const preBy = Object.fromEntries((pre?.rows || []).map(r => [r.item_name, r]));
const sisaFix = [];
const newDetails = rep.details.map(d => {
  if (d._is_meta || d._is_inventory_snapshot || !d.name || d.sisa_input == null) return d;
  const k = getStockKey(d), p = preBy[k];
  if (!p || !(p.tambah_qty > 0) || getDetailKey(d) !== k) return d;
  const v = round(Math.max(0, p.display_qty + p.tambah_qty - (Number(d.total_fisik) || 0)));
  if (Math.abs(v - d.sisa_input) < 0.001) return d;
  sisaFix.push(`${k}: ${d.sisa_input} -> ${v}`);
  return { ...d, sisa_input: v };
});
console.log(`sisa_input laporan S1 dibetulkan (${sisaFix.length}):`); sisaFix.forEach(x => console.log('  ' + x));
if (!apply) { console.log('\nDry run. Jalankan dengan "apply" untuk menulis.'); process.exit(0); }

for (const f of fixes) {
  const cut = f.target - f.display_qty;
  const newCurrent = round((f.current_qty ?? 0) + cut);
  const { error } = await supabase.from('branch_inventory').update({ display_qty: f.target, current_qty: newCurrent })
    .eq('branch_name', BRANCH).eq('item_name', f.item_name);
  if (error) { console.error(f.item_name, error.message); continue; }
  await supabase.from('stock_restock_log').insert([{
    branch_name: BRANCH, item_name: f.item_name, qty_added: round(cut),
    qty_before: f.current_qty, qty_after: newCurrent,
    petugas_name: 'kbagastya (Auto-Deduct Shift 1 susulan 13 Okt — HP app lama tak potong stok)',
  }]);
}
if (sisaFix.length) {
  const { error } = await supabase.from('sales_reports').update({ details: newDetails }).eq('id', REPORT_ID);
  if (error) console.error('laporan', error.message);
}
console.log('Selesai.');
