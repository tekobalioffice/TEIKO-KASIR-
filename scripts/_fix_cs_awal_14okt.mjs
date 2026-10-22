// Data fix: laporan CS S1 14 Okt — Awal terlipat pindahan gudang->display (buka-ulang 07:46Z
// reset window), jadi Awal != Sisa S2 13 Okt. Set display_awal = sisa_input S2 13, hitung ulang
// masuk_net / pindah_display (Sisa − Awal + Jual). Stok DB tak disentuh.
// Usage: node scripts/_fix_cs_awal_14okt.mjs [apply]
import { supabase } from '../src/supabase.js';
import { getStockKey, getDetailKey } from '../src/utils/stockUtils.js';
const apply = process.argv[2] === 'apply';
const get = async id => (await supabase.from('sales_reports').select('details').eq('id', id).single()).data.details;
const prevD = await get('211ab278-3091-4870-a597-39bd3fd28f0b');
const ID = '49e9746c-052f-49b5-808a-b29c274a823e';
const det = await get(ID);
const ok = d => !d._is_meta && !d._is_inventory_snapshot && d.name && d.sisa_input != null;
const prev = {};
prevD.filter(ok).forEach(d => { const k = getStockKey(d); if (!(k in prev) || getDetailKey(d) === k) prev[k] = Number(d.sisa_input) || 0; });
const r3 = n => Math.round(n * 1000) / 1000;
const log = [];
const out = det.map(d => {
  if (d._is_preclose_snapshot) return d;
  if (!ok(d) || d.display_awal == null) return d;
  const k = getStockKey(d);
  if (!(k in prev) || Math.abs(prev[k] - d.display_awal) < 0.001) return d;
  const mn = r3(d.sisa_input - prev[k] + (Number(d.total_fisik) || 0));
  log.push(`${d.name} ${d.variant}: awal ${d.display_awal} -> ${prev[k]}, pindah ${d.pindah_display} -> ${Math.max(0, r3(mn - (d.tambah || 0)))}`);
  return { ...d, display_awal: prev[k], masuk_net: mn, pindah_display: Math.max(0, r3(mn - (d.tambah || 0))) };
});
console.log(log.length + ' baris:\n' + log.join('\n'));
if (!apply) process.exit(0);
const { error } = await supabase.from('sales_reports').update({ details: out }).eq('id', ID);
console.log(error ? error.message : 'Selesai.');
