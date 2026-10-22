// Data fix: PDK Shift 2 (sore) tgl 2026-10-12 diisi lewat tengah malam (HP WITA, 00.19–00.52 tgl 13)
// -> app staff ambil tanggal HP = 13 & auto-pilih Shift 1. Laporan + log tersimpan sebagai S1 tgl 13,
// slot S1 13 jadi kepakai (staff pagi 13 ga bisa buka Shift 1). Stok sudah terpotong benar — cuma label.
// Pindahkan laporan ke S2 tgl 12, label log ikut, log "Buka Shift 2" salah (00.55 tgl 13) dinetralkan.
// Usage: node scripts/_fix_pdk_s2_12okt.mjs          (dry run)
//        node scripts/_fix_pdk_s2_12okt.mjs apply
import { supabase } from '../src/supabase.js';

const BRANCH = 'PDK';
const REPORT_ID = '966c4fd9-864a-42f2-8ac3-049d4c71e414';
const apply = process.argv[2] === 'apply';

const { data: rep } = await supabase.from('sales_reports').select('date, shift, staff_name').eq('id', REPORT_ID).single();
const { data: s2 } = await supabase.from('sales_reports').select('id').eq('branch_name', BRANCH).eq('date', '2026-10-12').eq('shift', '2');
if (rep.date !== '2026-10-13' || rep.shift !== '1' || s2.length) { console.log('Kondisi berubah, batal:', rep, s2); process.exit(1); }

const { data: logs } = await supabase.from('stock_restock_log').select('id, created_at, petugas_name')
  .eq('branch_name', BRANCH).gte('created_at', '2026-10-12T16:19:00Z').lte('created_at', '2026-10-12T16:56:00Z')
  .or('petugas_name.ilike.%Shift 1%,petugas_name.ilike.%Buka Input Shift 2%');
const changes = logs.map(l => ({
  id: l.id, from: l.petugas_name,
  to: l.petugas_name.includes('Buka Input Shift 2')
    ? 'PDK_SORE (Online - salah buka S2 tgl 13, diabaikan)'
    : l.petugas_name.replace('Shift 1', 'Shift 2'),
}));

console.log(`Laporan ${REPORT_ID}: ${rep.date} S${rep.shift} (${rep.staff_name}) -> 2026-10-12 S2`);
console.log(`${changes.length} log:`); changes.forEach(c => console.log(`  ${c.from}  ->  ${c.to}`));
if (!apply) { console.log('\nDry run. Jalankan dengan "apply" untuk menulis.'); process.exit(0); }

const { error } = await supabase.from('sales_reports').update({ date: '2026-10-12', shift: '2' }).eq('id', REPORT_ID);
if (error) { console.error(error.message); process.exit(1); }
for (const c of changes) {
  const { error: e } = await supabase.from('stock_restock_log').update({ petugas_name: c.to }).eq('id', c.id);
  if (e) console.error(c.id, e.message);
}
console.log('Selesai.');
