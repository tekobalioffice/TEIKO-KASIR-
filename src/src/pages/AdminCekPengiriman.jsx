import React, { useState, useEffect } from 'react';
import Icon from '../components/Icon';
import { supabase } from '../supabase';
import { useAuth } from '../contexts/AuthContext';
import { useLocalStorageBranch } from '../hooks/useLocalStorageBranch';
import { useLocalStorageDate } from '../hooks/useLocalStorageDate';
import { downloadShiftReport } from '../utils/downloadShiftReport';

const STATUS_BADGE = {
  pending: { label: 'Menunggu', bg: 'rgba(255, 149, 0,0.1)', color: '#c2410c' },
  approved: { label: 'Diterima', bg: 'rgba(13,111,255,0.12)', color: '#0d6fff' },
  rejected: { label: 'Ditolak', bg: 'rgba(255, 56, 60,0.1)', color: 'var(--danger)' },
  rejected_acked: { label: 'Sudah Dikirim Ulang', bg: 'rgba(142, 142, 147,0.15)', color: '#6e6e73' },
  expired: { label: 'Kedaluwarsa (Ganti Hari)', bg: 'rgba(142, 142, 147,0.15)', color: '#6e6e73' },
  reversed: { label: 'Dibatalkan', bg: 'rgba(255, 56, 60,0.1)', color: 'var(--danger)' }
};

const destLabel = (actionType) => actionType === 'pengiriman_display' ? 'Display' : 'Stok (Safety)';

const formatDate = (iso) => {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
};

export default function AdminCekPengiriman() {
  const { userData } = useAuth();
  const actorName = userData?.name ? `${userData.name} (${userData.role || 'admin'})` : 'Admin';

  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedBranch, setExpandedBranch] = useState(null);
  const [resendOpenId, setResendOpenId] = useState(null);
  const [resendQty, setResendQty] = useState({});
  const [submitting, setSubmitting] = useState({});
  const [moveDate, setMoveDate] = useState({});
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [branches, setBranches] = useState([]);
  const [filterBranch, setFilterBranch] = useLocalStorageBranch('Semua Cabang');
  // Default filter tanggal = hari ini (waktu lokal device), biar begitu buka halaman
  // langsung kefokus ke aktivitas hari ini, bukan numpuk semua histori dari awal.
  const todayLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];
  const [filterStartDate, setFilterStartDate] = useLocalStorageDate('cekPengiriman_start', todayLocal());
  const [filterEndDate, setFilterEndDate] = useLocalStorageDate('cekPengiriman_end', todayLocal());

  const fetchBranches = async () => {
    const { data } = await supabase.from('outlets').select('name').order('name');
    setBranches(data || []);
  };

  const fetchActions = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('pending_stock_actions')
      .select('*')
      .in('action_type', ['pengiriman_display', 'pengiriman_gudang'])
      .order('created_at', { ascending: false });
    if (!error) setActions(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchActions(); fetchBranches(); }, []);

  const statusFiltered = showHistory ? actions : actions.filter(a => a.status === 'pending' || a.status === 'rejected');

  const visibleActions = statusFiltered.filter(a => {
    if (filterBranch !== 'Semua Cabang' && a.target_branch !== filterBranch) return false;
    if (filterStartDate && a.created_at < `${filterStartDate}T00:00:00`) return false;
    if (filterEndDate && a.created_at > `${filterEndDate}T23:59:59`) return false;
    return true;
  });

  const grouped = visibleActions.reduce((acc, a) => {
    (acc[a.target_branch] = acc[a.target_branch] || []).push(a);
    return acc;
  }, {});

  // Kiriman yang sudah 'approved' (ACC diterima staff) tapi ternyata salah input.
  // Balikin stok cabang tujuan (kebalikan persis dari handleAcceptAction di BranchPOS.jsx),
  // tandai status 'reversed', dan catat di log biar ada jejak.
  const handleReverse = async (action, silent = false) => {
    if (submitting[action.id]) return false;
    if (!silent && !window.confirm(`Batalkan kiriman ${action.qty} ${action.item_name} ke ${action.target_branch}? Stok cabang akan dikembalikan seperti sebelum di-ACC.`)) return false;
    setSubmitting(prev => ({ ...prev, [action.id]: true }));
    try {
      const { data: invData } = await supabase
        .from('branch_inventory')
        .select('current_qty, tambah_qty, safety_qty, display_qty')
        .eq('branch_name', action.target_branch)
        .eq('item_name', action.item_name)
        .single();

      const currentQty = invData?.current_qty ?? 0;
      const tambahQty = invData?.tambah_qty ?? 0;
      const safetyQty = invData?.safety_qty ?? 0;
      const displayQty = invData?.display_qty ?? 0;

      const upsertPayload = { branch_name: action.target_branch, item_name: action.item_name };
      let qtyBefore, qtyAfter;
      // Catat potongan NYATA per kolom (bukan qty kiriman) — stok bisa sudah dikoreksi/dijual
      // sehingga pemotongan ke-clamp 0. ACC Ulang mengembalikan persis potongan ini, jadi
      // Batalkan -> ACC Ulang = kembali ke angka semula (tidak menambah stok dari nol).
      const cut = { tambah: 0, display: 0, safety: 0, current: 0 };
      if (action.action_type === 'pengiriman_display') {
        // Kalau kiriman masih di bucket tambah_qty (belum dilipat) -> ambil dari situ.
        // Kalau shift berikutnya sudah buka (tambah_qty ke-fold ke display), ambil sisanya
        // dari display_qty. current_qty ikut turun sebesar yang diambil dari display.
        cut.tambah = Math.min(action.qty, Math.max(0, tambahQty));
        const fromDisplay = action.qty - cut.tambah;
        cut.display = Math.min(fromDisplay, displayQty);
        cut.current = Math.min(cut.display, currentQty);
        upsertPayload.tambah_qty = tambahQty - cut.tambah;
        if (fromDisplay > 0) {
          upsertPayload.display_qty = displayQty - cut.display;
          upsertPayload.current_qty = currentQty - cut.current;
        }
        qtyBefore = tambahQty; qtyAfter = upsertPayload.tambah_qty;
      } else {
        cut.safety = Math.min(action.qty, safetyQty);
        cut.current = Math.min(action.qty, currentQty);
        upsertPayload.safety_qty = safetyQty - cut.safety;
        upsertPayload.current_qty = currentQty - cut.current;
        qtyBefore = safetyQty; qtyAfter = upsertPayload.safety_qty;
      }
      const cutTag = ` [dipotong ${JSON.stringify(cut)}]`;
      await supabase.from('branch_inventory').upsert(upsertPayload, { onConflict: 'branch_name,item_name' });

      await supabase.from('pending_stock_actions').update({
        status: 'reversed',
        note: `Dibatalkan oleh ${actorName} — kiriman sudah diterima tapi salah input.${cutTag}`
      }).eq('id', action.id);

      await supabase.from('stock_restock_log').insert([{
        branch_name: action.target_branch,
        item_name: action.item_name,
        qty_added: -action.qty,
        qty_before: qtyBefore,
        qty_after: qtyAfter,
        petugas_name: `${actorName} (BATALKAN operan — sudah di-ACC, ternyata salah input)`
      }]);

      if (!silent) {
        alert(`Kiriman ${action.item_name} dibatalkan, stok ${action.target_branch} sudah dikembalikan.`);
        fetchActions();
      }
      return true;
    } catch (err) {
      if (!silent) alert('Gagal batalkan: ' + err.message);
      return false;
    } finally {
      setSubmitting(prev => ({ ...prev, [action.id]: false }));
    }
  };

  // ACC ulang kiriman yang sudah 'reversed' (pembatalan ternyata salah) — kebalikan persis
  // handleReverse = ulangi handleAcceptAction di BranchPOS.jsx: Display masuk tambah_qty
  // (current_qty tetap), Gudang masuk safety_qty + current_qty. Log pakai tag [DISPLAY]/[GUDANG]
  // yang sama biar laporan shift ngitungnya persis kayak ACC aslinya.
  const handleReAcc = async (action, silent = false) => {
    if (submitting[action.id]) return false;
    if (!silent && !window.confirm(`ACC ulang kiriman ${action.qty} ${action.item_name} ke ${action.target_branch}? Stok cabang kembali seperti sebelum dibatalkan.`)) return false;
    setSubmitting(prev => ({ ...prev, [action.id]: true }));
    try {
      const { data: invData } = await supabase
        .from('branch_inventory')
        .select('current_qty, tambah_qty, safety_qty, display_qty')
        .eq('branch_name', action.target_branch)
        .eq('item_name', action.item_name)
        .maybeSingle();
      const isDisplay = action.action_type === 'pengiriman_display';
      const before = isDisplay ? (invData?.tambah_qty ?? 0) : (invData?.safety_qty ?? 0);
      const payload = { branch_name: action.target_branch, item_name: action.item_name };
      // Kembalikan persis potongan nyata dari Batalkan (tag di note). Pembatalan lama tanpa tag:
      // anggap terpotong penuh sesuai qty kiriman.
      let cut;
      try { cut = JSON.parse((action.note || '').match(/\[dipotong (\{.*?\})\]/)?.[1]); } catch { cut = null; }
      if (!cut) cut = isDisplay ? { tambah: action.qty, display: 0, safety: 0, current: 0 } : { tambah: 0, display: 0, safety: action.qty, current: action.qty };
      if (isDisplay) {
        payload.tambah_qty = before + cut.tambah;
        if (cut.display > 0) payload.display_qty = (invData?.display_qty ?? 0) + cut.display;
        if (cut.current > 0) payload.current_qty = (invData?.current_qty ?? 0) + cut.current;
      } else {
        payload.safety_qty = before + cut.safety;
        payload.current_qty = (invData?.current_qty ?? 0) + cut.current;
      }
      const { error: invErr } = await supabase.from('branch_inventory').upsert(payload, { onConflict: 'branch_name,item_name' });
      if (invErr) throw invErr;

      await supabase.from('pending_stock_actions').update({
        status: 'approved',
        note: `ACC ulang oleh ${actorName} — pembatalan sebelumnya dibatalkan.`
      }).eq('id', action.id);

      await supabase.from('stock_restock_log').insert([{
        branch_name: action.target_branch,
        item_name: action.item_name,
        qty_added: isDisplay ? cut.tambah : cut.safety,
        qty_before: before,
        qty_after: isDisplay ? payload.tambah_qty : payload.safety_qty,
        petugas_name: `${actorName} (ACC ULANG: ${isDisplay ? '[DISPLAY]' : '[GUDANG]'} Kiriman dari Gudang diterima (${action.created_by}) — pembatalan dibatalkan)`
      }]);

      if (!silent) {
        alert(`Kiriman ${action.item_name} di-ACC ulang, stok ${action.target_branch} sudah kembali.`);
        fetchActions();
      }
      return true;
    } catch (err) {
      if (!silent) alert('Gagal ACC ulang: ' + err.message);
      return false;
    } finally {
      setSubmitting(prev => ({ ...prev, [action.id]: false }));
    }
  };

  // Aksi massal buat kiriman yang dicentang. Berurutan (bukan paralel) — item yang sama bisa
  // muncul lebih dari sekali dan tiap aksi baca-tulis baris branch_inventory yang sama.
  const toggleSelect = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const runBulk = async (mode) => {
    const status = mode === 'reverse' ? 'approved' : 'reversed';
    const targets = visibleActions.filter(a => selected.has(a.id) && a.status === status);
    if (!targets.length) return;
    const list = targets.map(a => `• ${a.qty} ${a.item_name} → ${a.target_branch}`).join('\n');
    const verb = mode === 'reverse' ? 'BATALKAN' : 'ACC ULANG';
    if (!window.confirm(`${verb} ${targets.length} kiriman?\n\n${list}`)) return;
    setBulkBusy(true);
    const failed = [];
    for (const a of targets) {
      const ok = mode === 'reverse' ? await handleReverse(a, true) : await handleReAcc(a, true);
      if (!ok) failed.push(a.item_name);
    }
    setBulkBusy(false);
    setSelected(new Set());
    fetchActions();
    alert(failed.length
      ? `${targets.length - failed.length} berhasil, ${failed.length} gagal: ${failed.join(', ')}`
      : `${targets.length} kiriman berhasil di-${mode === 'reverse' ? 'batalkan' : 'ACC ulang'}.`);
  };
  const selApproved = visibleActions.filter(a => selected.has(a.id) && a.status === 'approved').length;
  const selReversed = visibleActions.filter(a => selected.has(a.id) && a.status === 'reversed').length;

  // Kiriman Display yang di-ACC saat Shift 1 belum ditutup (padahal barangnya datang di jam
  // Shift 2) ke-catat di kolom Tambah Shift 1. Pindahkan Tambah-nya ke Shift 2 di laporan
  // tanggal itu. Biar dua baris tetap balance (Awal + Tambah − Jual = Sisa): Sisa S1 & Awal S2
  // ikut turun qty yang sama. Kalau Sisa S1 jadi minus (barang kiriman sudah kejual sebelum
  // Tutup Shift 1), kelebihan Jual + omzetnya ikut pindah ke Shift 2. Sisa akhir S2 & total
  // harian tidak berubah -> branch_inventory tidak disentuh.
  // undo=true: kebalikan persis, pakai tanggal & qty Jual yang tercatat di note saat dipindah.
  // to=1: kebalikannya — kiriman ke-ACC saat Shift 1 sudah ditutup (jadi nyangkut di Tambah Shift 2)
  // padahal barangnya datang di jam Shift 1. Tambah geser S2 -> S1, tanpa Jual ikut geser.
  const MOVED_RE = /\s*\[Tambah dipindah ke Shift ([12]) tgl (\d{4}-\d{2}-\d{2})(?: jual ([\d.]+))? oleh [^\]]*\]/;
  const handleMoveTambah = async (action, undo = false, to = 2) => {
    if (submitting[action.id]) return;
    const moved = (action.note || '').match(MOVED_RE);
    if (undo && !moved) return;
    const toward2 = undo ? moved[1] === '1' : to === 2; // arah geser Tambah yang dieksekusi
    // Kelompok 'ke Shift 1': kiriman datang di S1 tapi baru di-ACC di S2 -> S1 tak match (Awal+Tambah-Jual != Sisa
    // fisik). Cukup geser Tambah; Sisa/Awal/Jual tak disentuh, baris jadi match sendiri.
    const only = undo ? moved[1] === '1' : to === 1;
    const date = undo ? moved[2] : (moveDate[action.id] || new Date(action.created_at).toLocaleDateString('en-CA'));
    const key = action.item_name;
    const q = Number(action.qty) || 0;
    const isMeta = (d) => d._is_meta || d._is_inventory_snapshot || d._is_preclose_snapshot || !d.name;
    const detKey = (d) => (d.variant && d.variant !== 'Standar') ? `${d.name} ${d.variant}` : d.name;
    setSubmitting(prev => ({ ...prev, [action.id]: true }));
    try {
      const { data: reps, error } = await supabase.from('sales_reports').select('*')
        .eq('branch_name', action.target_branch).eq('date', date).in('shift', ['1', '2']);
      if (error) throw error;
      const s1 = reps?.find(r => String(r.shift) === '1');
      const s2 = reps?.find(r => String(r.shift) === '2');
      if (!s1 || !s2) throw new Error(`Laporan ${action.target_branch} ${date} belum lengkap (Shift 1 & Shift 2 harus sudah ditutup).`);
      const d1 = (s1.details || []).find(d => !isMeta(d) && detKey(d) === key);
      const d2 = (s2.details || []).find(d => !isMeta(d) && detKey(d) === key);
      if (!d1 || !d2) throw new Error(`Item "${key}" tidak ada di laporan ${date}.`);

      const t1 = Number(d1.tambah) || 0;
      const sisa1 = Number(d1.sisa_input ?? d1.sisa ?? 0);
      const jual1 = Number(d1.total_fisik ?? d1.qty ?? 0);
      const awal2 = Number(d2.display_awal ?? 0);
      const tambah2 = Number(d2.tambah) || 0;
      const jual2 = Number(d2.total_fisik ?? d2.qty ?? 0);
      const jp = undo ? (Number(moved[3]) || 0) : (toward2 ? Math.min(Math.max(0, q - sisa1), jual1) : 0);
      if (toward2 && t1 + 0.001 < q) throw new Error(`Tambah ${key} di Shift 1 cuma ${t1}, kurang dari qty kiriman ${q}.`);
      if (!toward2 && (tambah2 + 0.001 < q || jual2 + 0.001 < jp)) throw new Error(`Tambah ${key} di Shift 2 cuma ${tambah2}${undo ? ` (Jual ${jual2}) — laporan sudah berubah sejak dipindah, kembalikan manual di Koreksi Laporan` : `, kurang dari qty kiriman ${q}`}.`);
      // m/j = qty Tambah/Jual yang bergeser S1 -> S2 (negatif = balik S2 -> S1)
      const m = toward2 ? q : -q;
      const j = toward2 ? jp : -jp;
      const sd = only ? 0 : j - m; // delta Sisa S1 & Awal S2
      const nm = (d1.name || '').toLowerCase();
      let price = nm.includes('bubble') ? 0 : (Number(d1.price) || 0);
      if (!price && (nm.includes('jelly') || nm.includes('pudding') || nm.includes('cao'))) price = 2000;
      const rev = j * price;
      const rp = (n) => `Rp ${Math.round(Math.abs(n)).toLocaleString('id-ID')}`;
      if (!window.confirm(
        `${undo ? 'Kembalikan' : 'Pindah'} Tambah ${q} ${key} ${toward2 ? 'dari Shift 1 ke Shift 2' : 'dari Shift 2 ke Shift 1'} (${action.target_branch} ${date})?\n\n` +
        `Shift 1: Tambah ${t1} → ${t1 - m}, Sisa ${sisa1} → ${sisa1 + sd}` + (j ? `, Jual ${jual1} → ${jual1 - j}` : '') + `\n` +
        `Shift 2: Awal ${awal2} → ${awal2 + sd}, Tambah ${tambah2} → ${tambah2 + m}` + (j ? `, Jual ${jual2} → ${jual2 + j}` : '') +
        (j ? `\n\nJual ${jp} ${key} & omzet ${rp(rev)} ikut ${toward2 ? 'pindah ke Shift 2 (sudah terjual sebelum Tutup Shift 1 padahal barangnya datang di Shift 2)' : 'balik ke Shift 1'}. Selisih setoran per shift ikut berubah, total harian tetap.` : '') +
        `\n\nSetelah simpan, form laporan terbaru langsung diunduh.`
      )) return;

      const adj = (n, delta) => (typeof n === 'number' ? n + delta : n);
      const patchDetails = (rep, fn, revDelta) => (rep.details || []).map(d => {
        if (d._is_meta) return revDelta && typeof d.selisih === 'number' ? { ...d, selisih: d.selisih - revDelta } : d;
        return (!isMeta(d) && detKey(d) === key) ? fn(d) : d;
      });
      const newD1 = patchDetails(s1, d => ({
        ...d, tambah: t1 - m, sisa_input: sisa1 + sd, sisa: sisa1 + sd, masuk_net: adj(d.masuk_net, -m),
        qty: Math.max(0, (Number(d.qty) || 0) - j), total_fisik: jual1 - j,
      }), -rev);
      const newD2 = patchDetails(s2, d => ({
        ...d, display_awal: awal2 + sd, tambah: tambah2 + m, masuk_net: adj(d.masuk_net, m - j),
        qty: Math.max(0, (Number(d.qty) || 0) + j), total_fisik: jual2 + j,
      }), rev);
      const patch1 = { details: newD1 };
      const patch2 = { details: newD2 };
      if (rev) {
        Object.assign(patch1, { total_revenue: (s1.total_revenue || 0) - rev, cash_akhir: (s1.cash_akhir || 0) - rev });
        Object.assign(patch2, { total_revenue: (s2.total_revenue || 0) + rev, cash_akhir: (s2.cash_akhir || 0) + rev });
      }

      const { error: e1 } = await supabase.from('sales_reports').update(patch1).eq('id', s1.id);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from('sales_reports').update(patch2).eq('id', s2.id);
      if (e2) throw e2;
      // RLS bisa gagal senyap — pastikan benar tersimpan
      const { data: chk } = await supabase.from('sales_reports').select('details').eq('id', s2.id).single();
      const c2 = (chk?.details || []).find(d => !isMeta(d) && detKey(d) === key);
      if (!c2 || Math.abs((Number(c2.tambah) || 0) - (tambah2 + m)) > 0.001) {
        throw new Error('Update laporan tidak tersimpan (kemungkinan RLS UPDATE sales_reports belum aktif).');
      }

      const baseNote = (action.note || '').replace(MOVED_RE, '');
      await supabase.from('pending_stock_actions').update({
        note: undo ? baseNote : `${baseNote ? baseNote + ' ' : ''}[Tambah dipindah ke Shift ${to} tgl ${date}${jp ? ` jual ${jp}` : ''} oleh ${actorName}]`
      }).eq('id', action.id);

      await supabase.from('stock_restock_log').insert([{
        branch_name: action.target_branch,
        item_name: key,
        qty_added: 0,
        qty_before: t1,
        qty_after: t1 - m,
        petugas_name: `${actorName} (${undo ? 'Kembalikan' : 'Pindah'} Tambah Kiriman ${q} ${toward2 ? 'Shift 1 → Shift 2' : 'Shift 2 → Shift 1'} ${date}${jp ? `, Jual ${jp} ikut ${undo ? 'balik' : 'pindah'}` : ''})`
      }]);

      fetchActions();
      // Form Shift 2 berisi sheet Shift 1, Shift 2, Gabungan & Kartu Stok -> cukup satu unduhan.
      await downloadShiftReport({ ...s2, ...patch2 }, [{ ...s1, ...patch1 }]);
    } catch (err) {
      alert(`Gagal ${undo ? 'kembalikan' : 'pindah'}: ` + err.message);
    } finally {
      setSubmitting(prev => ({ ...prev, [action.id]: false }));
    }
  };

  const handleResend = async (action) => {
    const qty = parseFloat(resendQty[action.id]);
    if (!qty || qty <= 0) {
      alert('Isi qty kiriman ulang yang valid.');
      return;
    }
    setSubmitting(prev => ({ ...prev, [action.id]: true }));
    try {
      const { error: insErr } = await supabase.from('pending_stock_actions').insert([{
        action_type: action.action_type,
        item_name: action.item_name,
        qty,
        source_branch: action.source_branch,
        target_branch: action.target_branch,
        created_by: actorName,
        status: 'pending'
      }]);
      if (insErr) throw insErr;

      const { error: updErr } = await supabase.from('pending_stock_actions')
        .update({ status: 'rejected_acked' }).eq('id', action.id);
      if (updErr) throw updErr;

      alert(`Kiriman ulang ${action.item_name} (${qty}) terkirim ke ${action.target_branch}.`);
      setResendOpenId(null);
      setResendQty(prev => ({ ...prev, [action.id]: '' }));
      fetchActions();
    } catch (err) {
      alert('Gagal kirim ulang: ' + err.message);
    } finally {
      setSubmitting(prev => ({ ...prev, [action.id]: false }));
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="page-title flex justify-between items-center">
        <div>
          <h1 className="text-primary mb-1">Cek Pengiriman</h1>
          <p className="text-muted">Status kiriman mode Pengiriman per cabang — pantau yang ditolak &amp; kirim ulang.</p>
          <p className="text-muted" style={{ fontSize: '0.8rem', marginTop: '0.35rem', maxWidth: '60ch' }}>
            <Icon name="clock" size={12} style={{ verticalAlign: '-2px', marginRight: '0.25rem' }} />
            Kiriman <strong>Menunggu</strong> yang tidak di-ACC / ditolak outlet sampai outlet membuka shift di hari berikutnya otomatis jadi <strong>Kedaluwarsa (Ganti Hari)</strong> — stok tidak masuk, gudang perlu kirim ulang bila masih dibutuhkan.
          </p>
        </div>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="btn-primary"
        >
          <Icon name="history" size={16} /> {showHistory ? 'Sembunyikan Riwayat' : 'Tampilkan Riwayat'}
        </button>
      </div>

      <div className="glass-panel" style={{ padding: '1.25rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: '1 1 260px' }}>
          <Icon name="store" size={18} className="text-primary hidden-mobile" />
          <select className="input-field" style={{ width: '100%', marginBottom: 0 }} value={filterBranch} onChange={e => setFilterBranch(e.target.value)}>
            <option value="Semua Cabang">Semua Cabang</option>
            {branches.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: '1 1 300px' }}>
          <Icon name="calendar" size={18} className="text-muted hidden-mobile" />
          <input
            type="date"
            className="input-field"
            style={{ width: '100%', marginBottom: 0 }}
            value={filterStartDate}
            onChange={e => setFilterStartDate(e.target.value)}
          />
          <span className="text-muted" style={{ fontSize: '0.9rem' }}>s/d</span>
          <input
            type="date"
            className="input-field"
            style={{ width: '100%', marginBottom: 0 }}
            value={filterEndDate}
            onChange={e => setFilterEndDate(e.target.value)}
          />
        </div>
      </div>

      {(selApproved > 0 || selReversed > 0) && (
        <div className="glass-panel" style={{ position: 'sticky', top: '0.5rem', zIndex: 5, padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, fontSize: '0.9rem', marginRight: 'auto' }}>{selApproved + selReversed} kiriman dipilih</span>
          {selApproved > 0 && (
            <button className="btn-secondary" disabled={bulkBusy} onClick={() => runBulk('reverse')} style={{ padding: '0.5rem 0.9rem', fontSize: '0.85rem', color: 'var(--danger)' }}>
              <Icon name="rotate-ccw" size={14} /> Batalkan ({selApproved})
            </button>
          )}
          {selReversed > 0 && (
            <button className="btn-primary" disabled={bulkBusy} onClick={() => runBulk('reacc')} style={{ padding: '0.5rem 0.9rem', fontSize: '0.85rem' }}>
              <Icon name="check-circle" size={14} /> ACC Ulang ({selReversed})
            </button>
          )}
          <button className="btn-secondary" disabled={bulkBusy} onClick={() => setSelected(new Set())} style={{ padding: '0.5rem 0.9rem', fontSize: '0.85rem' }}>
            {bulkBusy ? 'Memproses...' : 'Hapus Pilihan'}
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-muted text-center py-8">Memuat data kiriman...</p>
      ) : Object.keys(grouped).length === 0 ? (
        <p className="text-muted text-center py-8">Tidak ada kiriman {showHistory ? '' : 'yang butuh perhatian '}saat ini.</p>
      ) : (
        <div className="flex-col gap-4">
          {Object.entries(grouped).map(([branchName, items]) => {
            const pendingCount = items.filter(i => i.status === 'pending').length;
            const rejectedCount = items.filter(i => i.status === 'rejected').length;
            const isOpen = expandedBranch === branchName;
            return (
              <div key={branchName} className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
                <div
                  onClick={() => setExpandedBranch(isOpen ? null : branchName)}
                  className="flex justify-between items-center"
                  style={{ padding: '1.25rem 1.5rem', cursor: 'pointer' }}
                >
                  <div className="flex items-center gap-3">
                    <div style={{ backgroundColor: 'rgba(9, 108, 70, 0.1)', color: 'var(--primary)', padding: '0.6rem', borderRadius: '10px' }}>
                      <Icon name="store" size={20} />
                    </div>
                    <div>
                      <p style={{ fontWeight: 700 }}>{branchName}</p>
                      <p className="text-muted" style={{ fontSize: '0.8rem' }}>{items.length} kiriman</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {pendingCount > 0 && (
                      <span style={{ ...badgeStyle(STATUS_BADGE.pending) }}>{pendingCount} Menunggu</span>
                    )}
                    {rejectedCount > 0 && (
                      <span style={{ ...badgeStyle(STATUS_BADGE.rejected), fontWeight: 700 }}>{rejectedCount} Ditolak</span>
                    )}
                    {isOpen ? <Icon name="chevron-up" size={18} /> : <Icon name="chevron-down" size={18} />}
                  </div>
                </div>

                {isOpen && (
                  <div style={{ borderTop: '1px solid var(--border-color)', padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {(() => {
                      const selectable = items.filter(i => i.status === 'approved' || i.status === 'reversed');
                      if (!selectable.length) return null;
                      const allOn = selectable.every(i => selected.has(i.id));
                      return (
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', alignSelf: 'flex-start' }}>
                          <input type="checkbox" checked={allOn} onChange={() => setSelected(prev => {
                            const next = new Set(prev);
                            selectable.forEach(i => (allOn ? next.delete(i.id) : next.add(i.id)));
                            return next;
                          })} />
                          Pilih semua ({selectable.length})
                        </label>
                      );
                    })()}
                    {items.map(item => {
                      const badge = STATUS_BADGE[item.status] || { label: item.status, bg: '#f2f2f7', color: '#6e6e73' };
                      return (
                        <div key={item.id} style={{ border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.9rem 1rem' }}>
                          <div className="flex justify-between items-start">
                            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
                              {(item.status === 'approved' || item.status === 'reversed') && (
                                <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelect(item.id)} style={{ marginTop: '0.25rem' }} aria-label={`Pilih ${item.item_name}`} />
                              )}
                              <div>
                              <p style={{ fontWeight: 700 }}>
                                <Icon name="truck" size={14} style={{ marginRight: '0.35rem', verticalAlign: 'middle' }} />
                                {item.qty} unit — {item.item_name}
                              </p>
                              <p className="text-muted" style={{ fontSize: '0.8rem', marginTop: '0.2rem' }}>
                                Tujuan: {destLabel(item.action_type)} · Dari: {item.created_by} · {formatDate(item.created_at)}
                              </p>
                              </div>
                            </div>
                            <span style={badgeStyle(badge)}>{badge.label}</span>
                          </div>

                          {item.status === 'approved' && item.note && (
                            <div style={{ marginTop: '0.75rem', backgroundColor: 'rgba(13,111,255,0.07)', borderRadius: '8px', padding: '0.6rem 0.75rem' }}>
                              <p style={{ fontSize: '0.8rem', color: '#0d6fff', fontWeight: 600 }}>Diproses:</p>
                              <p style={{ fontSize: '0.85rem' }}>{item.note}</p>
                            </div>
                          )}

                          {item.status === 'approved' && (
                            <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                              <button
                                className="btn-secondary"
                                disabled={submitting[item.id]}
                                onClick={() => handleReverse(item)}
                                style={{ padding: '0.5rem 0.9rem', fontSize: '0.85rem', color: 'var(--danger)' }}
                              >
                                <Icon name="rotate-ccw" size={14} /> {submitting[item.id] ? 'Membatalkan...' : 'Batalkan (Salah Input)'}
                              </button>
                              {item.action_type === 'pengiriman_display' && !MOVED_RE.test(item.note || '') && (
                                <>
                                  <input
                                    type="date"
                                    className="input-field"
                                    title="Tanggal laporan shift"
                                    style={{ marginBottom: 0, width: '150px', padding: '0.4rem 0.5rem', fontSize: '0.85rem' }}
                                    value={moveDate[item.id] || new Date(item.created_at).toLocaleDateString('en-CA')}
                                    onChange={e => setMoveDate(prev => ({ ...prev, [item.id]: e.target.value }))}
                                  />
                                  <button
                                    className="btn-secondary"
                                    disabled={submitting[item.id]}
                                    onClick={() => handleMoveTambah(item)}
                                    style={{ padding: '0.5rem 0.9rem', fontSize: '0.85rem' }}
                                  >
                                    <Icon name="arrow-right" size={14} /> Pindah Tambah ke Shift 2
                                  </button>
                                  <button
                                    className="btn-secondary"
                                    disabled={submitting[item.id]}
                                    onClick={() => handleMoveTambah(item, false, 1)}
                                    style={{ padding: '0.5rem 0.9rem', fontSize: '0.85rem' }}
                                  >
                                    <Icon name="arrow-left" size={14} /> Pindah Tambah ke Shift 1
                                  </button>
                                </>
                              )}
                              {item.action_type === 'pengiriman_display' && MOVED_RE.test(item.note || '') && (
                                <button
                                  className="btn-secondary"
                                  disabled={submitting[item.id]}
                                  onClick={() => handleMoveTambah(item, true)}
                                  style={{ padding: '0.5rem 0.9rem', fontSize: '0.85rem' }}
                                >
                                  <Icon name="rotate-ccw" size={14} /> Kembalikan Tambah ke Shift {item.note.match(MOVED_RE)[1] === '2' ? 1 : 2}
                                </button>
                              )}
                            </div>
                          )}

                          {item.status === 'reversed' && (
                            <div style={{ marginTop: '0.75rem', backgroundColor: 'rgba(255, 56, 60,0.05)', borderRadius: '8px', padding: '0.75rem' }}>
                              <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>{item.note || 'Kiriman ini sudah dibatalkan, stok dikembalikan.'}</p>
                              {resendOpenId === item.id ? (
                                <div className="flex items-center gap-2">
                                  <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    className="input-field"
                                    style={{ marginBottom: 0, width: '100px' }}
                                    placeholder={String(item.qty)}
                                    value={resendQty[item.id] ?? ''}
                                    onChange={e => setResendQty(prev => ({ ...prev, [item.id]: e.target.value }))}
                                  />
                                  <button
                                    className="btn-primary"
                                    disabled={submitting[item.id]}
                                    onClick={() => handleResend(item)}
                                    style={{ padding: '0.5rem 0.9rem', fontSize: '0.85rem' }}
                                  >
                                    {submitting[item.id] ? 'Mengirim...' : 'Kirim'}
                                  </button>
                                  <button
                                    className="btn-secondary"
                                    onClick={() => setResendOpenId(null)}
                                    style={{ padding: '0.5rem 0.9rem', fontSize: '0.85rem' }}
                                  >
                                    Batal
                                  </button>
                                </div>
                              ) : (
                                <button
                                  className="btn-secondary"
                                  onClick={() => { setResendOpenId(item.id); setResendQty(prev => ({ ...prev, [item.id]: String(item.qty) })); }}
                                  style={{ padding: '0.5rem 0.9rem', fontSize: '0.85rem' }}
                                >
                                  <Icon name="send" size={14} /> Kirim Ulang (Qty Benar)
                                </button>
                              )}
                              <button
                                className="btn-secondary"
                                disabled={submitting[item.id]}
                                onClick={() => handleReAcc(item)}
                                style={{ padding: '0.5rem 0.9rem', fontSize: '0.85rem', marginTop: '0.5rem' }}
                              >
                                <Icon name="check-circle" size={14} /> {submitting[item.id] ? 'Memproses...' : 'ACC Ulang'}
                              </button>
                            </div>
                          )}

                          {item.status === 'rejected' && (
                            <div style={{ marginTop: '0.75rem', backgroundColor: 'rgba(255, 56, 60,0.05)', borderRadius: '8px', padding: '0.75rem' }}>
                              <p style={{ fontSize: '0.8rem', color: 'var(--danger)', fontWeight: 600, marginBottom: '0.25rem' }}>Catatan dari outlet:</p>
                              <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>{item.note || 'Tidak ada catatan.'}</p>

                              {resendOpenId === item.id ? (
                                <div className="flex items-center gap-2">
                                  <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    className="input-field"
                                    style={{ marginBottom: 0, width: '100px' }}
                                    placeholder={String(item.qty)}
                                    value={resendQty[item.id] ?? ''}
                                    onChange={e => setResendQty(prev => ({ ...prev, [item.id]: e.target.value }))}
                                  />
                                  <button
                                    className="btn-primary"
                                    disabled={submitting[item.id]}
                                    onClick={() => handleResend(item)}
                                    style={{ padding: '0.5rem 0.9rem', fontSize: '0.85rem' }}
                                  >
                                    {submitting[item.id] ? 'Mengirim...' : 'Kirim'}
                                  </button>
                                  <button
                                    className="btn-secondary"
                                    onClick={() => setResendOpenId(null)}
                                    style={{ padding: '0.5rem 0.9rem', fontSize: '0.85rem' }}
                                  >
                                    Batal
                                  </button>
                                </div>
                              ) : (
                                <button
                                  className="btn-secondary"
                                  onClick={() => { setResendOpenId(item.id); setResendQty(prev => ({ ...prev, [item.id]: String(item.qty) })); }}
                                  style={{ padding: '0.5rem 0.9rem', fontSize: '0.85rem' }}
                                >
                                  <Icon name="send" size={14} /> Kirim Ulang
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function badgeStyle(badge) {
  return {
    display: 'inline-block',
    backgroundColor: badge.bg,
    color: badge.color,
    padding: '0.2rem 0.55rem',
    borderRadius: '6px',
    fontSize: '0.72rem',
    fontWeight: 700,
    lineHeight: 1.4,
    whiteSpace: 'nowrap'
  };
}
