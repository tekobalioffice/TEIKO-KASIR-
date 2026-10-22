import React, { useState, useMemo, useEffect } from 'react';
import { supabase } from '../supabase';
import { useAuth } from '../contexts/AuthContext';
import { useLocalStorageBranch } from '../hooks/useLocalStorageBranch';
import { useLocalStorageDate } from '../hooks/useLocalStorageDate';
import Icon from '../components/Icon';
import { sumExpr, formatFraction } from '../utils/stockUtils';

/**
 * ============================================================================
 * KOREKSI LAPORAN PER BARIS
 * ============================================================================
 * Betulkan Awal / Tambah / Sisa satu item di laporan shift yang SUDAH ditutup —
 * tanpa Buka Ulang Shift. Wajib: Awal + Tambah - Jual = Sisa (balance) buat tiap
 * baris yang diubah. Jual tidak bisa diedit di sini (menyangkut omzet/setoran).
 *
 * Saat simpan:
 *  - details laporan di-patch (display_awal, tambah, sisa_input, sisa)
 *  - kalau ini laporan TERAKHIR cabang itu: branch_inventory.display_qty & current_qty
 *    disesuaikan sebesar (Sisa baru - Sisa lama). Kalau BUKAN yang terakhir, stok tidak
 *    disentuh — cuma laporannya, dan diberi peringatan.
 *  - tiap perubahan dicatat di stock_restock_log: (Koreksi Laporan Shift N tgl ...)
 * ============================================================================
 */

const num = (v) => { const n = sumExpr(String(v ?? '')); return n == null || Number.isNaN(n) ? null : n; };
const isMeta = (d) => d._is_meta || d._is_inventory_snapshot || d._is_preclose_snapshot || !d.name;
const detKey = (d) => (d.variant && d.variant !== 'Standar') ? `${d.name} ${d.variant}` : d.name;

export default function AdminKoreksiLaporan() {
  const { userData } = useAuth();
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useLocalStorageBranch('');
  const [date, setDate] = useLocalStorageDate('koreksiLaporan_date', new Date().toISOString().split('T')[0]);
  const [shift, setShift] = useState('1');
  const [report, setReport] = useState(null);
  const [rows, setRows] = useState([]);           // { key, name, variant, awal, tambah, jual, sisa, oldSisa }
  const [isLatest, setIsLatest] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    supabase.from('outlets').select('name').order('name').then(({ data }) => {
      setBranches(data || []);
      if (!branch && data?.[0]) setBranch(data[0].name);
    });
  }, []); // eslint-disable-line

  const loadReport = async () => {
    if (!branch || !date || !shift) return;
    setLoading(true); setMsg(''); setReport(null); setRows([]);
    try {
      const { data, error } = await supabase.from('sales_reports')
        .select('*').eq('branch_name', branch).eq('date', date).eq('shift', shift).limit(1);
      if (error) throw error;
      if (!data || data.length === 0) { setMsg(`Tidak ada laporan ${branch} ${date} Shift ${shift}.`); return; }
      const rep = data[0];
      setReport(rep);

      // laporan terakhir cabang ini?
      const { data: later } = await supabase.from('sales_reports')
        .select('date, shift').eq('branch_name', branch)
        .or(`date.gt.${date},and(date.eq.${date},shift.gt.${shift})`);
      setIsLatest(!later || later.length === 0);

      setRows((rep.details || []).filter(d => !isMeta(d)).map(d => {
        const j = Number(d.total_fisik ?? d.qty ?? 0);
        // Baris tanpa dimensi stok (minuman auto-calc spt Full Cream, atau item yg
        // Awal/Tambah/Sisa-nya semua 0/kosong) -> cuma Jual yang dikoreksi, tanpa cek balance.
        const stZero = (v) => v == null || Number(v) === 0;
        const salesOnly = stZero(d.display_awal) && stZero(d.sisa_input) && stZero(d.sisa) && stZero(d.tambah);
        return {
          key: detKey(d),
          name: d.name,
          variant: d.variant || 'Standar',
          price: Number(d.price ?? 0),
          salesOnly,
          hasSusu: !!(d.is_dual_base && Number(d.susu_qty) > 0),
          awal: String(d.display_awal ?? ''),
          tambah: String(d.tambah ?? 0),
          pindah: String(d.pindah_display ?? 0),
          jual: String(j),
          sisa: String(d.sisa_input ?? d.sisa ?? ''),
          stok: String(d.safety_remaining ?? 0),
          oldSisa: Number(d.sisa_input ?? d.sisa ?? 0),
          oldAwal: Number(d.display_awal ?? 0),
          oldTambah: Number(d.tambah ?? 0),
          oldPindah: Number(d.pindah_display ?? 0),
          oldStok: Number(d.safety_remaining ?? 0),
          oldJual: j,
        };
      }));
    } catch (err) {
      setMsg(`Gagal memuat: ${err.message}`);
    } finally { setLoading(false); }
  };

  const setField = (key, f, v) => setRows(prev => prev.map(r => r.key === key ? { ...r, [f]: v } : r));

  // Baris "disentuh" = ada field yang isinya beda dari aslinya. Field kosong yang
  // dari sananya memang kosong TIDAK dihitung disentuh (jangan blokir simpan gara2 itu).
  const isBlank = (v) => String(v ?? '').trim() === '';
  const fieldTouched = (raw, old) => { const n = num(raw); return n === null ? !isBlank(raw) : n !== old; };
  // "Sales-only" = tak ada dimensi stok: lahir tanpa stok, ATAU Awal+Tambah+Sisa
  // di layar dikosongkan/0 semua. Cuma Jual yang dikoreksi, tanpa cek balance.
  const zeroBlank = (v) => isBlank(v) || num(v) === 0;
  const effSalesOnly = (r) => r.salesOnly || (zeroBlank(r.awal) && zeroBlank(r.tambah) && zeroBlank(r.sisa));
  const stokTouched = (r) => fieldTouched(r.stok, r.oldStok);
  const rowTouched = (r) => stokTouched(r) || (effSalesOnly(r)
    ? fieldTouched(r.jual, r.oldJual)
    : (fieldTouched(r.awal, r.oldAwal) || fieldTouched(r.tambah, r.oldTambah)
        || fieldTouched(r.pindah, r.oldPindah)
        || fieldTouched(r.sisa, r.oldSisa) || fieldTouched(r.jual, r.oldJual)));

  const changed = useMemo(() => rows.filter(r => {
    if (!rowTouched(r)) return false;
    if (num(r.stok) === null) return false;
    if (effSalesOnly(r)) return num(r.jual) !== null;
    const a = num(r.awal), t = num(r.tambah), p = num(r.pindah), s = num(r.sisa), j = num(r.jual);
    return a !== null && t !== null && p !== null && s !== null && j !== null;
  }), [rows]);

  const badRows = useMemo(() => rows.filter(r => {
    if (!rowTouched(r)) return false;                                       // tidak disentuh -> abaikan
    if (num(r.stok) === null) return true;                                  // STOK tak terbaca
    if (effSalesOnly(r)) return num(r.jual) === null;                       // cuma Jual yang wajib kebaca
    const a = num(r.awal), t = num(r.tambah), p = num(r.pindah), s = num(r.sisa), j = num(r.jual);
    if (a === null || t === null || p === null || s === null || j === null) return true;
    return Math.abs((a + t + p - j) - s) > 0.001;                           // balance: Awal + Tambah + Pindah - Jual = Sisa
  }), [rows]);

  // Delta omzet per baris — samakan logika BranchPOS: revenue = Jual x harga,
  // kecuali Bubble (dari porsi, bukan Jual) dan Jelly/Pudding/Cao harga 0 -> fallback 2000.
  const lineRevDelta = (r) => {
    const dq = num(r.jual) - r.oldJual;
    if (dq === 0) return 0;
    const nm = (r.name || '').toLowerCase();
    if (nm.includes('bubble')) return 0;
    let price = r.price || 0;
    if (!price && (nm.includes('jelly') || nm.includes('pudding') || nm.includes('cao'))) price = 2000;
    return dq * price;
  };
  const revDelta = useMemo(() => changed.reduce((s, r) => s + lineRevDelta(r), 0), [changed]); // eslint-disable-line
  // Item yang delta omzet-nya tidak bisa dipastikan otomatis (dual base + susu).
  const revUncertain = useMemo(() => changed.filter(r => num(r.jual) !== r.oldJual && r.hasSusu), [changed]);

  const save = async () => {
    if (badRows.length) { alert(`Ada baris tidak balance / tak terbaca: ${badRows.map(r => r.key).join(', ')}`); return; }
    if (changed.length === 0) { alert('Tidak ada perubahan.'); return; }
    if (!window.confirm(
      `Simpan koreksi ${changed.length} baris di laporan ${branch} ${date} Shift ${shift}?` +
      (Math.abs(revDelta) > 0.5 ? `\n\nOmzet: ${revDelta >= 0 ? '+' : ''}Rp ${Math.round(revDelta).toLocaleString('id-ID')} (dari Jual yang diedit). Cek setoran & selisih di Riwayat Penjualan.` : '') +
      (revUncertain.length ? `\n\nItem dual-base + susu (${revUncertain.map(r => r.key).join(', ')}): tambahan susu TIDAK ikut dihitung otomatis — sesuaikan omzet manual.` : '') +
      (isLatest ? '\n\nStok cabang ikut disesuaikan.' : '\n\nLAPORAN INI BUKAN YANG TERAKHIR — stok TIDAK disesuaikan otomatis, cek manual.')
    )) return;

    setSaving(true);
    try {
      const actor = userData?.name ? `${userData.name} (${userData.role || 'admin'})` : 'Admin';
      const chMap = Object.fromEntries(changed.map(r => [r.key, {
        awal: num(r.awal), tambah: num(r.tambah), pindah: num(r.pindah), sisa: num(r.sisa), jual: num(r.jual),
        stok: num(r.stok), stokChanged: stokTouched(r), salesOnly: effSalesOnly(r), r,
      }]));

      const newDetails = (report.details || []).map(d => {
        if (isMeta(d)) return d;
        const c = chMap[detKey(d)];
        if (!c) return d;
        const withStok = c.stokChanged ? { safety_remaining: c.stok } : {};
        if (c.salesOnly) return { ...d, display_awal: 0, tambah: 0, pindah_display: 0, sisa_input: 0, sisa: 0, qty: c.jual, total_fisik: c.jual, ...withStok };
        return { ...d, display_awal: c.awal, tambah: c.tambah, pindah_display: c.pindah, sisa_input: c.sisa, sisa: c.sisa, qty: c.jual, total_fisik: c.jual, ...withStok };
      });

      const patch = { details: newDetails };
      if (Math.abs(revDelta) > 0.001) patch.total_revenue = (report.total_revenue || 0) + revDelta;
      const { error: upErr } = await supabase.from('sales_reports').update(patch).eq('id', report.id);
      if (upErr) throw upErr;

      // verifikasi update benar-benar tersimpan (RLS bisa gagal senyap)
      const { data: chk } = await supabase.from('sales_reports').select('details').eq('id', report.id).single();
      const ok = changed.every(r => {
        const d = (chk?.details || []).find(x => !isMeta(x) && detKey(x) === r.key);
        if (!d) return false;
        if (effSalesOnly(r)) return Math.abs((d.qty ?? 0) - num(r.jual)) < 0.001;
        return Math.abs((d.sisa_input ?? 0) - num(r.sisa)) < 0.001;
      });
      if (!ok) throw new Error('Update laporan tidak tersimpan (kemungkinan RLS UPDATE sales_reports belum aktif). Jalankan supabase/koreksi_laporan.sql.');

      // sesuaikan branch_inventory kalau laporan terakhir.
      // Iterasi entri chMap (punya nilai num + flag + .r = row asli), BUKAN `changed`
      // (row mentah: .sisa/.stok masih string, tak ada .r → dulu throw & batalin update).
      const logs = [];
      const chList = Object.values(chMap);
      if (isLatest) {
        for (const c of chList) {
          const dDisplay = c.salesOnly ? 0 : (c.sisa - c.r.oldSisa);
          const dStok = c.stokChanged ? (c.stok - c.r.oldStok) : 0;
          if (Math.abs(dDisplay) < 0.001 && Math.abs(dStok) < 0.001) continue;
          const { data: inv } = await supabase.from('branch_inventory')
            .select('display_qty, safety_qty, current_qty').eq('branch_name', branch).eq('item_name', c.r.key).single();
          const dq = (inv?.display_qty ?? 0) + dDisplay;
          const sq = Math.max(0, (inv?.safety_qty ?? 0) + dStok);
          await supabase.from('branch_inventory').update({ display_qty: dq, safety_qty: sq, current_qty: dq + sq })
            .eq('branch_name', branch).eq('item_name', c.r.key);
          logs.push({
            branch_name: branch, item_name: c.r.key,
            qty_added: dDisplay + dStok, qty_before: (inv?.current_qty ?? 0), qty_after: dq + sq,
            petugas_name: `${actor} (Koreksi Laporan Shift ${shift} ${date}${dStok ? ' [+STOK]' : ''})`,
          });
        }
      } else {
        for (const c of chList) {
          logs.push({
            branch_name: branch, item_name: c.r.key,
            qty_added: 0,
            qty_before: c.salesOnly ? c.r.oldJual : c.r.oldSisa,
            qty_after: c.salesOnly ? c.jual : c.sisa,
            petugas_name: `${actor} (Koreksi Laporan Shift ${shift} ${date} — ${c.salesOnly ? 'koreksi Jual' : 'stok tidak disesuaikan, bukan laporan terakhir'})`,
          });
        }
      }
      if (logs.length) await supabase.from('stock_restock_log').insert(logs);

      alert(`Koreksi ${changed.length} baris tersimpan.` + (isLatest ? '' : '\nStok cabang TIDAK disesuaikan — cek manual.'));
      await loadReport();
    } catch (err) {
      alert(`Gagal menyimpan: ${err.message}`);
    } finally { setSaving(false); }
  };

  const visible = rows.filter(r => r.key.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="animate-fade-in pb-10">
      <div className="page-title flex justify-between items-center" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 className="text-primary mb-1 text-2xl font-black">Koreksi Laporan</h1>
          <p className="text-muted text-sm">Betulkan <strong>Awal / Tambah / Pindah / Jual / Sisa / Stok</strong> satu item di laporan shift yang sudah ditutup. Balance sisi display: <strong>Awal + Tambah + Pindah − Jual = Sisa</strong>. <strong>"Pindah"</strong> = qty ambil stok gudang cabang (hijau di Kartu Stok). <strong>"Stok"</strong> = sisa stok gudang cabang (kolom STOK di Kartu Stok, independen). Edit Jual → omzet ikut disesuaikan.</p>
        </div>
        {report && (
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {Math.abs(revDelta) > 0.5 && (
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: revDelta >= 0 ? 'var(--success-ink, #096C46)' : 'var(--danger)' }}>
                Omzet {revDelta >= 0 ? '+' : ''}Rp {Math.round(revDelta).toLocaleString('id-ID')}
              </span>
            )}
            <button onClick={save} disabled={saving || badRows.length > 0 || changed.length === 0}
              className="btn-primary" style={{ whiteSpace: 'nowrap', opacity: (saving || badRows.length || !changed.length) ? 0.5 : 1 }}>
              <Icon name="save" size={18} /> {saving ? 'Menyimpan...' : `Simpan${changed.length ? ` (${changed.length})` : ''}`}
            </button>
          </div>
        )}
      </div>

      <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', borderRadius: '12px' }}>
        <select className="input-field" style={{ marginBottom: 0, maxWidth: '200px' }} value={branch} onChange={e => setBranch(e.target.value)}>
          {branches.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
        </select>
        <input type="date" className="input-field" style={{ marginBottom: 0, maxWidth: '170px' }} value={date} onChange={e => setDate(e.target.value)} />
        <select className="input-field" style={{ marginBottom: 0, maxWidth: '110px' }} value={shift} onChange={e => setShift(e.target.value)}>
          <option value="1">Shift 1</option>
          <option value="2">Shift 2</option>
        </select>
        <button className="btn-primary" onClick={loadReport} disabled={loading}>
          <Icon name="search" size={16} /> {loading ? 'Memuat...' : 'Muat Laporan'}
        </button>
        {report && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flex: 1, minWidth: '160px' }}>
            <Icon name="search" size={16} className="text-muted" />
            <input className="input-field" style={{ marginBottom: 0, width: '100%' }} placeholder="Cari item..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        )}
      </div>

      {msg && <p className="text-muted text-sm" style={{ marginBottom: '1rem' }}>{msg}</p>}

      {report && !isLatest && (
        <div className="glass-panel" style={{ padding: '0.9rem 1.1rem', marginBottom: '1rem', border: '2px solid var(--warning)', borderRadius: '10px', fontSize: '0.9rem' }}>
          <strong style={{ color: 'var(--warning-ink, #b25000)' }}>Laporan ini bukan yang terakhir.</strong> Koreksi hanya mengubah laporan; stok <code>branch_inventory</code> tidak disesuaikan otomatis (aktivitas shift setelahnya sudah jalan). Cek stok manual setelah simpan.
        </div>
      )}

      {report && (
        <div className="glass-panel table-responsive" style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ marginTop: 0, minWidth: '820px' }}>
            <thead style={{ backgroundColor: 'rgba(0,0,0,0.03)' }}>
              <tr>
                <th style={{ width: '40px', textAlign: 'center' }}>No</th>
                <th>Nama Produk</th>
                <th style={{ textAlign: 'center', width: '95px' }}>Awal</th>
                <th style={{ textAlign: 'center', width: '95px' }}>Tambah</th>
                <th style={{ textAlign: 'center', width: '95px' }}>Pindah</th>
                <th style={{ textAlign: 'center', width: '75px' }}>Jual</th>
                <th style={{ textAlign: 'center', width: '95px' }}>Sisa</th>
                <th style={{ textAlign: 'center', width: '95px', borderLeft: '2px solid var(--border-color)' }}>Stok<br /><span style={{ fontWeight: 400, fontSize: '0.65rem' }}>(gudang)</span></th>
                <th style={{ textAlign: 'center', width: '80px' }}>Cek</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r, idx) => {
                const a = num(r.awal), t = num(r.tambah), p = num(r.pindah), s = num(r.sisa), j = num(r.jual);
                const bornSO = r.salesOnly;                 // lahir tanpa stok -> kolom stok dimatikan
                const so = effSalesOnly(r);                 // efektif sales-only (termasuk yg dikosongkan)
                const readable = so ? j !== null : (a !== null && t !== null && p !== null && s !== null && j !== null);
                const touched = so ? (readable && j !== r.oldJual)
                  : (readable && (a !== r.oldAwal || t !== r.oldTambah || p !== r.oldPindah || s !== r.oldSisa || j !== r.oldJual));
                const bal = (!so && readable) ? (a + t + p - j) : null;
                const balanced = so ? true : (readable && Math.abs(bal - s) < 0.001);
                const cellInput = (f, disabled) => (
                  <input type="text" className="input-field" disabled={disabled}
                    style={{ marginBottom: 0, width: '84px', textAlign: 'center', fontWeight: 600, ...(disabled ? { opacity: 0.4 } : touched && !balanced ? { borderColor: 'var(--danger)' } : touched ? { borderColor: 'var(--primary)' } : {}) }}
                    value={disabled ? '' : r[f]} onChange={e => setField(r.key, f, e.target.value)} />
                );
                return (
                  <tr key={r.key}>
                    <td className="text-muted" style={{ textAlign: 'center' }}>{idx + 1}</td>
                    <td style={{ fontWeight: 600 }}>{r.key}{so && <span className="text-muted" style={{ fontSize: '0.72rem', fontWeight: 400, display: 'block' }}>tanpa stok — hanya Jual</span>}</td>
                    <td style={{ textAlign: 'center' }}>{cellInput('awal', bornSO)}</td>
                    <td style={{ textAlign: 'center' }}>{cellInput('tambah', bornSO)}</td>
                    <td style={{ textAlign: 'center' }}>{cellInput('pindah', bornSO)}</td>
                    <td style={{ textAlign: 'center' }}>{cellInput('jual')}</td>
                    <td style={{ textAlign: 'center' }}>{cellInput('sisa', bornSO)}</td>
                    <td style={{ textAlign: 'center', borderLeft: '2px solid var(--border-color)' }}>{cellInput('stok')}</td>
                    <td style={{ textAlign: 'center', fontSize: '0.8rem', fontWeight: 700, color: !readable ? 'var(--danger)' : !touched ? 'var(--text-muted)' : balanced ? 'var(--success-ink, #096C46)' : 'var(--danger)' }}>
                      {!readable ? '?' : !touched ? '–' : so ? 'OK' : balanced ? 'OK' : `≠ ${formatFraction(bal)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
