import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import Icon from '../components/Icon';
import { format, parseISO } from 'date-fns';
import { id } from 'date-fns/locale';
import { useLocalStorageBranch } from '../hooks/useLocalStorageBranch';
import { useAuth } from '../contexts/AuthContext';
import { exportStockHistoryToExcel } from '../utils/exportExcel';

export default function AdminStockHistory() {
  const { userData } = useAuth();
  const canDelete = ['admin', 'administrator', 'owner'].includes((userData?.role || '').toLowerCase());
  const [stockLogs, setStockLogs] = useState([]);
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useLocalStorageBranch('Semua Cabang');
  const [logStartDate, setLogStartDate] = useState('');
  const [logEndDate, setLogEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [logFilter, setLogFilter] = useState('all');
  // Default: sembunyikan aktivitas dari laporan yang dihapus (biar Riwayat bersih).
  // Uncheck buat investigasi. Pilihan diingat per-browser.
  const [hideVoided, setHideVoided] = useState(() => {
    try { return localStorage.getItem('stockHistory_hideVoided') !== '0'; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem('stockHistory_hideVoided', hideVoided ? '1' : '0'); } catch { /* ignore */ }
  }, [hideVoided]);

  useEffect(() => {
    fetchBranches();
  }, []);

  const fetchBranches = async () => {
    try {
      const { data } = await supabase.from('outlets').select('name').order('name');
      setBranches(data || []);
      const savedBranch = localStorage.getItem('lastSelectedBranch') || 'Semua Cabang';
      fetchLogs(savedBranch);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchLogs = async (branchName, startDate = logStartDate, endDate = logEndDate) => {
    setLoading(true);
    const buildQuery = () => {
      let query = supabase
        .from('stock_restock_log')
        .select('*')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });
      if (branchName !== 'Semua Cabang') query = query.eq('branch_name', branchName);
      // Konversi ke ISO biar batas hari pakai jam lokal (WIB), bukan UTC.
      if (startDate) query = query.gte('created_at', new Date(`${startDate}T00:00:00`).toISOString());
      if (endDate) query = query.lte('created_at', new Date(`${endDate}T23:59:59.999`).toISOString());
      return query;
    };

    // Tanpa filter tanggal: 300 terbaru cukup. Dengan range: ambil SEMUA baris per halaman
    // 1000 (batas Supabase), kalau ngga hari-hari awal range kepotong limit.
    let rows = [];
    if (!startDate && !endDate) {
      const { data } = await buildQuery().limit(300);
      rows = data || [];
    } else {
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await buildQuery().range(from, from + PAGE - 1);
        if (error || !data) break;
        rows = rows.concat(data);
        if (data.length < PAGE) break;
      }
    }
    setStockLogs(rows);
    setLoading(false);
  };

  const handleBranchChange = (e) => {
    const branch = e.target.value;
    setSelectedBranch(branch);
    fetchLogs(branch);
  };

  // Hapus SATU baris log. Ini cuma catatan audit — stok (branch_inventory) TIDAK ikut berubah.
  // Dipakai buang entri hantu (mis. "X di kurasi" dari sesi lama yang nyangkut di Kartu Stok).
  // "Status Aktivitas" = penanda Buka/Tutup Shift — dipakai buat hitung window shift di Excel.
  // Jangan boleh dihapus, bisa bikin kolom Tambah/Pindah Kartu Stok melenceng.
  const isDeletableLog = (log) => canDelete && log.item_name !== 'Status Aktivitas';

  const handleDeleteLog = async (log) => {
    if (!isDeletableLog(log)) return;
    const ok = window.confirm(
      `Hapus baris log ini?\n\n${log.item_name} — ${log.qty_added > 0 ? '+' : ''}${log.qty_added}\n${log.petugas_name}\n${formatTime(log.created_at)}\n\n` +
      `Hanya menghapus CATATAN aktivitas. Stok cabang TIDAK berubah. Tidak bisa dibatalkan.`
    );
    if (!ok) return;
    const { error } = await supabase.from('stock_restock_log').delete().eq('id', log.id);
    if (error) { alert(`Gagal hapus: ${error.message}`); return; }
    setStockLogs(prev => prev.filter(l => l.id !== log.id));
  };

  const formatTime = (ts) => {
    if (!ts) return '';
    try {
      return format(parseISO(ts), 'dd MMMM yyyy, HH:mm', { locale: id });
    } catch (e) {
      const d = new Date(ts);
      return d.toLocaleString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
  };

  // Kurasi kepake beberapa istilah beda di log tergantung jalurnya: "Kurasi/Buang" (drawer
  // staff / Kelola Stok Pusat langsung), "Ditarik Gudang" (jalur ACC lama). Cek semuanya,
  // bukan cuma kata "kurasi" — kalau ngga entri "Ditarik Gudang" ilang dari filter Kurasi.
  const isCurationLog = (petugasNameLower) =>
    petugasNameLower.includes('kurasi') || petugasNameLower.includes('ditarik gudang') || petugasNameLower.includes('buang');

  // Aktivitas yang laporannya sudah dihapus -> ditandai "[LAPORAN DIHAPUS ...]" waktu hapus laporan.
  const isVoidedLog = (log) => {
    const p = log.petugas_name || '';
    return p.includes('[LAPORAN DIHAPUS') || p.includes('[SESI LAMA');
  };

  const filteredLogs = stockLogs.filter(log => {
    const petugasName = (log.petugas_name || '').toLowerCase();
    if (hideVoided && isVoidedLog(log)) return false;

    if (logFilter === 'status') return log.item_name === 'Status Aktivitas';
    if (logFilter === 'deduction') return log.qty_added < 0 && log.item_name !== 'Status Aktivitas' && !petugasName.includes('oper ke') && !isCurationLog(petugasName);
    if (logFilter === 'addition') return log.qty_added > 0 && log.item_name !== 'Status Aktivitas' && !petugasName.includes('operan dari');
    if (logFilter === 'transfer') return petugasName.includes('oper ke') || petugasName.includes('operan dari');
    if (logFilter === 'curation') return isCurationLog(petugasName);
    return true;
  });

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="page-title flex justify-between items-center">
        <div>
          <h1 className="text-primary mb-1">Riwayat Aktivitas Stok</h1>
          <p className="text-muted">Pantau semua histori penambahan, pengurangan, dan aktivitas operasional stok dari berbagai cabang secara realtime.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="glass-panel" style={{ padding: '1.25rem', marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

        {/* Row 1: Cabang & Tanggal */}
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: '1 1 300px' }}>
            <Icon name="store" size={18} className="text-primary hidden-mobile" />
            <select className="input-field" style={{ width: '100%', marginBottom: 0 }} value={selectedBranch} onChange={handleBranchChange}>
              <option value="Semua Cabang">Semua Cabang</option>
              {branches.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: '1 1 300px' }}>
            <Icon name="calendar" size={18} className="text-muted hidden-mobile" />
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
              <input
                type="date"
                className="input-field"
                style={{ width: '100%', padding: '0.4rem 0.6rem', marginBottom: 0 }}
                value={logStartDate}
                onChange={(e) => setLogStartDate(e.target.value)}
              />
              <span className="text-muted" style={{ fontSize: '0.9rem' }}>s/d</span>
              <input
                type="date"
                className="input-field"
                style={{ width: '100%', padding: '0.4rem 0.6rem', marginBottom: 0 }}
                value={logEndDate}
                onChange={(e) => setLogEndDate(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Row 2: Status Filters & Action Buttons */}
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', flex: '1 1 auto' }}>
            {[
              { id: 'all', label: 'Semua', icon: null },
              { id: 'addition', label: 'Masuk', icon: <Icon name="arrow-down-right" size={14} /> },
              { id: 'deduction', label: 'Keluar', icon: <Icon name="arrow-up-right" size={14} /> },
              { id: 'transfer', label: 'Operan', icon: <Icon name="refresh" size={14} /> },
              { id: 'curation', label: 'Kurasi', icon: <Icon name="alert-triangle" size={14} /> },
              { id: 'status', label: 'Aktivitas Shift', icon: <Icon name="activity" size={14} /> }
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setLogFilter(f.id)}
                style={{
                  padding: '0.4rem 0.8rem',
                  borderRadius: '8px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  flex: '1 1 auto',
                  justifyContent: 'center',
                  border: logFilter === f.id ? 'none' : '1px solid var(--border-color)',
                  backgroundColor: logFilter === f.id ? 'var(--text-main)' : 'transparent',
                  color: logFilter === f.id ? 'white' : 'var(--text-muted)'
                }}
              >
                {f.icon} {f.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '1rem', flex: '0 0 auto', marginLeft: 'auto', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={hideVoided} onChange={e => setHideVoided(e.target.checked)} />
              Sembunyikan aktivitas laporan dihapus
            </label>
            {(logStartDate || logEndDate) && (
              <button
                onClick={() => { setLogStartDate(''); setLogEndDate(''); fetchLogs(selectedBranch, '', ''); }}
                style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 600 }}
              >
                Reset
              </button>
            )}
            <button
              onClick={() => fetchLogs(selectedBranch)}
              className="btn-secondary"
              style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }}
            >
              <Icon name="filter" size={16} /> Terapkan
            </button>
            <button
              onClick={() => exportStockHistoryToExcel(filteredLogs, selectedBranch, logStartDate, logEndDate)}
              className="btn-secondary"
              style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', backgroundColor: 'var(--lime)', color: 'var(--lime-ink)', borderColor: 'transparent' }}
            >
              <Icon name="download" size={16} /> Export Excel
            </button>
          </div>
        </div>
      </div>

      {/* Desktop View */}
      <div className="glass-panel table-responsive desktop-only" style={{ overflowX: 'auto', overflowY: 'hidden' }}>
        <table className="data-table" style={{ marginTop: 0, minWidth: '800px' }}>
          <thead style={{ backgroundColor: 'rgba(0,0,0,0.02)' }}>
            <tr>
              <th style={{ width: '170px' }}>Waktu</th>
              <th style={{ width: '150px' }}>Cabang</th>
              <th>Nama Item</th>
              <th>Petugas / Keterangan</th>
              <th className="text-center">Stok Awal</th>
              <th className="text-center">Perubahan</th>
              <th className="text-center">Sisa Stok</th>
              {canDelete && <th className="text-center" style={{ width: '50px' }}></th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={canDelete ? 8 : 7} className="text-center text-muted py-8">Memuat riwayat aktivitas...</td></tr>
            ) : filteredLogs.length === 0 ? (
              <tr><td colSpan={canDelete ? 8 : 7} className="text-center text-muted py-8">Belum ada riwayat aktivitas yang sesuai filter.</td></tr>
            ) : filteredLogs.map(log => {
              const isAddition = log.qty_added > 0;
              const petugasName = (log.petugas_name || '').toLowerCase();
              const isOpening = petugasName.includes('buka');
              const isClosing = petugasName.includes('tutup');
              const isTransferOut = petugasName.includes('oper ke');
              const isTransferIn = petugasName.includes('operan dari');
              const isCuration = isCurationLog(petugasName);
              const isManualAdd = isAddition && !isOpening && !isClosing && !isTransferIn && !log.item_name?.includes('Aktivitas');

              const isVoided = isVoidedLog(log);
              let rowStyle = {};
              if (isManualAdd) rowStyle = { backgroundColor: 'rgba(52, 199, 89, 0.05)', borderLeft: '3px solid var(--primary)' };
              else if (isOpening) rowStyle = { backgroundColor: 'rgba(255, 204, 0, 0.08)' };
              else if (isClosing) rowStyle = { backgroundColor: 'rgba(255, 56, 60, 0.05)' };
              else if (isTransferOut || isTransferIn) rowStyle = { backgroundColor: 'rgba(13, 111, 255, 0.05)', borderLeft: '3px solid #0d6fff' };
              else if (isCuration) rowStyle = { backgroundColor: 'rgba(255, 149, 0, 0.05)', borderLeft: '3px solid #ff9500' };
              if (isVoided) rowStyle = { ...rowStyle, opacity: 0.45, textDecoration: 'line-through', backgroundColor: 'rgba(142,142,147,0.06)', borderLeft: '3px solid #8e8e93' };

              return (
                <tr key={log.id} style={rowStyle}>
                  <td className="text-muted" style={{ fontSize: '0.85rem' }}>{formatTime(log.created_at)}</td>
                  <td style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-muted)' }}>{log.branch_name}</td>
                  <td style={{ fontWeight: 600 }}>{log.item_name}</td>
                  <td style={{ fontSize: '0.85rem' }}>
                    {isManualAdd ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span style={{
                          backgroundColor: 'rgba(52, 199, 89,0.15)', color: 'var(--primary)',
                          padding: '0.1rem 0.45rem', borderRadius: '5px', fontSize: '0.7rem', fontWeight: 800
                        }}>MASUK</span>
                        <span style={{ fontWeight: 600 }}>{log.petugas_name}</span>
                      </div>
                    ) : isTransferOut || isTransferIn ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span style={{
                          backgroundColor: 'rgba(13, 111, 255, 0.15)', color: '#0d6fff',
                          padding: '0.1rem 0.45rem', borderRadius: '5px', fontSize: '0.7rem', fontWeight: 800
                        }}>OPERAN</span>
                        {(() => {
                          let cleanName = log.petugas_name;
                          let target = null;
                          const outMatch = log.petugas_name?.match(/(.+?)\s*\(Oper ke (.+?)\)/i);
                          const inMatch = log.petugas_name?.match(/(.+?)\s*\(Operan dari (.+?)\)/i);
                          if (outMatch) { cleanName = outMatch[1]; target = `→ Ke: ${outMatch[2]}`; }
                          else if (inMatch) { cleanName = inMatch[1]; target = `← Dari: ${inMatch[2]}`; }

                          return (
                            <>
                              <span style={{ fontWeight: 600 }}>{cleanName}</span>
                              {target && (
                                <span style={{
                                  backgroundColor: isTransferOut ? 'rgba(52, 199, 89, 0.1)' : 'rgba(255, 149, 0, 0.1)',
                                  color: isTransferOut ? 'var(--primary)' : '#c2410c',
                                  padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700
                                }}>
                                  {target}
                                </span>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    ) : isCuration ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span style={{
                          backgroundColor: 'rgba(255, 149, 0, 0.15)', color: '#c2410c',
                          padding: '0.1rem 0.45rem', borderRadius: '5px', fontSize: '0.7rem', fontWeight: 800
                        }}>KURASI</span>
                        <span style={{ fontWeight: 600 }}>{log.petugas_name}</span>
                      </div>
                    ) : isOpening ? (
                      <span style={{ color: '#9a3412', fontWeight: 700 }}>{log.petugas_name}</span>
                    ) : isClosing ? (
                      <span style={{ color: 'var(--danger)', fontWeight: 700 }}>{log.petugas_name}</span>
                    ) : (
                      <span className="text-muted">{log.petugas_name}</span>
                    )}
                  </td>
                  <td className="text-center text-muted">{log.qty_before}</td>
                  <td className="text-center">
                    <span style={{
                      display: 'inline-block', minWidth: '60px', padding: '0.2rem 0', borderRadius: '4px',
                      backgroundColor: isAddition ? 'rgba(52, 199, 89,0.12)' : 'rgba(255, 56, 60,0.1)',
                      color: isAddition ? 'var(--primary)' : 'var(--danger)',
                      fontWeight: 700, fontSize: '0.9rem'
                    }}>
                      {isAddition ? '+' : ''}{log.qty_added}
                    </span>
                  </td>
                  <td className="text-center" style={{ fontWeight: 700, fontSize: '1rem' }}>{log.qty_after}</td>
                  {canDelete && (
                    <td className="text-center">
                      {isDeletableLog(log) && (
                        <button
                          onClick={() => handleDeleteLog(log)}
                          title="Hapus baris log ini (stok tidak berubah)"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '0.25rem', display: 'inline-flex' }}
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View */}
      <div className="mobile-only" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingBottom: '1rem' }}>
        {loading ? (
          <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
            <p className="text-muted">Memuat riwayat aktivitas...</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
            <p className="text-muted">Belum ada riwayat aktivitas yang sesuai filter.</p>
          </div>
        ) : filteredLogs.map(log => {
          const isAddition = log.qty_added > 0;
          const petugasName = (log.petugas_name || '').toLowerCase();
          const isOpening = petugasName.includes('buka');
          const isClosing = petugasName.includes('tutup');
          const isTransferOut = petugasName.includes('oper ke');
          const isTransferIn = petugasName.includes('operan dari');
          const isCuration = isCurationLog(petugasName);
          const isManualAdd = isAddition && !isOpening && !isClosing && !isTransferIn && !log.item_name?.includes('Aktivitas');

          const isVoided = isVoidedLog(log);
          return (
            <div key={log.id} className="glass-panel" style={{
              padding: '1rem',
              borderLeft: isVoided ? '4px solid #8e8e93' : isManualAdd ? '4px solid var(--primary)' : isTransferOut || isTransferIn ? '4px solid #0d6fff' : isCuration ? '4px solid #ff9500' : isOpening ? '4px solid #ff9500' : isClosing ? '4px solid var(--danger)' : '1px solid var(--border-color)',
              backgroundColor: isManualAdd ? 'rgba(52, 199, 89, 0.03)' : isTransferOut || isTransferIn ? 'rgba(13, 111, 255, 0.03)' : isCuration ? 'rgba(255, 149, 0, 0.03)' : isOpening ? 'rgba(255, 204, 0, 0.03)' : isClosing ? 'rgba(255, 56, 60, 0.03)' : 'var(--panel-bg)',
              borderRadius: '12px',
              opacity: isVoided ? 0.5 : 1,
              textDecoration: isVoided ? 'line-through' : 'none'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                <div>
                  <p style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-main)', marginBottom: '0.15rem' }}>{log.item_name}</p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{formatTime(log.created_at)}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{
                    display: 'inline-block', padding: '0.15rem 0.5rem', borderRadius: '6px',
                    backgroundColor: isAddition ? 'rgba(52, 199, 89,0.1)' : 'rgba(255, 56, 60,0.1)',
                    color: isAddition ? 'var(--primary)' : 'var(--danger)',
                    fontWeight: 800, fontSize: '0.95rem'
                  }}>
                    {isAddition ? '+' : ''}{log.qty_added}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', backgroundColor: '#f2f2f7', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                  {log.branch_name}
                </span>
                {isManualAdd ? (
                  <span style={{ backgroundColor: 'rgba(52, 199, 89,0.15)', color: 'var(--primary)', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 800 }}>MASUK</span>
                ) : isTransferOut || isTransferIn ? (
                  <span style={{ backgroundColor: 'rgba(13, 111, 255, 0.15)', color: '#0d6fff', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 800 }}>OPERAN</span>
                ) : isCuration ? (
                  <span style={{ backgroundColor: 'rgba(255, 149, 0, 0.15)', color: '#c2410c', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 800 }}>KURASI</span>
                ) : isOpening ? (
                  <span style={{ color: '#9a3412', display: 'inline-flex' }}><Icon name="unlock" size={13} /></span>
                ) : isClosing && (
                  <span style={{ color: 'var(--danger)', display: 'inline-flex' }}><Icon name="lock" size={13} /></span>
                )}

                {(() => {
                  let cleanName = log.petugas_name;
                  let target = null;
                  const outMatch = log.petugas_name?.match(/(.+?)\s*\(Oper ke (.+?)\)/i);
                  const inMatch = log.petugas_name?.match(/(.+?)\s*\(Operan dari (.+?)\)/i);
                  if (outMatch) { cleanName = outMatch[1]; target = `→ Ke: ${outMatch[2]}`; }
                  else if (inMatch) { cleanName = inMatch[1]; target = `← Dari: ${inMatch[2]}`; }

                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-main)', fontWeight: 600 }}>{cleanName}</span>
                      {target && (
                        <span style={{
                          backgroundColor: isTransferOut ? 'rgba(52, 199, 89, 0.1)' : 'rgba(255, 149, 0, 0.1)',
                          color: isTransferOut ? 'var(--primary)' : '#c2410c',
                          padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700
                        }}>
                          {target}
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f2f2f7', padding: '0.6rem 0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <div style={{ textAlign: 'center', flex: 1 }}>
                  <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px', marginBottom: '0.1rem' }}>Stok Awal</p>
                  <p style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-muted)' }}>{log.qty_before}</p>
                </div>
                <div style={{ color: 'var(--border-color)', fontWeight: 'bold' }}>→</div>
                <div style={{ textAlign: 'center', flex: 1 }}>
                  <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px', marginBottom: '0.1rem' }}>Sisa Stok</p>
                  <p style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--primary)' }}>{log.qty_after}</p>
                </div>
              </div>

              {isDeletableLog(log) && (
                <button
                  onClick={() => handleDeleteLog(log)}
                  style={{ marginTop: '0.75rem', width: '100%', background: 'none', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: '8px', padding: '0.45rem', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}
                >
                  <Icon name="trash" size={14} /> Hapus baris log ini
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
