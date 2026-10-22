import React, { useState, useEffect } from 'react';
import Icon from '../components/Icon';
import { supabase } from '../supabase';
import { useLocalStorageBranch } from '../hooks/useLocalStorageBranch';
import { useAuth } from '../contexts/AuthContext';
import { exportMultipleShiftsToExcel } from '../utils/exportExcel';
import { downloadShiftReport } from '../utils/downloadShiftReport';
import { format, parseISO } from 'date-fns';
import { id } from 'date-fns/locale';

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  try {
    return format(parseISO(dateStr), 'dd MMMM yyyy', { locale: id });
  } catch (e) {
    return dateStr;
  }
};

// ── ShiftRow: baris per shift dalam kartu tanggal ──────────────────
const ShiftRow = ({ record, shiftLabel, detailRecord, setDetailRecord, handleDownloadDetail, handleDelete }) => {
  if (!record) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem 1.25rem', opacity: 0.4 }}>
      <span style={{ backgroundColor: 'rgba(0,0,0,0.06)', color: 'var(--text-muted)', padding: '0.15rem 0.55rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, minWidth: '58px', textAlign: 'center' }}>
        {shiftLabel}
      </span>
      <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Belum ada laporan</span>
    </div>
  );

  const isActive = detailRecord?.id === record.id;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '1rem',
      padding: '0.75rem 1.25rem',
      backgroundColor: isActive ? 'rgba(52, 199, 89,0.05)' : 'transparent',
      transition: 'background 0.2s'
    }}>
      <span style={{
        backgroundColor: 'var(--text-main)', color: 'white',
        padding: '0.15rem 0.55rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700,
        minWidth: '58px', textAlign: 'center', flexShrink: 0
      }}>
        Shift {record.shift}
      </span>
      <span style={{ fontSize: '0.85rem', fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {record.staff_name}
      </span>
      <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
        {record.cash_akhir !== null
          ? `Rp ${(record.total_revenue || 0).toLocaleString('id-ID')}`
          : <span style={{ color: '#9a3412', fontStyle: 'italic', fontSize: '0.78rem' }}>Ongoing...</span>
        }
      </span>
      {record.cash_akhir !== null
        ? <span style={{ backgroundColor: 'var(--lime)', color: 'var(--lime-ink)', padding: '0.15rem 0.45rem', borderRadius: '5px', fontSize: '0.7rem', fontWeight: 700, flexShrink: 0 }}>SELESAI</span>
        : <span style={{ backgroundColor: 'rgba(255, 204, 0,0.15)', color: '#9a3412', padding: '0.15rem 0.45rem', borderRadius: '5px', fontSize: '0.7rem', fontWeight: 700, flexShrink: 0 }}>AKTIF</span>
      }
      <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
        <button
          onClick={() => setDetailRecord(isActive ? null : record)}
          className="btn-secondary"
          style={{ padding: '0.35rem', borderColor: 'transparent', backgroundColor: isActive ? 'var(--primary)' : undefined, color: isActive ? 'white' : 'var(--text-muted)' }}
          title="Lihat Detail"
        >
          <Icon name="eye" size={15} />
        </button>
        <button onClick={() => handleDownloadDetail(record)} className="btn-secondary"
          style={{ padding: '0.35rem', color: 'var(--primary)', borderColor: 'transparent' }} title="Download Excel">
          <Icon name="file" size={15} />
        </button>
        <button onClick={() => handleDelete(record)} className="btn-secondary"
          style={{ padding: '0.35rem', color: 'var(--danger)', borderColor: 'transparent' }} title="Hapus">
          <Icon name="trash" size={15} />
        </button>
      </div>
    </div>
  );
};

export default function AdminPOS() {
  const { userData } = useAuth();
  const [salesRecord, setSalesRecord] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterBranch, setFilterBranch] = useLocalStorageBranch('');
  const [branches, setBranches] = useState([]);
  const [delModalOpen, setDelModalOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null);
  const [saving, setSaving] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [detailRecord, setDetailRecord] = useState(null);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const { data: bData } = await supabase.from('outlets').select('name');
      if (bData) setBranches(bData);
      const { data: sData, error } = await supabase.from('sales_reports').select('*').order('id', { ascending: false });
      if (error) throw error;
      setSalesRecord(sData || []);
    } catch (error) {
      console.error('Error fetching sales reports:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    const filtered = getFilteredData();
    if (filtered.length === 0) { alert('Tidak ada data untuk diekspor.'); return; }
    exportMultipleShiftsToExcel(filtered);
  };

  const getFilteredData = () => salesRecord.filter(r => {
    const matchBranch = filterBranch ? r.branch_name === filterBranch : true;
    const matchStart  = startDate ? r.date >= startDate : true;
    const matchEnd    = endDate   ? r.date <= endDate   : true;
    return matchBranch && matchStart && matchEnd;
  });

  const handleDelete = (report) => {
    setSelectedReport(report);
    setDelModalOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const confirmDelete = async () => {
    if (!selectedReport) return;
    setSaving(true);
    try {
      // 1. Fetch related stock logs for this shift on this date to revert inventory
      const targetDate = selectedReport.date;
      const shiftNo = String(selectedReport.shift);
      const shiftStr = `Shift ${shiftNo}`;
      const branchName = selectedReport.branch_name;
      const DEL_TAG = `[LAPORAN DIHAPUS ${targetDate} S${shiftNo}]`;

      const { data: dayLogs } = await supabase
        .from('stock_restock_log')
        .select('*')
        .eq('branch_name', branchName)
        .gte('created_at', `${targetDate}T00:00:00`)
        .lte('created_at', `${targetDate}T23:59:59`)
        .order('created_at', { ascending: true });
      const allDayLogs = dayLogs || [];

      // Batas waktu shift: dari "Buka Input Shift N" s/d "Tutup Shift N" (atau "Buka Shift N+1")
      const openLog = allDayLogs.find(l => l.item_name === 'Status Aktivitas' && /buka/i.test(l.petugas_name || '') && (l.petugas_name || '').includes(`Shift ${shiftNo}`));
      const closeLog = allDayLogs.find(l => l.item_name === 'Status Aktivitas' && /tutup/i.test(l.petugas_name || '') && (l.petugas_name || '').includes(`Shift ${shiftNo}`));
      const nextOpen = shiftNo === '1' ? allDayLogs.find(l => l.item_name === 'Status Aktivitas' && /buka/i.test(l.petugas_name || '') && (l.petugas_name || '').includes('Shift 2')) : null;
      const winLo = openLog ? new Date(openLog.created_at).getTime() : new Date(`${targetDate}T00:00:00`).getTime();
      const winHi = (closeLog || nextOpen) ? new Date((closeLog || nextOpen).created_at).getTime() : new Date(`${targetDate}T23:59:59`).getTime();

      const inWindow = (l) => { const t = new Date(l.created_at).getTime(); return t >= winLo && t <= winHi; };
      const isShiftOp = (l) => {
        const p = (l.petugas_name || '');
        return p.includes('(Kurasi/Buang)') || p.includes('Ditarik Gudang') || p.includes('(Pindah ke Display)')
          || p.includes('(Pindah ke Laci)') || p.includes('(ACC:') || p.includes('[DISPLAY]') || p.includes('[GUDANG] Kiriman')
          || p.includes('Auto-Deduct');
      };

      // Logs yang jelas milik shift ini (nama ber-"Shift N") -> revert Auto-Deduct + hapus, spt sebelumnya
      const shiftLogs = allDayLogs.filter(l => (l.petugas_name || '').includes(shiftStr));
      if (shiftLogs.length > 0) {
        const revertPromises = [];
        for (const log of shiftLogs) {
          // Balikin yang BENERAN kepotong (qty_before − qty_after), bukan qty terjual: display
          // di-clamp ke 0, jadi terjual 147 dari stok 0 = potong 0. Baris SELISIH cuma catatan
          // (log lama masih ber-qty negatif) — dulu ikut di-revert → stok balik dobel.
          const actualCut = (Number(log.qty_before) || 0) - (Number(log.qty_after) || 0);
          if (log.petugas_name.includes('Auto-Deduct') && !log.petugas_name.includes('SELISIH') && log.qty_added < 0 && actualCut > 0.001) {
            const { data: currentInv } = await supabase
              .from('branch_inventory').select('current_qty')
              .eq('branch_name', branchName).eq('item_name', log.item_name).single();
            if (currentInv) {
              revertPromises.push(
                supabase.from('branch_inventory').update({
                  current_qty: currentInv.current_qty + actualCut
                }).eq('branch_name', branchName).eq('item_name', log.item_name)
              );
            }
          }
        }
        await Promise.all(revertPromises);
        await supabase.from('stock_restock_log').delete().in('id', shiftLogs.map(l => l.id));
      }

      // Kurasi / Pindah / ACC / Kiriman di window shift ini yang TIDAK ber-"Shift N":
      // jangan hapus & jangan utak stok (itu kejadian fisik), tapi TANDAI biar kebaca di Riwayat.
      const strayIds = allDayLogs
        .filter(l => l.item_name !== 'Status Aktivitas')
        .filter(l => !(l.petugas_name || '').includes(shiftStr))
        .filter(l => !(l.petugas_name || '').includes('[LAPORAN DIHAPUS'))
        .filter(l => inWindow(l) && isShiftOp(l))
        .map(l => ({ id: l.id, petugas_name: `${l.petugas_name} — ${DEL_TAG}` }));
      for (const s of strayIds) {
        await supabase.from('stock_restock_log').update({ petugas_name: s.petugas_name }).eq('id', s.id);
      }

      // Divider biar batas terlihat jelas di Riwayat Aktivitas Stok
      const adminName = userData?.name ? `${userData.name} (${userData.role || 'admin'})` : 'Admin';
      await supabase.from('stock_restock_log').insert([{
        branch_name: branchName, item_name: 'Status Aktivitas', qty_added: 0, qty_before: 0, qty_after: 0,
        petugas_name: `${adminName} (Laporan ${shiftStr} ${targetDate} DIHAPUS — ${strayIds.length} aktivitas shift ditandai batal; stok tidak diubah)`,
      }]);

      // 2. Delete the actual report
      const { data, error } = await supabase.from('sales_reports').delete().eq('id', selectedReport.id).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Penghapusan diblokir oleh sistem database (RLS). Tambahkan policy DELETE di Supabase.');
      
      setSalesRecord(prev => prev.filter(r => r.id !== selectedReport.id));
      if (detailRecord?.id === selectedReport.id) setDetailRecord(null);
      setDelModalOpen(false);
      setSelectedReport(null);
      alert('Laporan dihapus. Potongan penjualan (Auto-Deduct) dikembalikan ke stok. Aktivitas fisik shift (kurasi, pindah, kiriman) TIDAK diubah, cuma ditandai "[LAPORAN DIHAPUS]" di Riwayat Aktivitas Stok.');
    } catch (err) {
      alert('Gagal menghapus laporan:\n' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadDetail = (record) => downloadShiftReport(record, salesRecord);

  const getDailyTotal = (record) => {
    if (String(record.shift) === '1') return record.total_revenue;
    const shift1 = salesRecord.find(r => r.branch_name === record.branch_name && r.date === record.date && String(r.shift) === '1');
    return shift1 ? (record.total_revenue || 0) + (shift1.total_revenue || 0) : record.total_revenue;
  };

  const displayRecords = getFilteredData();

  // Group records by date + branch, sorted newest first
  const groupedByDate = displayRecords.reduce((acc, record) => {
    const key = `${record.date}__${record.branch_name}`;
    if (!acc[key]) acc[key] = { date: record.date, branch: record.branch_name, shifts: {} };
    acc[key].shifts[record.shift] = record;
    return acc;
  }, {});

  // Sort groups: newest date first, then by branch name
  const sortedGroups = Object.values(groupedByDate).sort((a, b) => {
    if (b.date !== a.date) return b.date.localeCompare(a.date);
    return a.branch.localeCompare(b.branch);
  });

  // ── Detail Panel Renderer ──────────────────────────────────────
  const renderDetailPanel = () => {
    if (!detailRecord) return null;
    const r        = detailRecord;
    const allDetails = r.details || [];
    const metaDetail = allDetails.find(d => d._is_meta);
    const allProductDetails = allDetails.filter(d => !d._is_meta && !d._is_inventory_snapshot);
    // Untuk tampilan UI: hanya tampilkan produk yang terjual
    const details  = allProductDetails.filter(d => (parseInt(d.qty) || 0) > 0 || (parseInt(d.total_fisik) || 0) > 0 || (parseInt(d.porsi_terpakai) || 0) > 0);
    // Rincian porsi Bubble (dibuka, terjual, rusak/buang, sisa) — beda dari Rincian Penjualan
    // yang cuma nunjukin jumlah bungkus dibuka, bukan porsi yang kejual.
    const bubbleDetails = allProductDetails.filter(d => d.name && d.name.toLowerCase().includes('bubble') &&
      ((parseInt(d.total_fisik) || 0) > 0 || (parseInt(d.porsi_terpakai) || 0) > 0 || (parseInt(d.porsi_rusak) || 0) > 0 || (parseInt(d.porsi_sisa) || 0) > 0));
    const expenses = r.expenses || [];
    const stocks   = r.stocks   || [];
    const cashAwal  = r.cash_awal      || 0;
    const totalRev  = r.total_revenue  || 0;
    const totalExp  = r.total_expense  || 0;
    const cashAkhir = r.cash_akhir ?? (cashAwal + totalRev - totalExp);
    
    const setoranAktual = metaDetail ? metaDetail.setoran_aktual : r.setoran_aktual;
    const selisihInfo = metaDetail ? metaDetail.selisih : r.selisih;

    // Group by product name (variants share same name)
    const byName = details.reduce((acc, item) => {
      const key = item.name || 'Lainnya';
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});

    const variantColor = (v) => ({
      bg:   v === 'Ori' ? 'rgba(255, 204, 0,0.2)' : v === 'Premi' ? 'rgba(13, 111, 255,0.15)' : 'rgba(255, 45, 85,0.15)',
      text: v === 'Ori' ? '#c2410c'              : v === 'Premi' ? '#0d6fff'               : '#ff2d55',
    });

    return (
      <div className="glass-panel animate-fade-in" style={{ marginTop: '1.5rem', padding: '1.5rem', border: '2px solid rgba(52, 199, 89,0.3)' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--primary)', marginBottom: '0.25rem' }}>
              Detail Laporan Shift {r.shift} — {r.branch_name}
            </h2>
            <p className="text-muted" style={{ fontSize: '0.82rem' }}>
              {formatDate(r.date)} &nbsp;|&nbsp; {r.staff_name}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button onClick={() => handleDownloadDetail(r)} className="btn-secondary"
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--primary)' }}>
              <Icon name="file" size={15} /> Unduh Excel
            </button>
            <button onClick={() => setDetailRecord(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
              <Icon name="close" size={20} />
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem', alignItems: 'start' }}>

          {/* LEFT: Produk Terjual */}
          <div style={{ border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden' }}>
            <div style={{ backgroundColor: 'rgba(9,108,70,0.06)', padding: '0.6rem 1rem', borderBottom: '1px solid var(--border-color)' }}>
              <h3 style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--primary)' }}>Rincian Penjualan</h3>
            </div>

            {details.length === 0 ? (
              <div style={{ padding: '1.5rem', textAlign: 'center' }}>
                <p className="text-muted" style={{ fontSize: '0.85rem' }}>Tidak ada data produk terjual.</p>
              </div>
            ) : (
              Object.entries(byName).map(([productName, variants]) => (
                <div key={productName}>
                  <div style={{ padding: '0.4rem 0.75rem', backgroundColor: '#f2f2f7', borderBottom: '1px solid var(--border-color)', fontWeight: 700, fontSize: '0.88rem' }}>
                    {productName}
                  </div>
                  {variants.map((item, idx) => {
                    const isLast    = idx === variants.length - 1;
                    const isStandar = !item.variant || item.variant === 'Standar';
                    const vc        = variantColor(item.variant);
                    // Bubble dijual per PORSI terpakai (qty = bungkus dibuka, bisa 0 di Shift 2
                    // yang cuma lanjut porsi S1). Harga fallback 2000 = sama kayak hitungan BranchPOS.
                    const isBubble  = item.name.toLowerCase().includes('bubble');
                    const shownQty  = isBubble ? (parseInt(item.porsi_terpakai) || 0) : item.qty;
                    const shownPrice = isBubble ? (parseInt(item.price) || 2000) : (item.price || 0);
                    return (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.45rem 0.75rem', borderBottom: isLast ? 'none' : '1px dashed var(--border-color)', backgroundColor: 'white' }}>
                        {!isStandar ? (
                          <span style={{ padding: '0.12rem 0.45rem', borderRadius: '5px', fontSize: '0.7rem', fontWeight: 700, minWidth: '46px', textAlign: 'center', backgroundColor: vc.bg, color: vc.text }}>
                            {item.variant}
                          </span>
                        ) : <span style={{ minWidth: '46px' }} />}
                        <span style={{ flex: 1, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          Rp {shownPrice.toLocaleString('id-ID')}
                        </span>
                        <span style={{ fontWeight: 800, fontSize: '1rem', minWidth: '28px', textAlign: 'right' }}>{shownQty}</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{isBubble ? 'porsi' : 'cup'}</span>
                        <span style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--primary)', minWidth: '80px', textAlign: 'right' }}>
                          Rp {((shownQty || 0) * shownPrice).toLocaleString('id-ID')}
                        </span>
                        {item.sisa !== undefined && (
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', minWidth: '50px', textAlign: 'right' }}>sisa: {item.sisa}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            )}

            {details.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.75rem', backgroundColor: 'rgba(9,108,70,0.06)', borderTop: '2px solid rgba(52, 199, 89,0.3)' }}>
                <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>Total: {details.reduce((s, d) => s + (d.qty || 0), 0)} item</span>
                <span style={{ fontWeight: 800, color: 'var(--primary)', fontSize: '0.95rem' }}>Rp {totalRev.toLocaleString('id-ID')}</span>
              </div>
            )}
          </div>

          {/* RIGHT: Expenses + Stocks + Kas */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

            {/* Pengeluaran */}
            <div style={{ border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden' }}>
              <div style={{ backgroundColor: 'rgba(255, 56, 60,0.05)', padding: '0.6rem 1rem', borderBottom: '1px solid var(--border-color)' }}>
                <h3 style={{ fontSize: '0.92rem', fontWeight: 800, color: '#ff383c' }}>Pengeluaran Operasional</h3>
              </div>
              {expenses.length === 0 ? (
                <p className="text-muted" style={{ fontSize: '0.82rem', padding: '1rem', textAlign: 'center' }}>Tidak ada pengeluaran.</p>
              ) : expenses.map((exp, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.45rem 0.75rem', borderBottom: idx < expenses.length - 1 ? '1px dashed var(--border-color)' : 'none', backgroundColor: 'white' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{exp.name}</span>
                  <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#ff383c' }}>Rp {(exp.amount || 0).toLocaleString('id-ID')}</span>
                </div>
              ))}
              {expenses.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0.75rem', backgroundColor: 'rgba(255, 56, 60,0.05)', borderTop: '2px solid rgba(255, 56, 60,0.2)' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>Total Pengeluaran</span>
                  <span style={{ fontWeight: 800, color: '#ff383c', fontSize: '0.92rem' }}>Rp {totalExp.toLocaleString('id-ID')}</span>
                </div>
              )}
            </div>

            {/* Pemakaian Operasional */}
            {stocks.length > 0 && (
              <div style={{ border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden' }}>
                <div style={{ backgroundColor: 'rgba(13, 111, 255,0.05)', padding: '0.6rem 1rem', borderBottom: '1px solid var(--border-color)' }}>
                  <h3 style={{ fontSize: '0.92rem', fontWeight: 800, color: '#0d6fff' }}>Pemakaian Operasional</h3>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', padding: '0.75rem' }}>
                  {stocks.map((s, idx) => (
                    <div key={idx} style={{ backgroundColor: '#f2f2f7', borderRadius: '8px', padding: '0.5rem 0.7rem', border: '1px solid var(--border-color)' }}>
                      <p style={{ fontSize: '0.73rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.2rem' }}>{s.name}</p>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ fontWeight: 800, fontSize: '1rem' }}>{s.used ?? s.qty ?? 0}</span>
                        {s.sisa !== undefined && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>sisa: {s.sisa}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Porsi Bubble */}
            {bubbleDetails.length > 0 && (
              <div style={{ border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden' }}>
                <div style={{ backgroundColor: 'rgba(175, 82, 222,0.06)', padding: '0.6rem 1rem', borderBottom: '1px solid var(--border-color)' }}>
                  <h3 style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--special)' }}>Porsi Bubble</h3>
                </div>
                {bubbleDetails.map((b, idx) => {
                  const dibuka = parseInt(b.total_fisik) || 0;
                  const terjual = parseInt(b.porsi_terpakai) || 0;
                  const rusak = parseInt(b.porsi_rusak) || 0;
                  const sisa = parseInt(b.porsi_sisa) || 0;
                  return (
                    <div key={idx} style={{ padding: '0.6rem 0.75rem', borderBottom: idx < bubbleDetails.length - 1 ? '1px dashed var(--border-color)' : 'none', backgroundColor: 'white' }}>
                      <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.35rem' }}>{b.name} <span className="text-muted" style={{ fontWeight: 500, fontSize: '0.75rem' }}>({dibuka} bungkus dibuka)</span></p>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.75rem', backgroundColor: 'rgba(9,108,70,0.08)', color: 'var(--primary)', padding: '0.15rem 0.5rem', borderRadius: '6px', fontWeight: 700 }}>Terjual: {terjual} porsi</span>
                        {rusak > 0 && (
                          <span style={{ fontSize: '0.75rem', backgroundColor: 'rgba(255, 56, 60,0.08)', color: 'var(--danger)', padding: '0.15rem 0.5rem', borderRadius: '6px', fontWeight: 700 }}>Rusak/Buang: {rusak} porsi</span>
                        )}
                        {sisa > 0 && (
                          <span style={{ fontSize: '0.75rem', backgroundColor: 'rgba(255, 149, 0,0.08)', color: 'var(--warning-ink)', padding: '0.15rem 0.5rem', borderRadius: '6px', fontWeight: 700 }}>Sisa (dibawa shift berikut): {sisa} porsi</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Rekap Kas */}
            <div style={{ border: '2px solid rgba(52, 199, 89,0.3)', borderRadius: '12px', overflow: 'hidden', backgroundColor: 'rgba(9,108,70,0.03)' }}>
              <div style={{ backgroundColor: 'rgba(9,108,70,0.08)', padding: '0.6rem 1rem', borderBottom: '1px solid rgba(52, 199, 89,0.2)' }}>
                <h3 style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--primary)' }}>Rekap Kas</h3>
              </div>
              <div style={{ padding: '0.75rem' }}>
                {[
                  { label: 'Modal Awal (Cash Awal)', value: cashAwal, color: 'var(--text-muted)', sign: '' },
                  { label: 'Total Penjualan',        value: totalRev, color: 'var(--primary)',    sign: '+' },
                  { label: 'Total Pengeluaran',      value: totalExp, color: '#ff383c',           sign: '-' },
                ].map((row, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0', borderBottom: '1px dashed var(--border-color)' }}>
                    <span style={{ fontSize: '0.83rem', color: 'var(--text-muted)' }}>{row.label}</span>
                    <span style={{ fontWeight: 700, fontSize: '0.88rem', color: row.color }}>{row.sign} Rp {row.value.toLocaleString('id-ID')}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.5rem', marginTop: '0.5rem', backgroundColor: 'rgba(9,108,70,0.1)', borderRadius: '8px' }}>
                  <span style={{ fontWeight: 800, fontSize: '0.92rem', color: 'var(--primary)' }}>Seharusnya Disetor</span>
                  <span style={{ fontWeight: 900, fontSize: '1.1rem', color: 'var(--primary)' }}>Rp {cashAkhir.toLocaleString('id-ID')}</span>
                </div>
                
                {setoranAktual !== undefined && setoranAktual !== null && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.5rem', marginTop: '0.5rem', backgroundColor: '#f2f2f7', borderRadius: '8px', border: '1px dashed var(--border-color)' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-main)' }}>Setoran Aktual</span>
                      <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-main)' }}>Rp {(setoranAktual || 0).toLocaleString('id-ID')}</span>
                    </div>
                    <div style={{ 
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.5rem', marginTop: '0.5rem', borderRadius: '8px',
                      backgroundColor: selisihInfo >= 0 ? 'rgba(52, 199, 89,0.1)' : 'rgba(255, 56, 60,0.1)',
                      border: `1px solid ${selisihInfo >= 0 ? 'rgba(52, 199, 89,0.3)' : 'rgba(255, 56, 60,0.3)'}`
                    }}>
                      <span style={{ fontWeight: 800, fontSize: '0.92rem', color: selisihInfo >= 0 ? 'var(--primary)' : 'var(--danger)' }}>Selisih</span>
                      <span style={{ fontWeight: 900, fontSize: '1.1rem', color: selisihInfo >= 0 ? 'var(--primary)' : 'var(--danger)' }}>
                        Rp {(selisihInfo || 0).toLocaleString('id-ID')}
                      </span>
                    </div>
                    <div style={{ textAlign: 'right', marginTop: '0.2rem' }}>
                      <span style={{ fontSize: '0.75rem', color: selisihInfo >= 0 ? 'var(--primary)' : 'var(--danger)' }}>
                        {selisihInfo >= 0 ? '(Team dapat bonus / berhemat)' : '(Team harus bayar / indikasi kesalahan)'}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="animate-fade-in">
      <div className="page-title flex justify-between items-center">
        <div>
          <h1 className="text-primary mb-1">Riwayat Penjualan (POS)</h1>
          <p className="text-muted">Lihat laporan end-of-shift dari seluruh cabang.</p>
        </div>
        <button onClick={handleExport} className="btn-primary">
          <Icon name="download" size={18} /> Export Laporan (.xlsx)
        </button>
      </div>

      {/* Konfirmasi Hapus */}
      {delModalOpen && (
        <div className="glass-panel mb-6 animate-fade-in" style={{ border: '2px solid var(--danger)', padding: '1.5rem' }}>
          <h2 className="mb-4 text-danger" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Icon name="alert-circle" color="var(--danger)" /> Konfirmasi Hapus Laporan
          </h2>
          <p className="mb-4">
            Apakah Anda yakin ingin menghapus laporan dari <strong>{selectedReport?.branch_name}</strong> (Shift {selectedReport?.shift}) tanggal {formatDate(selectedReport?.date)}?
          </p>
          <div style={{ backgroundColor: 'rgba(255, 56, 60,0.1)', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem' }}>
            <p style={{ color: 'var(--danger)', fontSize: '0.85rem', fontWeight: 600 }}>
              PERINGATAN: Penghapusan bersifat permanen dan tidak akan mengembalikan stok yang sudah terpotong.
            </p>
          </div>
          <div className="flex justify-between">
            <button disabled={saving} onClick={() => setDelModalOpen(false)} className="btn-secondary">Batal</button>
            <button onClick={confirmDelete} disabled={saving} className="btn-danger">
              {saving ? 'Menghapus...' : 'Ya, Hapus Permanen'}
            </button>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="glass-panel" style={{ padding: '1rem 1.5rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: '1 1 auto', flexWrap: 'wrap' }}>
          <Icon name="calendar" size={18} className="text-muted hidden-mobile" />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
            <input type="date" className="input-field" style={{ width: '100%', padding: '0.4rem 0.6rem' }} value={startDate} onChange={e => setStartDate(e.target.value)} />
            <span className="text-muted">s/d</span>
            <input type="date" className="input-field" style={{ width: '100%', padding: '0.4rem 0.6rem' }} value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flex: '1 1 auto' }}>
          <Icon name="filter" size={18} className="text-muted hidden-mobile" />
          <select className="input-field" style={{ width: '100%', padding: '0.4rem 0.6rem' }} value={filterBranch} onChange={e => setFilterBranch(e.target.value)}>
            <option value="">Semua Cabang</option>
            {branches.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
          </select>
          {(filterBranch || startDate || endDate) && (
            <button onClick={() => { setFilterBranch(''); setStartDate(''); setEndDate(''); }}
              style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 600, flexShrink: 0 }}>
              Reset Filter
            </button>
          )}
        </div>
      </div>

      {/* Daftar Dikelompokkan per Tanggal */}
      {loading ? (
        <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
          <p className="text-muted">Memuat riwayat penjualan...</p>
        </div>
      ) : sortedGroups.length === 0 ? (
        <p className="text-muted text-center py-8">Belum ada laporan penjualan.</p>
      ) : sortedGroups.map(group => {
        const shift1 = group.shifts['1'];
        const shift2 = group.shifts['2'];
        const dailyTotal = (shift1?.total_revenue || 0) + (shift2?.total_revenue || 0);
        const allDone = (!shift1 || shift1.cash_akhir !== null) && (!shift2 || shift2.cash_akhir !== null);


        return (
          <div key={`${group.date}__${group.branch}`} className="glass-panel animate-fade-in" style={{ marginBottom: '1rem', overflow: 'hidden', padding: 0 }}>
            {/* Date + Branch Header */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '0.65rem 1.25rem',
              backgroundColor: 'rgba(0,0,0,0.04)',
              borderBottom: '1px solid var(--border-color)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Icon name="calendar" size={15} style={{ color: 'var(--text-main)', flexShrink: 0 }} />
                <span style={{ fontWeight: 800, fontSize: '0.92rem', color: 'var(--text-main)' }}>{formatDate(group.date)}</span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>— {group.branch}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                {shift1 && shift2 && (
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-main)' }}>
                    Total Harian: Rp {dailyTotal.toLocaleString('id-ID')}
                  </span>
                )}
                {allDone
                  ? <span style={{ backgroundColor: 'var(--text-main)', color: 'white', padding: '0.1rem 0.5rem', borderRadius: '5px', fontSize: '0.68rem', fontWeight: 700 }}>LENGKAP</span>
                  : <span style={{ backgroundColor: 'rgba(255, 204, 0,0.15)', color: '#9a3412', padding: '0.1rem 0.5rem', borderRadius: '5px', fontSize: '0.68rem', fontWeight: 700 }}>AKTIF</span>
                }
              </div>
            </div>

            {/* Shift Rows */}
            <ShiftRow record={shift1} shiftLabel="Shift 1" detailRecord={detailRecord} setDetailRecord={setDetailRecord} handleDownloadDetail={handleDownloadDetail} handleDelete={handleDelete} />
            {(shift2 || shift1) && <div style={{ borderTop: '1px dashed var(--border-color)' }} />}
            <ShiftRow record={shift2} shiftLabel="Shift 2" detailRecord={detailRecord} setDetailRecord={setDetailRecord} handleDownloadDetail={handleDownloadDetail} handleDelete={handleDelete} />
          </div>
        );
      })}

      {/* Detail Panel */}
      {renderDetailPanel()}

    </div>
  );
}
