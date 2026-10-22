import React, { useState, useEffect, useCallback } from 'react';
import Icon from './Icon';
import { supabase } from '../supabase';
import { formatFraction } from '../utils/stockUtils';

// Daftar pindahan Stok -> Display yang dicatat staff hari ini + tombol buat melakukannya ulang dari admin
// (mis. setelah Koreksi / Batalkan bikin pindahan itu hilang dari angka). Aksinya = persis "Pindah ke Display"
// di BranchStockDrawer: display +qty, stok (safety) -qty, current_qty tetap.
// Log pakai tag [PERBAIKI] dan SENGAJA tanpa teks "(Pindah ke Display)" supaya laporan shift tidak menghitung
// pindahan yang sama dua kali (log asli staff tetap ada). Sisa = pindahan staff - yang sudah diperbaiki.
const isFix = p => p.includes('[PERBAIKI]');
// Pindahan sebuah item dihitung hanya dalam 15 menit dari pindahan pertamanya hari itu; input ulang sesudahnya diabaikan.
const REPEAT_WINDOW_MS = 15 * 60 * 1000;

export default function PerbaikiStokDisplay({ branch, date, actorName, onDone }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const [qtys, setQtys] = useState({});

  const load = useCallback(async () => {
    if (!branch || branch === 'Semua Cabang') { setRows([]); return; }
    setLoading(true);
    const from = new Date(`${date}T00:00:00`).toISOString();
    const [{ data: lg }, { data: inv }] = await Promise.all([
      supabase.from('stock_restock_log').select('item_name, qty_added, petugas_name, created_at').eq('branch_name', branch).gte('created_at', from)
        .or('petugas_name.ilike."%(Pindah ke Display)%",petugas_name.ilike."%(Pindah ke Laci)%",petugas_name.ilike."%[PERBAIKI]%",petugas_name.ilike."%(Koreksi)%"').order('created_at'),
      supabase.from('branch_inventory').select('item_name, display_qty, safety_qty').eq('branch_name', branch),
    ]);
    const I = Object.fromEntries((inv || []).map(x => [x.item_name, x]));
    const m = {};
    (lg || []).forEach(l => {
      const q = Math.abs(l.qty_added || 0);
      if (l.petugas_name.includes('(Koreksi)')) { if (m[l.item_name]) m[l.item_name].fixed = 0; return; } // Koreksi mereset Display/Stok: perbaikan sebelumnya tidak berlaku lagi
      const r = (m[l.item_name] ??= { item: l.item_name, moved: 0, fixed: 0, ignored: 0, first: new Date(l.created_at).getTime() });
      if (isFix(l.petugas_name)) r.fixed += q;
      else if (l.petugas_name.includes('(Pindah ke Laci)')) r.moved -= q;
      else if (new Date(l.created_at).getTime() - r.first > REPEAT_WINDOW_MS) r.ignored += 1; // input ulang, dianggap sekali saja
      else r.moved += q;
    });
    setRows(Object.values(m).filter(r => r.moved > 0).map(r => ({ ...r, remain: Math.max(0, r.moved - r.fixed), inv: I[r.item] || {} })));
    setSel(new Set()); setQtys({});
    setLoading(false);
  }, [branch, date]);

  useEffect(() => { load(); }, [load]);

  const defQty = r => (r.remain > 0 ? r.remain : r.moved);
  const qtyOf = r => { const v = parseFloat(qtys[r.item]); return Number.isFinite(v) ? v : defQty(r); };
  const doMove = async (r) => {
    const { data: cur } = await supabase.from('branch_inventory').select('current_qty, display_qty, safety_qty').eq('branch_name', branch).eq('item_name', r.item).maybeSingle();
    const safety = cur?.safety_qty ?? 0;
    const qty = Math.min(qtyOf(r), safety);
    if (!(qty > 0)) return false;
    const { error } = await supabase.from('branch_inventory').upsert({
      branch_name: branch, item_name: r.item, current_qty: cur?.current_qty ?? 0,
      display_qty: (cur?.display_qty ?? 0) + qty, safety_qty: safety - qty,
    }, { onConflict: 'branch_name,item_name' });
    if (error) return false;
    await supabase.from('stock_restock_log').insert([{
      branch_name: branch, item_name: r.item, qty_added: -qty, qty_before: cur?.current_qty ?? 0, qty_after: cur?.current_qty ?? 0,
      petugas_name: `${actorName} (Perbaiki stok ke display) [PERBAIKI]`,
    }]);
    return true;
  };
  const run = async (list) => {
    if (!list.length) return;
    const txt = list.map(r => `• ${formatFraction(Math.min(qtyOf(r), r.inv.safety_qty ?? 0))} ${r.item}`).join('\n');
    if (!window.confirm(`Pindahkan dari Stok ke Display di ${branch}?\n\n${txt}`)) return;
    setBusy(true);
    const failed = [];
    for (const r of list) if (!(await doMove(r))) failed.push(r.item); // berurutan: baris inventory sama dibaca-tulis
    setBusy(false);
    await load();
    onDone?.();
    alert(failed.length ? `${list.length - failed.length} berhasil, ${failed.length} gagal/stok kosong: ${failed.join(', ')}` : `${list.length} item dipindah dari Stok ke Display.`);
  };

  if (!branch || branch === 'Semua Cabang') return null;
  const todo = rows;
  const picked = todo.filter(r => sel.has(r.item));
  const allOn = todo.length > 0 && picked.length === todo.length;
  return (
    <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
      <div className="flex justify-between items-center" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontWeight: 700 }}><Icon name="refresh" size={16} style={{ verticalAlign: '-3px', marginRight: '0.35rem' }} />Perbaiki Stok ke Display Hari Ini — {branch}</p>
          <p className="text-muted" style={{ fontSize: '0.8rem', maxWidth: '70ch' }}>
            Pindahan Stok→Display hari ini tetap tersimpan walau Anda baru ambil stok kemarin / koreksi. Setelah ACC ulang pengiriman sudah benar, centang lalu <strong>Pindahkan</strong>: Display ditambah, Stok dikurangi sebesar jumlah (total tetap). Cek kolom Display/Stok sekarang dulu — kalau pindahannya sudah tercermin, jangan dipindah lagi.
          </p>
        </div>
        <button className="btn-primary" disabled={busy || !picked.length} onClick={() => run(picked)} style={{ padding: '0.5rem 0.9rem', fontSize: '0.85rem' }}>
          <Icon name="check-circle" size={14} /> {busy ? 'Memproses...' : `Pindahkan (${picked.length})`}
        </button>
      </div>
      {loading ? <p className="text-muted" style={{ marginTop: '0.75rem' }}>Memuat...</p> : !rows.length ? (
        <p className="text-muted" style={{ marginTop: '0.75rem' }}>Tidak ada pindahan Stok→Display di cabang ini pada tanggal tersebut.</p>
      ) : (
        <div style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
          <table className="data-table" style={{ marginTop: 0, minWidth: '640px' }}>
            <thead><tr>
              <th style={{ width: 36 }}><input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(todo.map(r => r.item)))} aria-label="Pilih semua" /></th>
              <th>Item</th><th style={{ textAlign: 'center' }}>Dipindah staff</th><th style={{ textAlign: 'center' }}>Sudah diperbaiki</th>
              <th style={{ textAlign: 'center' }}>Display / Stok sekarang</th><th style={{ textAlign: 'center', width: 110 }}>Pindahkan</th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.item}>
                  <td><input type="checkbox" checked={sel.has(r.item)} onChange={() => setSel(p => { const n = new Set(p); if (n.has(r.item)) n.delete(r.item); else n.add(r.item); return n; })} aria-label={`Pilih ${r.item}`} /></td>
                  <td style={{ fontWeight: 600 }}>{r.item}</td>
                  <td style={{ textAlign: 'center' }} title="Tiap pindahan yang dicatat staff">{formatFraction(r.moved)}{r.ignored > 0 && <div className="text-muted" style={{ fontSize: '0.7rem' }}>{r.ignored} input ulang diabaikan</div>}</td>
                  <td style={{ textAlign: 'center' }}>{r.fixed ? <>{formatFraction(r.fixed)}{r.remain <= 0 && <div className="text-muted" style={{ fontSize: '0.7rem' }}>sudah selesai</div>}</> : '-'}</td>
                  <td style={{ textAlign: 'center' }} className="text-muted">{formatFraction(r.inv.display_qty ?? 0)} / {formatFraction(r.inv.safety_qty ?? 0)}</td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="text" inputMode="decimal" className="input-field" style={{ marginBottom: 0, width: 80, textAlign: 'center' }} value={qtys[r.item] ?? ''} placeholder={formatFraction(defQty(r))} onChange={e => setQtys(p => ({ ...p, [r.item]: e.target.value }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
