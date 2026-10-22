import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../supabase';
import { useAuth } from '../contexts/AuthContext';
import { useLocalStorageBranch } from '../hooks/useLocalStorageBranch';
import Icon from '../components/Icon';
import PerbaikiStokDisplay from '../components/PerbaikiStokDisplay';
import { sumExpr, formatFraction, getStockKey } from '../utils/stockUtils';
import { exportPenyesuaianToExcel } from '../utils/exportExcel';

/**
 * ============================================================================
 * KOREKSI STOK (dari Form Kertas / Foto)
 * ============================================================================
 * Halaman untuk memasukkan hasil hitung fisik dari "Form Stok Barang" ke POS.
 * Yang diisi: Stok Awal (display_qty), Tambah (tambah_qty), Stok Gudang (safety_qty).
 * TIDAK menyentuh Penjualan / Sisa / Stok Akhir — itu dari laporan shift.
 *
 * Kolom "O" pada form kertas = varian Ori, "P" = varian Premi. Di sistem, varian
 * sudah jadi baris produk terpisah (mis. "Gula Milk Tea Ori" / "... Premi"), jadi
 * cukup isi angka O ke baris Ori dan P ke baris Premi.
 *
 * Input menerima ekspresi "4+8" (dijumlah -> 12) atau "20-3" (-> 17).
 * Field kosong = tidak diubah.
 * ============================================================================
 */

// Nama di form kertas kadang beda tipis dari nama produk di DB.
const ALIAS_MAP = {
  'dancow coklat': 'Dancow Cokelat',
  'dancow putih': 'Dancow Putih',
  'teh madu hutan': 'Madu Hutan',
  'gd capucinno': 'GD Capucinno',
  'gd cappuccino': 'GD Capucinno',
  'coffe cream': 'Coffee Cream',
  'es coklat': 'Es Coklat',
  'ultra milk besar': 'Ultra Milk Besar',
  'diamond bc': 'Diamond BC',
};

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

export default function AdminKoreksi() {
  const { userData } = useAuth();
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useLocalStorageBranch('');
  const [baseItems, setBaseItems] = useState([]); // { key, dbKey }
  const [rows, setRows] = useState([]);           // { key, dbKey, oldAwal, oldTambah, oldGudang, awal, tambah, gudang }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [petugas, setPetugas] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteMsg, setPasteMsg] = useState('');
  const [prefillMsg, setPrefillMsg] = useState('');
  const [prefilling, setPrefilling] = useState(false);

  useEffect(() => { init(); }, []);

  const init = async () => {
    setLoading(true);
    const [branchRes, productRes, opRes] = await Promise.all([
      supabase.from('outlets').select('name').order('name'),
      supabase.from('products').select('id, name, variant, display_order').order('display_order').order('name'),
      supabase.from('operational_items').select('id, name, display_order').order('display_order').order('name'),
    ]);

    const map = new Map();
    (productRes.data || []).forEach(p => {
      const key = p.variant && p.variant !== 'Standar' ? `${p.name} ${p.variant}` : p.name;
      if (!map.has(key)) map.set(key, { key, dbKey: getStockKey(p), display_order: p.display_order ?? 999 });
    });
    (opRes.data || []).forEach(o => {
      if (!map.has(o.name)) map.set(o.name, { key: o.name, dbKey: o.name, display_order: o.display_order ?? 999 });
    });
    const items = Array.from(map.values()).sort((a, b) =>
      a.display_order !== b.display_order ? a.display_order - b.display_order : a.key.localeCompare(b.key)
    );
    setBaseItems(items);

    setBranches(branchRes.data || []);
    const saved = localStorage.getItem('lastSelectedBranch');
    const branch = (saved && (branchRes.data || []).some(b => b.name === saved))
      ? saved
      : (branchRes.data?.[0]?.name || '');
    setSelectedBranch(branch);
    setPetugas(userData?.name || '');
    if (branch) await loadBranch(branch, items);
    setLoading(false);
  };

  const loadBranch = async (branch, items) => {
    setLoading(true);
    const { data } = await supabase
      .from('branch_inventory')
      .select('item_name, display_qty, tambah_qty, safety_qty')
      .eq('branch_name', branch);
    const inv = {};
    (data || []).forEach(r => { inv[r.item_name] = r; });

    const next = (items || baseItems).map(it => {
      const r = inv[it.dbKey] ?? inv[it.key] ?? {};
      return {
        key: it.key,
        dbKey: it.dbKey,
        oldAwal: r.display_qty ?? 0,
        oldTambah: r.tambah_qty ?? 0,
        oldGudang: r.safety_qty ?? 0,
        awal: '', tambah: '', gudang: '',
      };
    });

    // Restore draft (<= 12 jam)
    try {
      const raw = localStorage.getItem(`koreksi_draft_${branch}`);
      if (raw) {
        const d = JSON.parse(raw);
        if (Date.now() - (d.ts || 0) < 12 * 60 * 60 * 1000 && Array.isArray(d.rows)) {
          const dm = {};
          d.rows.forEach(x => { dm[x.key] = x; });
          next.forEach(row => {
            const x = dm[row.key];
            if (x) { row.awal = x.awal ?? ''; row.tambah = x.tambah ?? ''; row.gudang = x.gudang ?? ''; }
          });
        } else {
          localStorage.removeItem(`koreksi_draft_${branch}`);
        }
      }
    } catch { /* ignore */ }

    setRows(next);
    setLoading(false);
  };

  // Auto-save draft
  useEffect(() => {
    if (!selectedBranch || rows.length === 0 || loading) return;
    const dirty = rows.filter(r => r.awal !== '' || r.tambah !== '' || r.gudang !== '');
    const key = `koreksi_draft_${selectedBranch}`;
    if (dirty.length > 0) {
      localStorage.setItem(key, JSON.stringify({ ts: Date.now(), rows: dirty.map(r => ({ key: r.key, awal: r.awal, tambah: r.tambah, gudang: r.gudang })) }));
    } else {
      localStorage.removeItem(key);
    }
  }, [rows, selectedBranch, loading]);

  const handleBranchChange = (e) => {
    const b = e.target.value;
    setSelectedBranch(b);
    loadBranch(b, baseItems);
  };

  const setField = (key, field, value) => {
    setRows(prev => prev.map(r => r.key === key ? { ...r, [field]: value } : r));
  };

  // --- Tempel dari foto/teks: "Nama | Awal | Tambah | Gudang" ---
  const applyPaste = () => {
    const lines = pasteText.split('\n').map(l => l.trim()).filter(Boolean);
    const byNorm = {};
    rows.forEach(r => { byNorm[norm(r.key)] = r.key; byNorm[norm(r.dbKey)] = r.key; });

    const matchRow = (name) => {
      const n = norm(name);
      if (byNorm[n]) return byNorm[n];
      if (ALIAS_MAP[n] && byNorm[norm(ALIAS_MAP[n])]) return byNorm[norm(ALIAS_MAP[n])];
      const hit = rows.find(r => norm(r.key).includes(n) || n.includes(norm(r.key)));
      return hit?.key || null;
    };

    const updates = {};
    const unmatched = [];
    for (const line of lines) {
      const cells = line.split(/\s*[|;\t]\s*|\s{2,}/).map(c => c.trim()).filter(c => c !== '');
      if (cells.length < 2) continue;
      const name = cells[0];
      const key = matchRow(name);
      if (!key) { unmatched.push(name); continue; }
      const [awal, tambah, gudang] = cells.slice(1);
      updates[key] = {
        ...(awal !== undefined ? { awal } : {}),
        ...(tambah !== undefined ? { tambah } : {}),
        ...(gudang !== undefined ? { gudang } : {}),
      };
    }

    setRows(prev => prev.map(r => updates[r.key] ? { ...r, ...updates[r.key] } : r));
    const n = Object.keys(updates).length;
    setPasteMsg(
      `${n} baris terisi.` + (unmatched.length ? ` Tidak cocok: ${unmatched.join(', ')}` : '')
    );
  };

  // Isi "Stok Awal" (+ Stok Gudang) dari Stok Akhir laporan terakhir cabang ini.
  const fillFromLastClose = async () => {
    if (!selectedBranch || prefilling) return;
    setPrefilling(true);
    setPrefillMsg('Mengambil Stok Akhir terakhir...');
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('sales_reports')
        .select('date, shift, details')
        .eq('branch_name', selectedBranch)
        .lt('date', today)
        .order('date', { ascending: false })
        .order('shift', { ascending: false })
        .limit(1);
      if (error) throw error;
      if (!data || data.length === 0) { setPrefillMsg('Tidak ada laporan sebelum hari ini untuk cabang ini.'); return; }
      const rep = data[0];
      const keyOf = d => (d.variant && d.variant !== 'Standar') ? `${d.name} ${d.variant}` : d.name;
      const close = {};
      for (const d of (rep.details || [])) {
        if (d._is_meta || d._is_inventory_snapshot || d._is_preclose_snapshot || !d.name) continue;
        // Sumber sisa = sama persis dgn Koreksi Laporan & Kartu Stok: sisa_input dulu,
        // fallback ke sisa (kalau staff biarin kosong). Kalau laporan ini pernah
        // dikoreksi lewat Koreksi Laporan, kedua kolom sudah ke-patch di sales_reports
        // ini juga — jadi angkanya pasti ikut yang terkoreksi, tidak beda.
        close[keyOf(d)] = { awal: d.sisa_input ?? d.sisa, gudang: d.safety_remaining };
      }
      const next = rows.map(r => {
        const c = close[r.key] ?? close[r.dbKey];
        if (!c) return r;
        return {
          ...r,
          awal: (c.awal ?? null) !== null ? String(c.awal) : r.awal,
          gudang: (c.gudang ?? null) !== null ? String(c.gudang) : r.gudang,
        };
      });
      const n = next.filter((r, i) => r !== rows[i]).length;
      setRows(next);
      setPrefillMsg(`${n} item terisi dari Stok Akhir ${rep.date} Shift ${rep.shift}. Periksa lalu Simpan.`);
    } catch (err) {
      setPrefillMsg(`Gagal: ${err.message}`);
    } finally {
      setPrefilling(false);
    }
  };

  const preview = useMemo(() => {
    const errors = [];
    const changed = [];
    for (const r of rows) {
      const a = sumExpr(r.awal), t = sumExpr(r.tambah), g = sumExpr(r.gudang);
      if (Number.isNaN(a) || Number.isNaN(t) || Number.isNaN(g)) { errors.push(r.key); continue; }
      if (a === null && t === null && g === null) continue;
      const newAwal = a === null ? r.oldAwal : a;
      const newTambah = t === null ? r.oldTambah : t;
      const newGudang = g === null ? r.oldGudang : g;
      if (newAwal === r.oldAwal && newTambah === r.oldTambah && newGudang === r.oldGudang) continue;
      changed.push({ r, newAwal, newTambah, newGudang });
    }
    return { errors, changed };
  }, [rows]);

  const handleSave = async () => {
    if (preview.errors.length) {
      alert(`Ada input yang tidak terbaca: ${preview.errors.join(', ')}`);
      return;
    }
    if (preview.changed.length === 0) {
      alert('Tidak ada perubahan untuk disimpan.');
      return;
    }
    if (!window.confirm(`Simpan koreksi ${preview.changed.length} item untuk ${selectedBranch}?`)) return;

    setSaving(true);
    try {
      const actor = petugas ? `${petugas} (Koreksi)` : `${userData?.name || 'Admin'} (Koreksi)`;
      const upserts = [];
      const logs = [];
      // Gabungkan baris yang menulis ke item_name (dbKey) yang sama — mis. varian yang
      // di-remap getStockKey. Postgres menolak upsert 2 baris ber-conflict-key sama.
      const byDbKey = new Map();
      for (const c of preview.changed) byDbKey.set(c.r.dbKey, c);
      const mergedChanged = [...byDbKey.values()];
      const dupCount = preview.changed.length - mergedChanged.length;
      for (const { r, newAwal, newTambah, newGudang } of mergedChanged) {
        upserts.push({
          branch_name: selectedBranch,
          item_name: r.dbKey,
          display_qty: newAwal,
          tambah_qty: newTambah,
          safety_qty: newGudang,
          current_qty: newAwal + newGudang,
          updated_at: new Date().toISOString(),
        });
        const logIf = (label, before, after) => {
          if (before !== after) logs.push({
            branch_name: selectedBranch, item_name: r.dbKey,
            qty_added: after - before, qty_before: before, qty_after: after,
            petugas_name: `${actor} [${label}]`,
          });
        };
        logIf('AWAL', r.oldAwal, newAwal);
        logIf('TAMBAH', r.oldTambah, newTambah);
        logIf('GUDANG', r.oldGudang, newGudang);
      }

      const { error } = await supabase.from('branch_inventory').upsert(upserts, { onConflict: 'branch_name,item_name' });
      if (error) throw error;
      if (logs.length) await supabase.from('stock_restock_log').insert(logs);

      localStorage.removeItem(`koreksi_draft_${selectedBranch}`);
      alert(`Koreksi stok berhasil disimpan.${dupCount > 0 ? `\n(${dupCount} baris digabung karena menunjuk item stok yang sama.)` : ''}`);
      await loadBranch(selectedBranch, baseItems);
    } catch (err) {
      alert(`Gagal menyimpan: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const visible = rows.filter(r => r.key.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="animate-fade-in pb-10">
      <div className="page-title flex justify-between items-center" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 className="text-primary mb-1 text-2xl font-black">Penyesuaian Stok</h1>
          <p className="text-muted text-sm">Samakan stok sistem dengan hitungan fisik: Stok Awal, Tambah, Stok Gudang. Dipakai untuk seeding cabang baru, opname berkala, dan koreksi selisih. Penjualan tidak diisi di sini.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => exportPenyesuaianToExcel(rows, selectedBranch, petugas)}
            disabled={loading || rows.length === 0}
            className="btn-secondary"
            style={{ whiteSpace: 'nowrap' }}
          >
            <Icon name="download" size={18} /> Export ke Excel
          </button>
          <button onClick={handleSave} disabled={saving || loading} className="btn-primary" style={{ whiteSpace: 'nowrap' }}>
            <Icon name="save" size={18} /> {saving ? 'Menyimpan...' : `Simpan${preview.changed.length ? ` (${preview.changed.length})` : ''}`}
          </button>
        </div>
      </div>

      {/* Kontrol */}
      <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', borderRadius: '12px' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <Icon name="store" size={18} className="text-muted" />
          <select className="input-field" style={{ marginBottom: 0, maxWidth: '220px' }} value={selectedBranch} onChange={handleBranchChange}>
            {branches.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <Icon name="users" size={18} className="text-muted" />
          <input className="input-field" style={{ marginBottom: 0, maxWidth: '180px' }} placeholder="Petugas" value={petugas} onChange={e => setPetugas(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flex: 1, minWidth: '160px' }}>
          <Icon name="search" size={18} className="text-muted" />
          <input className="input-field" style={{ marginBottom: 0, width: '100%' }} placeholder="Cari item..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="btn-secondary" style={{ whiteSpace: 'nowrap' }} onClick={fillFromLastClose} disabled={prefilling || loading || !selectedBranch}>
          <Icon name="history" size={16} /> {prefilling ? 'Mengambil...' : 'Ambil Stok Akhir Kemarin'}
        </button>
        <button className="btn-secondary" style={{ whiteSpace: 'nowrap' }} onClick={() => setShowPaste(v => !v)}>
          <Icon name="clipboard-check" size={16} /> Tempel dari Foto/Teks
        </button>
        {/* Draft lama (≤12 jam) bisa basi kalau stok sudah berubah sesudahnya — buang semua isian. */}
        <button className="btn-secondary" style={{ whiteSpace: 'nowrap' }} disabled={loading || !rows.some(r => r.awal !== '' || r.tambah !== '' || r.gudang !== '')}
          onClick={() => { if (window.confirm(`Hapus semua isian draft ${selectedBranch}? Stok di sistem tidak berubah.`)) setRows(rs => rs.map(r => ({ ...r, awal: '', tambah: '', gudang: '' }))); }}>
          <Icon name="rotate-ccw" size={16} /> Reset Isian
        </button>
      </div>
      {prefillMsg && <p className="text-muted text-sm" style={{ marginTop: '-0.5rem', marginBottom: '1rem' }}>{prefillMsg}</p>}

      {showPaste && (
        <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1rem', border: '2px solid var(--primary)', borderRadius: '12px' }}>
          <p className="text-muted text-sm mb-2">
            Satu baris per item: <code>Nama | Awal | Tambah | Gudang</code>. Pisah pakai <code>|</code>, <code>;</code>, tab, atau 2+ spasi.
            Angka boleh <code>4+8</code>. Kolom yang tidak diisi boleh dikosongkan.
          </p>
          <textarea
            className="input-field"
            style={{ width: '100%', minHeight: '140px', fontFamily: 'monospace', marginBottom: '0.5rem' }}
            placeholder={'Milo | 24 | 50 | 170\nGula Milk Tea Ori | 10 | | 20\nCup (Flat) | 192+57 | 100 | 900'}
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
          />
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn-primary" onClick={applyPaste} disabled={!pasteText.trim()}>Terapkan ke Tabel</button>
            {pasteMsg && <span className="text-muted text-sm">{pasteMsg}</span>}
          </div>
        </div>
      )}

      <PerbaikiStokDisplay branch={selectedBranch} date={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0]}
        actorName={`${petugas || userData?.name || 'Admin'} (admin)`} onDone={() => loadBranch(selectedBranch, baseItems)} />

      {/* Tabel */}
      <div className="glass-panel table-responsive" style={{ overflowX: 'auto' }}>
        <table className="data-table" style={{ marginTop: 0, minWidth: '720px' }}>
          <thead style={{ backgroundColor: 'rgba(0,0,0,0.03)' }}>
            <tr>
              <th style={{ width: '44px', textAlign: 'center' }}>No</th>
              <th>Nama Produk</th>
              <th style={{ textAlign: 'center', width: '140px' }}>Stok Awal</th>
              <th style={{ textAlign: 'center', width: '140px' }}>Tambah</th>
              <th style={{ textAlign: 'center', width: '140px' }}>Stok Gudang</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center text-muted py-8">Memuat...</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={5} className="text-center text-muted py-8">Tidak ada item.</td></tr>
            ) : visible.map((r, idx) => {
              const cell = (field, oldVal) => {
                const parsed = sumExpr(r[field]);
                const bad = Number.isNaN(parsed);
                return (
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="text"
                      inputMode="text"
                      className="input-field"
                      data-koreksi-cell={`${field}:${idx}`}
                      style={{
                        marginBottom: 0, width: '110px', textAlign: 'center', fontWeight: 600,
                        ...(bad ? { borderColor: 'var(--danger)', color: 'var(--danger)' } : {}),
                      }}
                      placeholder={formatFraction(oldVal) || '0'}
                      value={r[field]}
                      onChange={e => setField(r.key, field, e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const nx = document.querySelector(`[data-koreksi-cell="${field}:${idx + 1}"]`);
                          if (nx) { nx.focus(); nx.select?.(); }
                        }
                      }}
                    />
                    {r[field] !== '' && !bad && parsed !== null && String(parsed) !== r[field].trim() && (
                      <div className="text-muted" style={{ fontSize: '0.7rem' }}>= {formatFraction(parsed)}</div>
                    )}
                  </td>
                );
              };
              return (
                <tr key={r.key}>
                  <td className="text-muted" style={{ textAlign: 'center' }}>{idx + 1}</td>
                  <td style={{ fontWeight: 600 }}>{r.key}</td>
                  {cell('awal', r.oldAwal)}
                  {cell('tambah', r.oldTambah)}
                  {cell('gudang', r.oldGudang)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
