import { pindahByItem as pindahLogsByItem } from '../utils/pindahLogs';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useOutletContext, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/Icon';
import { exportShiftToExcel } from '../utils/exportExcel';
import { supabase } from '../supabase';
import BranchStockDrawer from '../components/BranchStockDrawer';
import KasirOmzetBanner from '../components/KasirOmzetBanner';
import { parseQty, formatFraction, STOCK_KEY_MAP, CUP_SUBTRACTOR_DRINKS, getStockKey, getDetailKey, getPorsiWindowStart, sumStockUsage, stockUsageOf } from '../utils/stockUtils';
import { isStaleBuild } from '../utils/appVersion';

// Semua konstanta dan helper sudah diimport dari stockUtils.js

// Satu dialog sesi-basi sekaligus (restore, cek visibility & scan cadangan bisa nembak barengan).
let staleBusy = false;

const KASIR_NONCASH = [['qris', 'Non-tunai Kasir: QRIS'], ['gojek', 'Non-tunai Kasir: Gojek'], ['grab', 'Non-tunai Kasir: Grab']];

export default function BranchPOS() {
  const { userData } = useAuth();
  const context = useOutletContext();
  const location = useLocation();
  const kasirPath = location.pathname.startsWith('/admin') ? '/admin/kasir' : '/branch/kasir';
  const setCurrentBranch = context?.setCurrentBranch || (() => { });
  const setLivePorsiSisa = context?.setLivePorsiSisa || (() => { });
  const [localPorsiTransfers, setLocalPorsiTransfers] = useState({});
  const sessionPorsiTransfers = context?.porsiTransfers || localPorsiTransfers;
  const setPorsiTransfers = context?.setPorsiTransfers || setLocalPorsiTransfers;
  const [localLiveSafetyStock, setLocalLiveSafetyStock] = useState({});
  const setLiveSafetyStock = context?.setLiveSafetyStock || setLocalLiveSafetyStock;
  const stockRefreshKey = context?.stockRefreshKey || 0;

  const [stockOpen, setStockOpen] = useState(false);
  const [shift, setShift] = useState('1');
  const [cashAwal, setCashAwal] = useState(300000);
  // Tanggal HARUS selalu hari ini buat staff biasa (mereka ga punya akses ganti tanggal
  // sama sekali). Admin selalu boleh milih tanggal lain (entry susulan).
  const canPickDate = (userData) => ['admin', 'administrator', 'owner'].includes(userData?.role?.toLowerCase());
  // Tanggal shift yang lagi jalan (dikunci pas Mulai Shift). Shift 2 sering lewat tengah
  // malam — tanpa ini, reload habis jam 00.00 bikin tanggal loncat ke besok dan laporan
  // Shift 2 salah tanggal / ga bisa ditutup. Cuma dipakai kalau masih kemarin/hari ini.
  const getActiveShiftDate = () => {
    try {
      const d = JSON.parse(localStorage.getItem('pos_active_session') || 'null')?.date;
      const yesterday = new Date(Date.now() - new Date().getTimezoneOffset() * 60000 - 864e5).toISOString().split('T')[0];
      return d && d >= yesterday ? d : null;
    } catch { return null; }
  };
  const [selectedDate, setSelectedDateState] = useState(() => getActiveShiftDate() || new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0]);
  // Sesi lokal basi: shift yang dibuka di HP ini ternyata sudah ditutup (biasanya dari HP lain,
  // mis. CS 7 Okt: PAGI buka Shift 2, SORE yang nutup). Tanpa cek ini HP lama memulihkan shift
  // yang sudah tutup besoknya, staff ngisi di situ dan Tutup Shift ditolak terus.
  const isSessionClosedOnServer = async (sess) => {
    if (!sess?.branch || !sess?.date || !sess?.shift) return false;
    const { data } = await supabase.from('sales_reports').select('id')
      .eq('branch_name', sess.branch).eq('date', sess.date).eq('shift', String(sess.shift)).limit(1);
    return !!(data && data.length);
  };
  // Lepas sesi basi TANPA buang isian: draft pos_draft_<cabang>_shift<N> dibiarkan (dipulihkan
  // lagi pas buka shift yang benar) + salinan permanen tanpa batas 24 jam sebagai cadangan.
  const dropStaleSession = (sess) => {
    try {
      const draft = localStorage.getItem(`pos_draft_${sess.branch}_shift${sess.shift}`);
      if (draft) localStorage.setItem(`pos_draft_backup_${sess.branch}_${sess.date}_shift${sess.shift}`, draft);
    } catch { /* localStorage penuh — abaikan */ }
    localStorage.removeItem('pos_active_session');
    setIsShiftStarted(false);
    setCurrentSession(null);
    setIsDepositModalOpen(false);
    setSelectedDateState(new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0]);
    alert(`Shift ${sess.shift} tanggal ${sess.date} di ${sess.branch} SUDAH DITUTUP (kemungkinan dari HP lain).\n\nIsian kamu TIDAK hilang — tersimpan sebagai draft. Pilih shift yang benar untuk hari ini lalu Mulai Shift; isiannya dipulihkan otomatis.`);
  };
  // Awal = display saat shift sebelumnya ditutup = display sekarang − Pindah ke Display sesudahnya.
  // Dipakai kalau shift dibuka TELAT (sesi basi dipindah / admin isi susulan): kiriman ACC masih
  // di tambah_qty & pindah stok hari itu tetap kehitung sebagai pergerakan shift itu, bukan Awal.
  const getAwalSinceLastClose = async (branch) => {
    const { data: inv } = await supabase.from('branch_inventory').select('item_name, display_qty').eq('branch_name', branch);
    const { data: closeLogs } = await supabase.from('stock_restock_log').select('created_at')
      .eq('branch_name', branch).eq('item_name', 'Status Aktivitas')
      .ilike('petugas_name', '%Tutup Shift%').order('created_at', { ascending: false }).limit(1);
    let pindahQ = supabase.from('stock_restock_log').select('item_name, qty_added, petugas_name, created_at')
      .eq('branch_name', branch).or('petugas_name.ilike."%(Pindah ke Display)%",petugas_name.ilike."%[PERBAIKI]%",petugas_name.ilike."%(Koreksi)%"');
    if (closeLogs?.[0]) pindahQ = pindahQ.gt('created_at', closeLogs[0].created_at);
    const { data: pindah } = await pindahQ;
    const awal = {};
    (inv || []).forEach(r => { awal[r.item_name] = r.display_qty ?? 0; });
    Object.entries(pindahLogsByItem(pindah || [])).forEach(([item, q]) => { awal[item] = (awal[item] ?? 0) - q; });
    return awal;
  };
  // Isian di sesi basi = kerjaan slot BERIKUTNYA yang belum ditutup (CS 8 Okt: HP masih nyimpen
  // Shift 2 tgl 7, staff ngisi penjualan tgl 8). Pindahkan draft + kunci sesi ke slot itu TANPA
  // lewat handleOpenShift — itu bakal lipat tambah_qty (kiriman ACC) ke Awal & nulis log Buka baru
  // yang motong window aktivitas, jadi kiriman/pindah stok hari itu terlewat dari laporan.
  const migrateStaleSession = async (sess, fromBackup = false) => {
    const next = String(sess.shift) === '2'
      ? { date: new Date(new Date(`${sess.date}T00:00:00Z`).getTime() + 864e5).toISOString().split('T')[0], shift: '1' }
      : { date: sess.date, shift: '2' };
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];
    if (next.date > today || await isSessionClosedOnServer({ ...sess, ...next })) return false;
    const { data: later } = await supabase.from('sales_reports').select('id')
      .eq('branch_name', sess.branch).gt('date', next.date).limit(1);
    if (later && later.length) return false; // slot sesudahnya udah jalan — jangan nyelip ke belakang
    const backupKey = `pos_draft_backup_${sess.branch}_${sess.date}_shift${sess.shift}`;
    const oldKey = `pos_draft_${sess.branch}_shift${sess.shift}`;
    const newKey = `pos_draft_${sess.branch}_shift${next.shift}`;
    const draftStr = fromBackup ? localStorage.getItem(backupKey) : (localStorage.getItem(oldKey) || localStorage.getItem(backupKey));
    if (!draftStr) return false;
    if (!window.confirm(`Shift ${sess.shift} tanggal ${sess.date} di ${sess.branch} SUDAH DITUTUP (dari HP lain).\n\nPindahkan SEMUA isian yang kamu ketik di HP ini ke Shift ${next.shift} tanggal ${next.date}?\n\nOK = pindahkan (kiriman & pindah stok tanggal itu ikut terhitung)\nBatal = jangan, isian disimpan sebagai cadangan`)) return false;
    const awal = await getAwalSinceLastClose(sess.branch);
    localStorage.setItem(backupKey, draftStr);
    const prevTarget = localStorage.getItem(newKey);
    if (prevTarget && newKey !== oldKey) localStorage.setItem(`pos_draft_backup_${sess.branch}_${next.date}_shift${next.shift}_sebelum_pindah`, prevTarget);
    localStorage.setItem(newKey, JSON.stringify({ ...JSON.parse(draftStr), displayAtShiftStart: awal, timestamp: Date.now() }));
    if (newKey !== oldKey && !fromBackup) localStorage.removeItem(oldKey);
    localStorage.setItem('pos_active_session', JSON.stringify({ branch: sess.branch, shift: next.shift, date: next.date }));
    return true;
  };
  const handleStaleSession = async (sess) => {
    if (staleBusy) return; // restore + cek visibility bisa nembak barengan — cukup satu dialog
    staleBusy = true;
    if (await migrateStaleSession(sess)) { window.location.reload(); return; }
    dropStaleSession(sess);
    staleBusy = false;
  };
  const setSelectedDate = (val) => {
    setSelectedDateState(val);
    if (canPickDate(userData)) {
      localStorage.setItem('branchPOS_selectedDate_admin', val);
    }
  };
  useEffect(() => {
    if (getActiveShiftDate()) return; // shift masih jalan — tanggalnya udah dikunci di atas
    if (canPickDate(userData)) {
      const saved = localStorage.getItem('branchPOS_selectedDate_admin');
      const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];
      // Admin sering entry susulan (mis. isi Shift 2 kemarin) — tanggal lampau HARUS tetap
      // dipulihkan, kalau ngga carry bubble/porsi antar-shift putus ("beda hari = hangus").
      // Cuma buang kalau kelewat basi (>7 hari, admin lupa balikin). Submit tetap ada
      // konfirmasi "BUKAN hari ini" sebagai pengaman terakhir.
      const weekAgo = new Date(Date.now() - new Date().getTimezoneOffset() * 60000 - 7 * 864e5).toISOString().split('T')[0];
      if (saved && saved >= weekAgo) setSelectedDateState(saved);
      else if (saved) localStorage.removeItem('branchPOS_selectedDate_admin');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData]);
  // Bersihin query pemecah-cache dari tombol "Muat Ulang" biar URL ga numpuk ?_hr=.
  useEffect(() => {
    if (window.location.search.includes('_hr=')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);
  const [isSaving, setIsSaving] = useState(false);
  const [isUpdatingStock, setIsUpdatingStock] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isShiftStarted, setIsShiftStarted] = useState(false);
  const [existingShifts, setExistingShifts] = useState([]);
  const [existingShiftsData, setExistingShiftsData] = useState([]);
  const [currentSession, setCurrentSession] = useState(null);
  const [blockedMsg, setBlockedMsg] = useState('');
  const [s2KemarinPending, setS2KemarinPending] = useState(null); // tanggal kemarin kalau Shift 2-nya belum ditutup
  const [ultraInDiamond, setUltraInDiamond] = useState(0); // salinan ref buat tampilan
  const [kasirSoldMap, setKasirSoldMap] = useState({}); // product_id -> qty terjual lewat Kasir shift ini
  const [kasirNonCash, setKasirNonCash] = useState({}); // 'qris' | 'gojek' | 'grab' -> Rp (tidak masuk laci)
  const kasirLoadRef = useRef(null); // muat ulang jualan Kasir (dipanggil juga sebelum Tutup Shift)
  const ultraInDiamondRef = useRef(0); // kotak Diamond Besar yg asalnya dari Ultra (catatan Form Stok), diisi fetchInventory
  const autoS2Branch = useRef(null); // auto-arahkan ke S2 kemarin cukup sekali per cabang

  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [inventoryMap, setInventoryMap] = useState({});
  const [displayMap, setDisplayMap] = useState({});   // display_qty — Awal (Set Stok)
  const [safetyMap, setSafetyMap] = useState({});     // safety_qty — Gudang (Restock)
  const [tambahMap, setTambahMap] = useState({});     // tambah_qty — Pindahan (Tambah mode)
  const [displayAtShiftStart, setDisplayAtShiftStart] = useState({}); // snapshot saat shift buka
  const [completionMsg, setCompletionMsg] = useState('');
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [setoranAktual, setSetoranAktual] = useState('');
  const [catatan, setCatatan] = useState('');
  const [showEsTehInfo, setShowEsTehInfo] = useState(false);
  const [pendingActions, setPendingActions] = useState([]);
  const [accLoading, setAccLoading] = useState({});
  // Pilihan tujuan per kartu kiriman. Default ikut setting admin (action.action_type),
  // staff bisa ganti lewat switch Display/Gudang di kartu.
  const [destChoice, setDestChoice] = useState({});
  const destOf = (action) => destChoice[action.id] || action.action_type;
  // actionId -> string qty. Key ada = mode edit qty inline lagi kebuka buat kartu itu.
  const [editQty, setEditQty] = useState({});

  const fetchPendingActions = async (branchName) => {
    try {
      const { data, error } = await supabase
        .from('pending_stock_actions')
        .select('*')
        .eq('target_branch', branchName)
        .eq('status', 'pending');
      if (!error && data) {
        setPendingActions(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // overrides: { qty, action_type } — dipakai tombol "Terima + Edit" kalau fisik yang datang
  // beda dari yang dikirim gudang, atau staff mau ubah tujuan (Display <-> Gudang).
  const handleAcceptAction = async (actionId, overrides = {}, opts = {}) => {
    const { silent = false } = opts;
    if (accLoading[actionId]) return false;
    setAccLoading(prev => ({ ...prev, [actionId]: true }));
    try {
      const actionToAcc = pendingActions.find(a => a.id === actionId);
      if (!actionToAcc) return false;

      const { item_name, source_branch, created_by } = actionToAcc;
      const origQty = actionToAcc.qty;
      const origType = actionToAcc.action_type;
      const qty = overrides.qty != null ? overrides.qty : origQty;
      const action_type = overrides.action_type || origType;
      const wasEdited = qty !== origQty || action_type !== origType;

      // Update branch_inventory
      const { data: invData } = await supabase
        .from('branch_inventory')
        .select('current_qty, tambah_qty, safety_qty, display_qty')
        .eq('branch_name', selectedBranch)
        .eq('item_name', item_name)
        .single();

      const currentQty = invData?.current_qty ?? 0;
      let newQty = currentQty;

      if (action_type === 'transfer' || action_type === 'pengiriman_gudang') {
        newQty += qty;
      } else if (action_type === 'deduct' || action_type === 'transfer_out') {
        newQty -= qty;
      }

      const upsertPayload = {
        branch_name: selectedBranch,
        item_name: item_name,
        current_qty: newQty
      };

      // Untuk transfer masuk: tambahkan ke display_qty (stok yang masuk langsung ke display)
      if (action_type === 'transfer') {
        const currentDisplayQty = (await supabase.from('branch_inventory').select('display_qty')
          .eq('branch_name', selectedBranch).eq('item_name', item_name).single())?.data?.display_qty ?? 0;
        upsertPayload.display_qty = currentDisplayQty + qty;
      } else if (action_type === 'pengiriman_display') {
        // Kiriman diterima → masuk Awal sebagai Pindahan (tambah_qty), current_qty TIDAK berubah
        // (samain semantik mode 'tambah' di AdminInventory.jsx).
        upsertPayload.current_qty = currentQty;
        upsertPayload.tambah_qty = (invData?.tambah_qty ?? 0) + qty;
      } else if (action_type === 'pengiriman_gudang') {
        // Kiriman diterima → masuk Gudang/Safety, current_qty (total) ikut nambah.
        upsertPayload.safety_qty = (invData?.safety_qty ?? 0) + qty;
      } else if (action_type === 'deduct') {
        // Kurasi (jalur ACC lawas) — HANYA motong Display, tidak pernah menembus ke Gudang/Safety.
        // current_qty & display_qty turun dengan jumlah nyata yang sama.
        const curDisplay = invData?.display_qty ?? 0;
        const realCut = Math.min(qty, curDisplay);
        upsertPayload.current_qty = currentQty - realCut;
        upsertPayload.display_qty = curDisplay - realCut;
      } else if (action_type === 'transfer_out') {
        // Operan keluar disetujui — potong Display dulu, sisanya Gudang/Safety.
        const curDisplay = invData?.display_qty ?? 0;
        const curSafety = invData?.safety_qty ?? 0;
        const fromDisplay = Math.min(qty, curDisplay);
        const fromSafety = qty - fromDisplay;
        upsertPayload.display_qty = curDisplay - fromDisplay;
        upsertPayload.safety_qty = Math.max(0, curSafety - fromSafety);
        upsertPayload.current_qty = (curDisplay - fromDisplay) + Math.max(0, curSafety - fromSafety);
      }

      await supabase.from('branch_inventory').upsert(upsertPayload, { onConflict: 'branch_name,item_name' });

      // Sinkronisasi virtual portion untuk shift report (jika ini Porsi Bubble)
      if (item_name.includes('Porsi')) {
        let porsiQty = qty;
        if (action_type === 'deduct' || action_type === 'transfer_out') {
          porsiQty = -qty;
        }
        setPorsiTransfers(prev => ({ ...prev, [item_name]: (prev[item_name] || 0) + porsiQty }));
      }

      // Update action status. Selalu catat siapa yang nge-ACC (buat AdminCekPengiriman).
      // Kalau diedit, tambahin juga qty & tujuan aktual biar kelihatan "kirim X, diterima Y".
      const acceptedBy = userData?.name ? `${userData.name}${userData.role ? ` (${userData.role})` : ''}` : 'Staff';
      const editParts = [];
      if (qty !== origQty) editParts.push(`diterima ${qty} (dikirim ${origQty})`);
      if (action_type !== origType) editParts.push(`tujuan diubah ke ${action_type === 'pengiriman_display' ? 'Display' : 'Stok'}`);
      const acceptNote = [`Di-ACC oleh ${acceptedBy}`, ...editParts].join(' • ');
      await supabase.from('pending_stock_actions').update({
        status: 'approved',
        note: acceptNote,
        ...(wasEdited ? { qty, action_type } : {})
      }).eq('id', actionId);

      if (action_type === 'transfer_out') {
        await supabase.from('pending_stock_actions').insert({
          action_type: 'transfer',
          item_name: item_name,
          qty: qty,
          source_branch: selectedBranch,
          target_branch: source_branch, // tujuan akhir disimpan di source_branch
          created_by: `${userData?.name || 'Staff'} (${created_by})`,
          status: 'pending'
        });
      }

      // Log in stock_restock_log
      let logMsg = '';
      if (action_type === 'transfer') {
        logMsg = `Operan dari ${source_branch} (${created_by})`;
      } else if (action_type === 'deduct') {
        logMsg = `Ditarik Gudang (${created_by})`;
      } else if (action_type === 'transfer_out') {
        logMsg = `Dioper ke ${source_branch} (${created_by})`;
      } else if (action_type === 'pengiriman_display') {
        logMsg = `[DISPLAY] Kiriman dari Gudang diterima (${created_by})`;
      } else if (action_type === 'pengiriman_gudang') {
        logMsg = `[GUDANG] Kiriman dari Gudang diterima (${created_by})`;
      }

      const isPengiriman = action_type === 'pengiriman_display' || action_type === 'pengiriman_gudang';
      await supabase.from('stock_restock_log').insert([{
        branch_name: selectedBranch,
        item_name: item_name,
        qty_added: isPengiriman ? qty : (action_type === 'transfer' ? qty : -qty),
        qty_before: isPengiriman ? (action_type === 'pengiriman_display' ? (invData?.tambah_qty ?? 0) : (invData?.safety_qty ?? 0)) : currentQty,
        qty_after: isPengiriman ? (action_type === 'pengiriman_display' ? (invData?.tambah_qty ?? 0) + qty : (invData?.safety_qty ?? 0) + qty) : newQty,
        petugas_name: `${userData?.name || 'Staff'} (ACC: ${logMsg}${wasEdited && editParts.length ? ` — ${editParts.join(', ')}` : ''})`
      }]);

      if (!silent) {
        alert(wasEdited
          ? `Barang ${item_name} di-ACC dengan koreksi: ${qty} unit${action_type !== origType ? ` ke ${action_type === 'pengiriman_display' ? 'Display' : 'Stok'}` : ''}.`
          : `Barang ${item_name} berhasil di-ACC!`);
        fetchPendingActions(selectedBranch);
        await fetchInventory(selectedBranch);
      }
      return true;
    } catch (err) {
      console.error(err);
      if (!silent) alert('Gagal ACC: ' + err.message);
      return false;
    } finally {
      setAccLoading(prev => ({ ...prev, [actionId]: false }));
    }
  };

  // ── Bulk ACC: centang beberapa kiriman, ACC sekaligus ──
  const [selectedActions, setSelectedActions] = useState({});
  const [bulkLoading, setBulkLoading] = useState(false);
  const toggleSelectAction = (id) => setSelectedActions(prev => ({ ...prev, [id]: !prev[id] }));
  const bulkAcceptableIds = () => pendingActions
    .filter(a => a.action_type === 'pengiriman_display' || a.action_type === 'pengiriman_gudang' || a.action_type === 'transfer')
    .map(a => a.id);
  const toggleSelectAll = () => {
    const ids = bulkAcceptableIds();
    const allOn = ids.length > 0 && ids.every(id => selectedActions[id]);
    setSelectedActions(allOn ? {} : Object.fromEntries(ids.map(id => [id, true])));
  };
  const handleBulkAccept = async () => {
    const ids = pendingActions.filter(a => selectedActions[a.id]).map(a => a.id);
    if (ids.length === 0) { alert('Centang kiriman yang mau di-ACC dulu.'); return; }
    if (!window.confirm(`ACC ${ids.length} kiriman terpilih sekaligus?\nPakai jumlah yang dikirim gudang dan tujuan (Display/Stok) yang tampil sekarang.`)) return;
    setBulkLoading(true);
    let ok = 0; const failed = [];
    for (const id of ids) {
      const a = pendingActions.find(x => x.id === id);
      if (!a) continue;
      const good = await handleAcceptAction(id, { action_type: destOf(a) }, { silent: true });
      if (good) ok++; else failed.push(a.item_name);
    }
    setSelectedActions({});
    setBulkLoading(false);
    await fetchPendingActions(selectedBranch);
    await fetchInventory(selectedBranch);
    alert(`ACC sekaligus selesai: ${ok} berhasil${failed.length ? `.\nGagal: ${failed.join(', ')}` : '.'}`);
  };

  const handleRejectAction = async (actionId) => {
    if (accLoading[actionId]) return;

    const actionToAcc = pendingActions.find(a => a.id === actionId);
    if (!actionToAcc) return;
    const isPengirimanReject = actionToAcc.action_type === 'pengiriman_display' || actionToAcc.action_type === 'pengiriman_gudang';

    let reasonText = '';
    if (isPengirimanReject) {
      const promptResult = window.prompt(`Yakin MENOLAK kiriman ${actionToAcc.item_name}? Tulis alasan (opsional, misal: cuma diterima 3 dari 5):`);
      if (promptResult === null) return; // Cancel
      reasonText = promptResult.trim();
    } else {
      if (!window.confirm("Yakin ingin MENOLAK aksi ini?")) return;
    }

    setAccLoading(prev => ({ ...prev, [actionId]: true }));
    try {
      const { item_name, qty, action_type, source_branch, created_by } = actionToAcc;

      // Update action status to rejected — selalu catat siapa yang nolak.
      const rejectedBy = userData?.name ? `${userData.name}${userData.role ? ` (${userData.role})` : ''}` : 'Staff';
      const rejectNote = `Ditolak oleh ${rejectedBy}${reasonText ? ` • ${reasonText}` : ''}`;
      await supabase.from('pending_stock_actions').update({
        status: 'rejected',
        note: rejectNote
      }).eq('id', actionId);

      let logMsg = '';
      if (action_type === 'transfer') {
        logMsg = `Tolak Operan dari ${source_branch} (${created_by})`;
        
        // Return stock to source_branch since it was already deducted when created
        if (!item_name.includes('Porsi')) {
            const { data: invData } = await supabase
              .from('branch_inventory')
              .select('current_qty, display_qty')
              .eq('branch_name', source_branch)
              .eq('item_name', item_name)
              .single();

            const currentQty = invData?.current_qty ?? 0;
            const displayQty = invData?.display_qty ?? 0;
            // Balikin ke Display (tempat asal potongan pas operan dibuat). current_qty ikut naik.
            await supabase.from('branch_inventory').upsert({
              branch_name: source_branch,
              item_name: item_name,
              display_qty: displayQty + qty,
              current_qty: currentQty + qty
            }, { onConflict: 'branch_name,item_name' });

            await supabase.from('stock_restock_log').insert([{
              branch_name: source_branch,
              item_name: item_name,
              qty_added: qty,
              qty_before: currentQty,
              qty_after: currentQty + qty,
              petugas_name: `Sistem (Operan ditolak oleh ${selectedBranch})`
            }]);
        }
      } else if (action_type === 'deduct') {
        logMsg = `Tolak Kurasi (${created_by})`;
      } else if (action_type === 'transfer_out') {
        logMsg = `Tolak Permintaan Operan ke ${source_branch} (${created_by})`;
      } else if (action_type === 'pengiriman_display' || action_type === 'pengiriman_gudang') {
        // Belum pernah nyentuh branch_inventory saat dibuat (beda dari 'transfer' operan
        // antar-outlet) — jadi tolak cukup ubah status, tidak ada stok yang perlu dikembalikan.
        logMsg = `Tolak Kiriman dari Gudang (${created_by})`;
      }

      await supabase.from('stock_restock_log').insert([{
        branch_name: selectedBranch,
        item_name: item_name,
        qty_added: 0,
        qty_before: 0, // Not changing current branch stock
        qty_after: 0,
        petugas_name: `${userData?.name || 'Staff'} (TOLAK: ${logMsg}${isPengirimanReject && reasonText ? ' — ' + reasonText : ''})`
      }]);

      alert(`Berhasil menolak aksi untuk ${item_name}.`);
      fetchPendingActions(selectedBranch);
    } catch (err) {
      console.error(err);
      alert('Gagal menolak: ' + err.message);
    } finally {
      setAccLoading(prev => ({ ...prev, [actionId]: false }));
    }
  };

  // Simpan koreksi qty inline. Tujuan (Display/Gudang) ikut switch di kartu.
  const handleAcceptEditSave = (action) => {
    const q = parseFloat(String(editQty[action.id] ?? '').replace(',', '.'));
    if (isNaN(q) || q < 0) { alert('Jumlah tidak valid.'); return; }
    if (q === 0) { alert('Jumlah 0 — pakai tombol Tolak saja.'); return; }
    setEditQty(prev => { const n = { ...prev }; delete n[action.id]; return n; });
    handleAcceptAction(action.id, { qty: q, action_type: destOf(action) });
  };

  useEffect(() => {
    if (selectedBranch) {
      setCurrentBranch(selectedBranch);
    }
  }, [selectedBranch, setCurrentBranch]);


  const [products, setProducts] = useState([]);
  const [expenses, setExpenses] = useState([
    { id: 1, name: 'Isi Ulang Galon', amount: '' },
    { id: 2, name: 'Es Batu', amount: '' },
  ]);
  const [stocks, setStocks] = useState([]);
  const [showSusuInput, setShowSusuInput] = useState({});

  const toggleSusuInput = (id) => {
    setShowSusuInput(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Safety yang ditampilkan di UI: langsung dari kolom safety_qty
  const getDisplayedSafety = (prod) => {
    const stockKey = getStockKey(prod);
    return safetyMap[stockKey] ?? safetyMap[prod.name] ?? 0;
  };

  useEffect(() => {
    if (products.length > 0) {
      const liveSafetyMap = {};
      products.forEach(prod => {
        const stockKey = getStockKey(prod);
        liveSafetyMap[stockKey] = getDisplayedSafety(prod);
      });
      setLiveSafetyStock(liveSafetyMap);
      setLocalLiveSafetyStock(liveSafetyMap);
    }
  }, [products, inventoryMap, displayMap, setLiveSafetyStock]);

  const fetchBranches = async () => {
    try {
      const { data } = await supabase.from('outlets').select('name, allow_inventory_edit');
      if (data) {
        let filteredBranches = data;
        // If staff has a specific branch assigned, restrict the dropdown to only that branch
        if ((!['admin', 'administrator', 'owner'].includes(userData?.role?.toLowerCase())) && userData?.branch && userData?.branch !== 'Seluruh Cabang') {
          filteredBranches = data.filter(b => b.name === userData.branch);
        }
        setBranches(filteredBranches);
        if (!selectedBranch) {
          if (userData?.branch && userData.branch !== 'Seluruh Cabang') {
            setSelectedBranch(userData.branch);
          } else {
            const savedBranch = localStorage.getItem('lastSelectedBranch');
            const branchToUse = (savedBranch && filteredBranches.some(b => b.name === savedBranch)) ? savedBranch : (filteredBranches.length > 0 ? filteredBranches[0].name : '');
            setSelectedBranch(branchToUse);
          }
        }
      }
    } catch (err) { console.error(err); }
  };

  const fetchInventory = async (branchName) => {
    try {
      const { data } = await supabase.from('branch_inventory').select('*').ilike('branch_name', branchName);
      const map = {};
      const dMap = {};
      const sMap = {};
      const tMap = {};
      (data || []).forEach(row => {
        map[row.item_name] = row.current_qty;
        dMap[row.item_name] = row.display_qty ?? 0;
        sMap[row.item_name] = row.safety_qty ?? 0;
        tMap[row.item_name] = row.tambah_qty ?? 0;
      });
      setInventoryMap(map);
      setDisplayMap(dMap);
      setSafetyMap(sMap);
      setTambahMap(tMap);
      // Diamond asli dipakai duluan, jadi bagian 'ultra' dibatasi total Diamond saat ini.
      const { data: um } = await supabase.from('stock_restock_log').select('qty_after')
        .ilike('branch_name', branchName).eq('item_name', 'Ultra di Diamond Besar').order('created_at', { ascending: false }).limit(1);
      ultraInDiamondRef.current = Math.min(Number(um?.[0]?.qty_after) || 0, map['Diamond Besar'] ?? 0);
      setUltraInDiamond(ultraInDiamondRef.current);
      return { totalMap: map, displayMap: dMap, safetyMap: sMap, tambahMap: tMap };
    } catch (err) { console.error(err); return { totalMap: {}, displayMap: {}, safetyMap: {}, tambahMap: {} }; }
  };


  const checkExistingShifts = async (branchName) => {
    try {
      const todayString = selectedDate;

      const { data, error } = await supabase
        .from('sales_reports')
        .select('*')
        .eq('branch_name', branchName)
        .eq('date', todayString);

      if (error) throw error;

      const reports = data || [];
      setExistingShiftsData(reports); // Save full data for logic
      const shifts = reports.map(r => r.shift);
      setExistingShifts(shifts);

      // Shift 2 kemarin belum ditutup & hari ini belum ada laporan = staff SORE yang ngisi lewat
      // tengah malam (CS PDK 12 Okt: buka 00.xx, malah kebuka Shift 1 tgl 13). Sebelum jam 08.00
      // (Shift 1 mulai) langsung arahkan ke Shift 2 kemarin; sesudahnya cuma tawarkan lewat banner.
      const isStaff = !['admin', 'administrator', 'owner'].includes(userData?.role?.toLowerCase());
      const _today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];
      const _yesterday = new Date(Date.now() - new Date().getTimezoneOffset() * 60000 - 864e5).toISOString().split('T')[0];
      if (isStaff && todayString === _today) {
        let pending = null;
        if (reports.length === 0) {
          const { data: yRep } = await supabase.from('sales_reports').select('shift')
            .eq('branch_name', branchName).eq('date', _yesterday);
          const ys = (yRep || []).map(r => String(r.shift));
          if (!ys.includes('2')) {
            // Kemarin belum ada Shift 2 tertutup: pending kalau Shift 1 sudah dilaporkan ATAU kemarin
            // ada yang buka input (shift dibuka tapi tak pernah ditutup, mis. PDK 18 Okt → kebuka tgl 19).
            let active = ys.includes('1');
            if (!active) {
              const { data: openY } = await supabase.from('stock_restock_log').select('id').limit(1)
                .eq('branch_name', branchName).eq('item_name', 'Status Aktivitas')
                .ilike('petugas_name', '%Buka Input Shift%')
                .gte('created_at', new Date(`${_yesterday}T00:00:00`).toISOString())
                .lt('created_at', new Date(`${_today}T00:00:00`).toISOString());
              active = (openY || []).length > 0;
            }
            if (active) pending = _yesterday;
          }
        }
        setS2KemarinPending(pending);
        if (pending && new Date().getHours() < 8 && autoS2Branch.current !== branchName && !getActiveShiftDate()) {
          autoS2Branch.current = branchName;
          setSelectedDateState(pending); // effect [selectedDate] cek ulang → shift otomatis '2'
          return;
        }
      }

      // Auto-update selected shift based on available options
      if (isStaff) {
        if (!shifts.includes('1')) {
          setShift('1');
        } else if (!shifts.includes('2')) {
          setShift('2');
        } else {
          setShift('');
        }
      }
    } catch (err) {
      console.error('Gagal cek shift:', err);
    }
  };



  const fetchProducts = async () => {
    try {
      setLoading(true);
      const { data: pData, error } = await supabase.from('products').select('*').order('display_order', { ascending: true, nullsFirst: false }).order('name');
      if (error) throw error;

      const { data: opData } = await supabase.from('operational_items').select('*').order('display_order', { ascending: true, nullsFirst: false }).order('name');

      const combined = [
        ...(pData || []).filter(p => p.category !== 'Bahan').map(p => ({
          id: p.id,
          name: p.name,
          price: p.price,
          variant: p.variant || 'Standar',
          category: p.category || 'Lainnya',
          is_unlimited: p.is_unlimited || false,
          is_dual_base: p.is_dual_base || false,
          is_non_base: p.is_non_base || false,
          susu_add_price: p.susu_add_price || 0,
          display_order: p.display_order,
          qty: '',     // Sebagai Sisa Stok
          tambah: '',   // Sebagai Stok Tambah (Untuk FSO)
          safety_qty: '',
          tambah_safety: ''
        })),
        ...(opData || []).map(o => ({
          id: 'op_' + o.id,
          name: o.name,
          price: 0,
          variant: 'Standar',
          category: 'Bahan',
          is_unlimited: false,
          is_dual_base: false,
          is_non_base: true,
          susu_add_price: 0,
          display_order: o.display_order,
          qty: '',
          tambah: '',
          safety_qty: '',
          tambah_safety: ''
        }))
      ];
      let finalProducts = combined;
      const activeSessionStr = localStorage.getItem('pos_active_session');
      const activeSess = (() => { try { return JSON.parse(activeSessionStr || 'null'); } catch { return null; } })();
      if (activeSess && await isSessionClosedOnServer(activeSess)) {
        await handleStaleSession(activeSess);
      } else if (activeSessionStr) {
        try {
          const { branch, shift: activeShift } = JSON.parse(activeSessionStr);
          const draftKey = `pos_draft_${branch}_shift${activeShift}`;
          const savedDraft = localStorage.getItem(draftKey);
          if (savedDraft) {
            const parsed = JSON.parse(savedDraft);
            if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
              finalProducts = combined.map(p => {
                const draftP = parsed.products?.find(dp => dp.id === p.id);
                return draftP ? { ...p, qty: draftP.qty ?? '', tambah: draftP.tambah ?? '', safety_qty: draftP.safety_qty ?? '', tambah_safety: draftP.tambah_safety ?? '', porsi_terpakai: draftP.porsi_terpakai ?? '', porsi_rusak: draftP.porsi_rusak ?? '', susu_qty: draftP.susu_qty ?? '', susu_add_price: draftP.susu_add_price ?? '' } : p;
              });
              if (parsed.expenses && parsed.expenses.length > 0) setExpenses(parsed.expenses);
              if (parsed.cashAwal) setCashAwal(parsed.cashAwal);
              if (parsed.displayAtShiftStart) setDisplayAtShiftStart(parsed.displayAtShiftStart);
            }
          }
          setTimeout(() => {
            setSelectedBranch(branch);
            setShift(activeShift);
            if (activeSess?.date) setSelectedDateState(activeSess.date); // laporan masuk tanggal sesi, bukan tanggal reload
            setIsShiftStarted(true);
            setCurrentSession({ id: 'local_' + Date.now() });
          }, 10);
        } catch (e) {
          console.error('Gagal restore session:', e);
        }
      } else {
        // HP yang sesi basinya sudah dilepas versi sebelumnya (cuma disimpan jadi cadangan):
        // tawarkan sekali pindahkan isian itu ke slot berikutnya.
        for (const k of Object.keys(localStorage)) {
          const m = k.match(/^pos_draft_backup_(.+)_(\d{4}-\d{2}-\d{2})_shift(\d)$/);
          if (!m || staleBusy || localStorage.getItem(`${k}_ditawarkan`)) continue;
          localStorage.setItem(`${k}_ditawarkan`, '1');
          staleBusy = true;
          if (await migrateStaleSession({ branch: m[1], date: m[2], shift: m[3] }, true)) { window.location.reload(); return; }
          staleBusy = false;
        }
      }
      setProducts(finalProducts);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  // Produk/Support Produk baru yang dibuat admin SAAT tab POS ini udah kebuka ga bakal
  // kelihatan sampai halaman di-reload — fetchProducts() cuma jalan sekali pas mount.
  // Fungsi ini nambahin produk baru ke daftar tanpa ganggu input yang lagi diketik staff
  // (beda dari fetchProducts() yang re-build seluruh array dari nol).
  const syncNewProducts = async () => {
    try {
      const { data: pData } = await supabase.from('products').select('*').order('display_order', { ascending: true, nullsFirst: false }).order('name');
      const { data: opData } = await supabase.from('operational_items').select('*').order('display_order', { ascending: true, nullsFirst: false }).order('name');

      const freshCombined = [
        ...(pData || []).filter(p => p.category !== 'Bahan').map(p => ({
          id: p.id,
          name: p.name,
          price: p.price,
          variant: p.variant || 'Standar',
          category: p.category || 'Lainnya',
          is_unlimited: p.is_unlimited || false,
          is_dual_base: p.is_dual_base || false,
          is_non_base: p.is_non_base || false,
          susu_add_price: p.susu_add_price || 0,
          display_order: p.display_order,
          qty: '', tambah: '', safety_qty: '', tambah_safety: ''
        })),
        ...(opData || []).map(o => ({
          id: 'op_' + o.id,
          name: o.name,
          price: 0,
          variant: 'Standar',
          category: 'Bahan',
          is_unlimited: false,
          is_dual_base: false,
          is_non_base: true,
          susu_add_price: 0,
          display_order: o.display_order,
          qty: '', tambah: '', safety_qty: '', tambah_safety: ''
        }))
      ];

      setProducts(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        const newOnes = freshCombined.filter(p => !existingIds.has(p.id));
        return newOnes.length > 0 ? [...prev, ...newOnes] : prev;
      });
    } catch (err) {
      console.error('Gagal sync produk baru:', err);
    }
  };

  useEffect(() => {
    fetchBranches();
    fetchProducts();
  }, [userData]);

  useEffect(() => {
    if (selectedBranch) {
      const activeSessionStr = localStorage.getItem('pos_active_session');
      let isActiveForThisBranch = false;
      if (activeSessionStr) {
        try {
          const parsed = JSON.parse(activeSessionStr);
          if (parsed.branch === selectedBranch) isActiveForThisBranch = true;
        } catch (e) { }
      }

      if (!isActiveForThisBranch) {
        setIsShiftStarted(false);
        setCurrentSession(null);
        // Reset all inputs so previous branch data doesn't leak
        setProducts(prev => prev.map(p => ({ ...p, qty: '', tambah: '', porsi_sisa_awal: 0 })));
        setExpenses([
          { id: 1, name: 'Isi Ulang Galon', amount: '' },
          { id: 2, name: 'Es Batu', amount: '' },
        ]);
        setCashAwal(300000);
      } else {
        // Jika kembali ke cabang yang aktif, load kembali draft-nya
        const activeShiftForBranch = JSON.parse(activeSessionStr).shift;
        const draftKey = `pos_draft_${selectedBranch}_shift${activeShiftForBranch}`;
        const savedDraft = localStorage.getItem(draftKey);

        // Shift 2 aktif: porsi Bubble lanjut dari Shift 1 induk (apapun tanggal kalendernya).
        const _isShift2 = String(activeShiftForBranch) === '2';
        const _repP = _isShift2
          ? supabase.from('sales_reports').select('date, details').eq('branch_name', selectedBranch).eq('date', selectedDate).eq('shift', '1').limit(1)
              .then(r => (r.data && r.data.length) ? r : supabase.from('sales_reports').select('date, details').eq('branch_name', selectedBranch).eq('shift', '1').order('date', { ascending: false }).limit(1))
          : supabase.from('sales_reports').select('date, details').eq('branch_name', selectedBranch).order('date', { ascending: false }).order('shift', { ascending: false }).limit(1);
        _repP.then(({ data: lastRep }) => {
          let lastPorsiSisaMap = {};
          // Shift 2: selalu lanjut dari S1 induk. Shift 1: cuma kalau laporan terakhir hari yang sama.
          const isSameDay = _isShift2 ? (lastRep && lastRep.length > 0) : (lastRep && lastRep.length > 0 && lastRep[0].date === selectedDate);
          if (isSameDay && lastRep[0].details) {
            lastRep[0].details.filter(d => !d._is_meta && !d._is_inventory_snapshot).forEach(p => {
              if (p.name && p.name.toLowerCase().includes('bubble')) {
                if (p.porsi_sisa !== undefined) {
                  lastPorsiSisaMap[p.name] = p.porsi_sisa;
                } else {
                  const bungkusKeluar = parseInt(p.terjual_fisik) || parseInt(p.total_fisik) || 0;
                  const porsiTerpakai = parseInt(p.porsi_terpakai) || 0;
                  const porsiRusak = parseInt(p.porsi_rusak) || 0;
                  const multiplier = p.name.toLowerCase().includes('kecil') ? 10 : 20;
                  const totalPorsi = bungkusKeluar * multiplier;
                  lastPorsiSisaMap[p.name] = Math.max(0, totalPorsi - porsiTerpakai - porsiRusak);
                }
              }
            });
          }

          // display_awal & safety_awal tidak lagi dipakai — sekarang dari displayMap DB
          const applyHandoff = (p, extra = {}) => ({
            ...p,
            porsi_sisa_awal: lastPorsiSisaMap[p.name] || 0,
            ...extra
          });

          if (savedDraft) {
            try {
              const parsed = JSON.parse(savedDraft);
              if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
                setProducts(prev => prev.map(p => {
                  const draftP = parsed.products?.find(dp => dp.id === p.id);
                  return draftP ? applyHandoff(p, { qty: draftP.qty ?? '', tambah: draftP.tambah ?? '', safety_qty: draftP.safety_qty ?? '', tambah_safety: draftP.tambah_safety ?? '', porsi_terpakai: draftP.porsi_terpakai ?? '', porsi_rusak: draftP.porsi_rusak ?? '', susu_qty: draftP.susu_qty ?? '', susu_add_price: draftP.susu_add_price ?? '' }) : applyHandoff(p);
                }));
                if (parsed.expenses && parsed.expenses.length > 0) setExpenses(parsed.expenses);
                if (parsed.cashAwal) setCashAwal(parsed.cashAwal);
                if (parsed.displayAtShiftStart) setDisplayAtShiftStart(parsed.displayAtShiftStart);
              } else {
                localStorage.removeItem(draftKey); // Hapus draft usang
                setProducts(prev => prev.map(p => applyHandoff(p)));
              }
            } catch (e) {
              console.error('Gagal load draft', e);
              setProducts(prev => prev.map(p => applyHandoff(p)));
            }
          } else {
            setProducts(prev => prev.map(p => applyHandoff(p)));
          }
        });
      }
      setBlockedMsg('');
      fetchInventory(selectedBranch);
      fetchPendingActions(selectedBranch);
      checkExistingShifts(selectedBranch);
    }
  }, [selectedBranch, selectedDate]);

  // Kiriman baru (kirim ulang admin / gudang) yang dibuat SETELAH halaman ini dimuat tidak akan muncul sendiri —
  // daftar ACC cuma diambil saat ganti cabang/tanggal & buka shift. Segarkan tiap 30 detik dan saat tab dibuka lagi
  // supaya notifikasi ACC tetap muncul di shift berikutnya tanpa harus Muat Ulang.
  useEffect(() => {
    if (!selectedBranch) return undefined;
    const refresh = () => { if (document.visibilityState === 'visible') fetchPendingActions(selectedBranch); };
    const id = setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', refresh); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranch]);

  // Staff baru aksi di Laci Stok (kurasi/pindah/tambah) → refetch inventory biar displayMap &
  // safetyMap ke-update. Kalau tidak, kurasi di tengah shift bisa ke-anggap "terjual" pas Tutup Shift.
  useEffect(() => {
    if (stockRefreshKey && selectedBranch) fetchInventory(selectedBranch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockRefreshKey]);

  // Tab yang dibiarkan terbuka semalaman ga reload, jadi cek sesi basi juga tiap HP dibuka lagi.
  useEffect(() => {
    if (!isShiftStarted || isSaving) return;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      const sess = (() => { try { return JSON.parse(localStorage.getItem('pos_active_session') || 'null'); } catch { return null; } })();
      if (sess && await isSessionClosedOnServer(sess)) handleStaleSession(sess);
    };
    check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, [isShiftStarted, isSaving]);

  // --- Auto-Save Draft ---
  useEffect(() => {
    if (isShiftStarted && selectedBranch && shift && products.length > 0) {
      const draftKey = `pos_draft_${selectedBranch}_shift${shift}`;
      const draftData = {
        products: products.map(p => ({ id: p.id, qty: p.qty, tambah: p.tambah, safety_qty: p.safety_qty, tambah_safety: p.tambah_safety, porsi_terpakai: p.porsi_terpakai, porsi_rusak: p.porsi_rusak, susu_qty: p.susu_qty, susu_add_price: p.susu_add_price })),
        expenses,
        cashAwal,
        displayAtShiftStart, // snapshot Awal shift — kalau ga disimpen, reload halaman bikin ini balik {} dan Awal/Sisa Excel jadi blank buat item yang ga disentuh staff
        timestamp: Date.now()
      };
      localStorage.setItem(draftKey, JSON.stringify(draftData));
    }
  }, [products, expenses, cashAwal, isShiftStarted, selectedBranch, shift, displayAtShiftStart]);

  const fetchShift1Report = async (branchName) => {
    try {
      const todayString = selectedDate;
      const { data } = await supabase
        .from('sales_reports')
        .select('*')
        .eq('branch_name', branchName)
        .eq('shift', '1')
        .eq('date', todayString)
        .order('id', { ascending: false })
        .limit(1);
      return data?.[0] || null;
    } catch { return null; }
  };

  // Awal Shift 2 = Sisa Shift 1 (dari laporan S1), BUKAN display_qty live. display_qty bisa
  // melenceng kalau S1 ditutup dari HP berisi app versi lama yang tak motong stok (CS 9 Okt:
  // Awal S2 = Awal S1 + kiriman, penjualan S1 tak terpotong). Item yang tak ada di laporan S1
  // tetap pakai snapshot lama.
  // Shift 1 sama: Awal = Sisa laporan terakhir SEBELUM tanggal ini (S2 kemarin). Dulu Awal S1
  // = display_qty live saat buka, jadi stok yang dipindah gudang->display sebelum buka (atau
  // sebelum buka-ulang shift, CS 14 Okt: Awal GD Capucinno 32 vs Sisa kemarin 12) ikut terlipat
  // ke Awal & staff harus cocokin manual ke laporan kemarin. Sekarang pindahan itu tampil
  // sebagai Tambah (masuk_net = Sisa − Awal + Jual).
  const fetchPrevDayReport = async (branchName) => {
    try {
      const { data } = await supabase.from('sales_reports').select('details')
        .eq('branch_name', branchName).lt('date', selectedDate)
        .order('date', { ascending: false }).order('shift', { ascending: false }).limit(1);
      return data?.[0] || null;
    } catch { return null; }
  };
  const applyShift1SisaAsAwal = async (branchName) => {
    const s1 = shift === '1' ? await fetchPrevDayReport(branchName) : await fetchShift1Report(branchName);
    if (!s1?.details) return;
    const awal = {};
    s1.details.forEach(d => {
      if (d._is_meta || d._is_inventory_snapshot || !d.name || d.sisa_input == null) return;
      const k = getStockKey(d);
      // beberapa menu bisa map ke stockKey yang sama — utamakan baris item itu sendiri
      if (!(k in awal) || getDetailKey(d) === k) awal[k] = Number(d.sisa_input) || 0;
    });
    setDisplayAtShiftStart(prev => ({ ...prev, ...awal }));
  };
  useEffect(() => {
    if (isShiftStarted && selectedBranch) applyShift1SisaAsAwal(selectedBranch);
  }, [isShiftStarted, shift, selectedBranch, selectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Jangan blokir ketikan (mis. "3/4" -> angka "3" sempat > stok). Kelebihan
  // stok ditandai merah lewat exceedsAvail() dan dicegat saat Tutup Shift.
  const handleProductChange = (id, field, value) => {
    setProducts(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const handleAddExpense = () =>
    setExpenses(prev => [...prev, { id: Date.now(), name: '', amount: '' }]);

  // QRIS / Gojek / Grab dari Kasir = uang yang TIDAK masuk laci. Dicatat otomatis sebagai baris
  // Pengeluaran (terkunci) supaya "Seharusnya Disetor" = tunai saja; ikut ter-update tiap data Kasir dimuat.
  useEffect(() => {
    const names = KASIR_NONCASH.map(([, n]) => n);
    setExpenses(prev => {
      const kept = prev.filter(e => !names.includes(e.name));
      const auto = KASIR_NONCASH.filter(([k]) => kasirNonCash[k] > 0)
        .map(([k, name]) => ({ id: `kasir_${k}`, name, amount: String(kasirNonCash[k]), auto: true }));
      const next = [...kept, ...auto];
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
    });
  }, [kasirNonCash, expenses]);

  const handleExpenseChange = (id, field, value) =>
    setExpenses(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));


  const isInvalidFraction = (prod) => {
    if (prod.qty === '' || prod.qty === undefined || prod.qty === null) return false;
    const qty = parseQty(prod.qty);
    if (isNaN(qty)) return true;

    if (prod.name === 'Diamond Besar') {
      const frac = parseFloat((qty % 1).toFixed(3));
      if (![0, 0.2, 0.4, 0.6, 0.8].includes(frac)) return true;
    }
    if (prod.name === 'Ultra Milk Besar' || prod.name === 'Diamond BC') {
      // 1 kotak = 4 unit -> hanya kelipatan 1/4
      const frac = parseFloat((qty % 1).toFixed(3));
      if (![0, 0.25, 0.5, 0.75].includes(frac)) return true;
    }
    return false;
  };

  // Sisa melebihi stok tersedia (Awal + tambahan). Non-blocking: hanya penanda
  // merah; ketikan pecahan yang belum selesai (mis. "3/") tidak dihitung.
  const exceedsAvail = (prod) => {
    const v = String(prod.qty ?? '').trim();
    if (v === '' || /[/.,\s]$/.test(v)) return false;
    const q = parseQty(v);
    if (isNaN(q)) return false;
    const stockKey = getStockKey(prod);
    const displayNow = displayMap[stockKey] ?? displayMap[prod.name] ?? 0;
    const tambahDB = tambahMap[stockKey] ?? tambahMap[prod.name] ?? 0;
    const fisikTambah = parseQty(prod.tambah) || 0;
    return q > displayNow + tambahDB + fisikTambah;
  };

  // Bahan terpakai lewat Kasir shift ini (cup + resep: Gula Milk Tea, Black Tea, Diamond, Ultra),
  // per nama bahan. Rumus auto-hitung (Es Teh dari cup, Milk Tea dari gula, dst) lalu jalan sendiri
  // selama Sisa bahan belum diisi — laporan tetap pakai rumus yang sama seperti sebelumnya.
  const kasirBahanUsed = useMemo(() => sumStockUsage(
    products.filter(p => p.category !== 'Bahan' && kasirSoldMap[p.id]).map(p => ({ product: p, qty: kasirSoldMap[p.id] })),
    products.filter(p => p.category === 'Bahan').map(p => p.name),
  ), [products, kasirSoldMap]);
  // Jumlah dari Kasir untuk satu baris form: menu = jualan, bahan = terpakai.
  const kasirQtyFor = (prod) => (prod.category === 'Bahan' ? kasirBahanUsed[prod.name] : kasirSoldMap[prod.id]) || 0;
  // Bahan yang ikut terhitung dari Kasir (cup + resep). Bahan lain (Gula 1/2, Premium Tea, sedotan,
  // tutup, tisu, dll) TIDAK tercatat Kasir -> Sisa-nya wajib diisi manual saat opname.
  const autoBahanNames = useMemo(() => {
    const bahanNames = products.filter(p => p.category === 'Bahan').map(p => p.name);
    const set = new Set();
    products.filter(p => p.category !== 'Bahan').forEach(p => stockUsageOf(p, bahanNames).forEach(u => set.add(u.item)));
    return set;
  }, [products]);

  const getRawMaterialSold = (name) => {
    const prod = products.find(p => p.name === name && p.category === 'Bahan');
    if (!prod) return 0;
    if (prod.qty === '' && prod.tambah === '') return kasirQtyFor(prod); // belum diopname -> cup dari Kasir
    const stockKey = getStockKey(prod);
    const displayNow = displayMap[stockKey] ?? displayMap[prod.name] ?? 0;
    const tambahDB = tambahMap[stockKey] ?? tambahMap[prod.name] ?? 0;
    const fisikTambah = parseQty(prod.tambah) || 0;
    const fisikAkhir = parseQty(prod.qty) || 0;
    return Math.max(0, (displayNow + tambahDB + fisikTambah) - fisikAkhir);
  };

  const isAutoCalculated = (prod) => {
    return prod.name === 'Es Teh' || prod.name === 'Teh Tarik' || prod.name === 'Full Cream' || prod.name === 'Milk Tea';
  };

  const getEsTehCalculationText = (prod) => {
    if (prod.name !== 'Es Teh') return '(Auto)';
    const isPremi = prod.variant === 'Premi';
    let totalCups = 0;
    products.forEach(p => {
      if (p.category === 'Bahan') {
        const n = p.name.toLowerCase();
        if (n.includes('cup') && ((isPremi && n.includes('premi')) || (!isPremi && (n.includes('ori') || n.includes('paper'))))) {
          // getRawMaterialSold sendiri yang urus Sisa kosong (pakai cup dari Kasir) — sama dengan rumus Es Teh.
          totalCups += getRawMaterialSold(p.name);
        }
      }
    });

    let otherDrinksSold = 0;
    products.forEach(p => {
      if (CUP_SUBTRACTOR_DRINKS.includes(p.name)) {
        let pIsPremi = p.variant === 'Premi';
        if (p.variant === 'Standar' || !p.variant) {
          if (p.name.trim().toLowerCase().endsWith(' premi')) pIsPremi = true;
        }
        if (pIsPremi === isPremi) {
          otherDrinksSold += getProductSoldQty(p);
        }
      }
    });

    return `(Total ${totalCups} Cup - ${otherDrinksSold} Minuman Lain)`;
  };

  // Sync bubble porsi_sisa_awal and porsi_transfer_awal dari log DB. Dipanggil pas shift
  // dibuka/ganti cabang, DAN pas tab difokus lagi (lihat effect di bawah) — supaya transfer
  // Porsi Bubble yang dilakukan lewat drawer stok ke-reconcile & ga double-count.
  const syncBubblePorsi = async () => {
    if (!(isShiftStarted && selectedBranch && products.length > 0)) return;
        try {
          // Shift 2: basis porsi = Shift 1 induk (sama kayak handleOpenShift), apapun tanggal
          // kalendernya. Dulu di sini selalu "laporan terakhir + harus tanggal sama" → kalau
          // S1 induk beda tanggal, tiap fokus tab porsi bawaan S1 ke-reset jadi 0.
          let lastRep = null;
          let isShift2Parent = false;
          if (String(shift) === '2') {
            let r = await supabase.from('sales_reports').select('date, details')
              .eq('branch_name', selectedBranch).eq('date', selectedDate).eq('shift', '1').limit(1);
            if (!r.data || r.data.length === 0) {
              r = await supabase.from('sales_reports').select('date, details')
                .eq('branch_name', selectedBranch).eq('shift', '1').order('date', { ascending: false }).limit(1);
            }
            if (r.data && r.data.length > 0) { lastRep = r.data; isShift2Parent = true; }
          }
          if (!lastRep) {
            ({ data: lastRep } = await supabase.from('sales_reports').select('date, details').eq('branch_name', selectedBranch)
              .order('date', { ascending: false }).order('shift', { ascending: false }).limit(1));
          }
          let porsiSisaMap = {};
          // id itu UUID (bukan urut waktu) — jangan sort pakai itu. Beda hari = sisa hangus.
          const isSameDay = lastRep && lastRep.length > 0 && (isShift2Parent || lastRep[0].date === selectedDate);
          if (isSameDay && lastRep[0].details) {
            lastRep[0].details.forEach(p => {
              if (p.name && p.name.toLowerCase().includes('bubble')) {
                if (p.porsi_sisa !== undefined) porsiSisaMap[p.name] = p.porsi_sisa;
                else {
                  const bKeluar = parseInt(p.terjual_fisik) || parseInt(p.total_fisik) || 0;
                  const mult = p.name.toLowerCase().includes('kecil') ? 10 : 20;
                  porsiSisaMap[p.name] = Math.max(0, bKeluar * mult - (parseInt(p.porsi_terpakai) || 0) - (parseInt(p.porsi_rusak) || 0));
                }
              }
            });
          }

          // Transfer yang dihitung = sesudah laporan basis ditutup (sebelumnya udah ke-bake di porsi_sisa-nya)
          const lastRepTime = await getPorsiWindowStart(supabase, selectedBranch, lastRep?.[0]);

          let porsiTransMap = {};
          let q = supabase.from('stock_restock_log').select('item_name, qty_added').eq('branch_name', selectedBranch).in('item_name', ['Porsi Bubble Besar', 'Porsi Bubble Kecil']);
          if (lastRepTime) q = q.gt('created_at', lastRepTime);
          const { data: logs } = await q;
          if (logs) {
            logs.forEach(l => {
              const bName = l.item_name.replace('Porsi ', '');
              porsiTransMap[bName] = (porsiTransMap[bName] || 0) + l.qty_added;
            });
          }

          setProducts(prev => {
            let changed = false;
            const newP = prev.map(p => {
              if (p.name && p.name.toLowerCase().includes('bubble')) {
                const newSisa = porsiSisaMap[p.name] || 0;
                const newTrans = porsiTransMap[p.name] || 0;
                if (p.porsi_sisa_awal !== newSisa || p.porsi_transfer_awal !== newTrans) {
                  changed = true;
                  return { ...p, porsi_sisa_awal: newSisa, porsi_transfer_awal: newTrans };
                }
              }
              return p;
            });
            return changed ? newP : prev;
          });

          // porsiTransMap barusan udah nyerap SEMUA log Oper/ACC porsi bubble sejak shift
          // dibuka (termasuk yang sebelumnya cuma ke-track live di sessionPorsiTransfers).
          // Reset session state-nya, kalau ngga totalPorsi bakal ngitung transfer yang sama
          // dua kali (sekali dari porsi_transfer_awal, sekali lagi dari sessionTransfer) —
          // itu penyebab "porsi hilang tiba-tiba" pas Oper Porsi Bubble.
          setPorsiTransfers(prev => ({ ...prev, 'Porsi Bubble Besar': 0, 'Porsi Bubble Kecil': 0 }));
        } catch (e) { console.error(e); }
  };

  useEffect(() => {
    syncBubblePorsi();
    // products.length sengaja diomit biar ga infinite loop, cukup jalan pas shift dibuka/ganti cabang
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isShiftStarted, selectedBranch]);

  // Balik ke tab ini (habis buka tab lain / minimize) → cek produk baru + reconcile Porsi
  // Bubble (biar transfer lewat drawer stok ga double-count), tanpa reset input.
  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden) {
        syncNewProducts();
        syncBubblePorsi();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  }, []);

  // Penjualan Kasir shift ini (orders.report_date + shift = sesi Input Penjualan yang aktif).
  // Kasir TIDAK motong display_qty; jualannya dihitung di sini sebagai Terjual otomatis, dan
  // Tutup Shift yang motong stok (live - terjual) seperti biasa — jadi tidak kepotong 2x.
  useEffect(() => {
    if (!isShiftStarted || !selectedBranch || !shift) { setKasirSoldMap({}); setKasirNonCash({}); return; }
    let cancelled = false;
    const load = async () => {
      // Transaksi yang dibatalkan (voided_at) tidak dihitung.
      const [{ data, error }, { data: ords }] = await Promise.all([
        supabase.from('order_items')
          .select('product_id, qty, orders!inner(branch_name, report_date, shift, voided_at)')
          .eq('orders.branch_name', selectedBranch).eq('orders.report_date', selectedDate).eq('orders.shift', String(shift))
          .is('orders.voided_at', null),
        supabase.from('orders').select('total, payment_method')
          .eq('branch_name', selectedBranch).eq('report_date', selectedDate).eq('shift', String(shift)).is('voided_at', null),
      ]);
      if (cancelled) return;
      if (error) { console.error('Gagal ambil penjualan Kasir:', error); return; }
      const nonCash = {};
      (ords || []).forEach(o => { if (o.payment_method && o.payment_method !== 'cash') nonCash[o.payment_method] = (nonCash[o.payment_method] || 0) + (o.total || 0); });
      setKasirNonCash(nonCash);
      const map = {};
      (data || []).forEach(r => { if (r.product_id) map[r.product_id] = (map[r.product_id] || 0) + (r.qty || 0); });
      setKasirSoldMap(map);
    };
    load();
    kasirLoadRef.current = load;
    const onFocus = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onFocus); window.removeEventListener('focus', onFocus); };
  }, [isShiftStarted, selectedBranch, selectedDate, shift]);

  const getProductSoldQty = (prod) => {
    // ---- Auto-Calculation Logic ----

    if (prod.name === 'Milk Tea') {
      const isPremi = prod.variant === 'Premi';
      return (isPremi
        ? (getRawMaterialSold('Gula Milk Tea Premi') || getRawMaterialSold('Gula Milk Tea'))
        : (getRawMaterialSold('Gula Milk Tea Ori') || getRawMaterialSold('Gula Milk Tea')))
        || kasirSoldMap[prod.id] || 0; // bahan belum diopname -> angka Kasir
    }

    if (prod.name === 'Teh Tarik') {
      const isPremi = prod.variant === 'Premi';
      const blackTea = isPremi
        ? (getRawMaterialSold('Black Tea Premi') || getRawMaterialSold('Black Tea'))
        : (getRawMaterialSold('Black Tea Ori') || getRawMaterialSold('Black Tea'));

      // Membaca pemakaian Gula Milk Tea dari FSO
      let milkTeaMenuSold = isPremi
        ? (getRawMaterialSold('Gula Milk Tea Premi') || getRawMaterialSold('Gula Milk Tea'))
        : (getRawMaterialSold('Gula Milk Tea Ori') || getRawMaterialSold('Gula Milk Tea'));

      // Fallback ke inputan manual Milk Tea di atas jika di FSO tidak diinput
      if (milkTeaMenuSold === 0) {
        products.forEach(p => {
          if (p.name === 'Milk Tea' && ((p.variant === 'Premi') === isPremi || p.variant === 'Standar')) {
            milkTeaMenuSold += getProductSoldQty(p);
          }
        });
      }

      if (blackTea === 0) return kasirSoldMap[prod.id] || 0; // Black Tea belum diopname -> angka Kasir
      return Math.max(0, blackTea - milkTeaMenuSold);
    }

    if (prod.name === 'Full Cream') {
      const isPremi = prod.variant === 'Premi';
      const milkSold = isPremi
        ? Math.round((getRawMaterialSold('Ultra Milk Besar Premi') || getRawMaterialSold('Ultra Milk Besar')) * 4)
        : Math.round((getRawMaterialSold('Diamond Besar Ori') || getRawMaterialSold('Diamond Besar')) * 5);

      if (milkSold === 0) return kasirSoldMap[prod.id] || 0; // susu belum diopname -> angka Kasir
      if (isPremi) {
        return Math.max(0, milkSold);
      } else {
        const ccProd = products.find(p => (p.name === 'Coffe Cream' || p.name === 'Coffee Cream') && (!p.variant || p.variant === 'Standar' || p.variant === 'Ori') && p.category !== 'Bahan');
        const coffeCreamSold = ccProd ? getProductSoldQty(ccProd) : 0;
        return Math.max(0, milkSold - coffeCreamSold);
      }
    }

    if (prod.name === 'Es Teh') {
      const isPremi = prod.variant === 'Premi';

      // Calculate total cups used by checking FSO items that contain 'cup' and the respective variant
      let totalCups = 0;
      products.forEach(p => {
        if (p.category === 'Bahan') {
          const n = p.name.toLowerCase();
          if (n.includes('cup') && ((isPremi && n.includes('premi')) || (!isPremi && (n.includes('ori') || n.includes('paper'))))) {
            totalCups += getRawMaterialSold(p.name);
          }
        }
      });

      // If cups not yet entered, return 0
      // Cup belum diopname -> pakai angka Kasir (0 kalau tak ada). Sisa cup diisi -> rumus cup menang.
      if (totalCups === 0) return kasirSoldMap[prod.id] || 0;

      // Calculate: Total Cups - All Other Drinks Sold (same variant)
      let otherDrinksSold = 0;
      products.forEach(p => {
        const safeName = p.name ? p.name.trim().toLowerCase() : '';
        const isSubtractor = CUP_SUBTRACTOR_DRINKS.some(d => d.toLowerCase() === safeName);
        if (isSubtractor) {
          // Deteksi variant: prioritas dari field variant, tapi jika 'Standar' cek dari nama produk
          let pIsPremi = p.variant === 'Premi';
          if (p.variant === 'Standar' || !p.variant) {
            if (safeName.endsWith(' premi')) pIsPremi = true;
            // 'Ori' atau tanpa suffix = tetap Ori (pIsPremi = false)
          }
          if (pIsPremi === isPremi) {
            otherDrinksSold += getProductSoldQty(p);
          }
        }
      });
      return Math.max(0, totalCups - otherDrinksSold);
    }
    // ---------------------------------

    // Staff belum isi Sisa → terjual = yang lewat Kasir (0 kalau tak ada). Sisa diisi manual tetap menang.
    const kasirQty = kasirQtyFor(prod);
    if ((prod.qty ?? '') === '' && ((prod.tambah ?? '') === '' || kasirQty > 0)) return kasirQty;
    const stockKey = getStockKey(prod);
    const displayNow = displayMap[stockKey] ?? displayMap[prod.name] ?? 0;
    const tambahDB = tambahMap[stockKey] ?? tambahMap[prod.name] ?? 0;
    const fisikTambah = parseQty(prod.tambah) || 0;
    const fisikAkhir = parseQty(prod.qty) || 0;
    return Math.max(0, (displayNow + tambahDB + fisikTambah) - fisikAkhir);
  };

  // Stok/Laci Gudang: kolom safety_qty langsung, bukan diturunkan dari current_qty - display_qty.
  // Gudang itu independen — staff ambil dari situ kapan saja tanpa lewat "pengiriman", jadi
  // ga ada hubungan matematis wajib sama Awal/Tambah Display. current_qty ikut naik tiap ada
  // aksi Tambah ATAU Restock (lihat AdminInventory.jsx), sedang display_qty cuma di-reset pas
  // Set Manual — jadi current_qty-display_qty sebenarnya = safety_qty+tambah_qty tercampur,
  // bukan safety_qty murni. Baca langsung dari kolom safety_qty biar akurat & independen.
  const calcSafetyRemaining = (prod, freshSafetyMap, productKey) => {
    const key = productKey ?? getDetailKey(prod);
    const stockKey = getStockKey(prod);
    return freshSafetyMap[key] ?? freshSafetyMap[stockKey] ?? freshSafetyMap[prod.name] ?? 0;
  };

  // Sisa display yang disimpan ke laporan (agar shift berikutnya bisa load Awal = Sisa Excel)
  const getEffectiveDisplaySisa = (prod, tambahDisplayMap, productKey, liveDisplayMap = null) => {
    if (prod.qty !== '' && prod.qty !== null && prod.qty !== undefined) {
      return parseQty(prod.qty) || 0;
    }
    const stockKey = getStockKey(prod);
    // Sumber kebenaran: display_qty LIVE (sudah termasuk semua Pindah ke Display / kiriman /
    // kurasi shift ini) dikurangi terjual. Fallback lama (displayAtShiftStart + tambah) hanya
    // dipakai kalau map live tidak dikasih — snapshot Awal itu bisa basi & buang selisih diam-diam.
    if (liveDisplayMap && !prod.is_unlimited && (liveDisplayMap[stockKey] ?? liveDisplayMap[prod.name]) !== undefined) {
      const live = liveDisplayMap[stockKey] ?? liveDisplayMap[prod.name] ?? 0;
      return Math.max(0, live - getProductSoldQty(prod));
    }
    const key = productKey ?? getDetailKey(prod);
    const displayAwal = displayAtShiftStart[stockKey] ?? displayAtShiftStart[prod.name] ?? 0;
    return displayAwal + (tambahDisplayMap[key] ?? 0);
  };

  const getPureSoldQty = (prod) => {
    const rawSold = getProductSoldQty(prod);
    if (prod.name === 'Es Teh') {
      const variant = prod.variant || 'Standar';
      let susuSold = 0;
      products.forEach(otherProd => {
        if (otherProd.name !== 'Es Teh' && (otherProd.variant || 'Standar') === variant) {
          const isAlreadySubtracted = CUP_SUBTRACTOR_DRINKS.some(d => d.toLowerCase() === (otherProd.name ? otherProd.name.trim().toLowerCase() : ''));
          const nonCupFlavors = ['Strawberry', 'Melon', 'Avocado', 'Green Tea', 'Green Tea Latte', 'Choco Oreo', 'Taro', 'Hazelnut', 'Brown Sugar', 'Salted Caramel', 'Madu Hutan'];
          // HANYA kurangi jika produk ditandai sebagai Susu Base DAN belum dikurangi sebelumnya
          if (otherProd.is_unlimited && !isAlreadySubtracted && !nonCupFlavors.includes(otherProd.name)) {
            susuSold += getProductSoldQty(otherProd);
          }
          // Jika Dual Base, kurangi sejumlah porsi yang dipakaikan susu
          if (otherProd.is_dual_base) {
            susuSold += parseInt(otherProd.susu_qty) || 0;
          }
        }
      });
      return Math.max(0, rawSold - susuSold);
    }
    return rawSold;
  };

  const calculateTotals = () => {
    let totals = { cupOri: 0, cupPremi: 0, revenue: 0, expense: 0 };

    // Revenue dari products (kalkulasi terjual = master - input fisik akhir)
    products.forEach(p => {
      const pureSoldQty = getPureSoldQty(p);
      const soldQty = getProductSoldQty(p); // Total fisik terjual

      if (soldQty > 0) {
        const nonCupFlavors = [
          'Strawberry', 'Melon', 'Avocado', 'Green Tea', 'Green Tea Latte',
          'Choco Oreo', 'Taro', 'Hazelnut', 'Brown Sugar', 'Salted Caramel', 'Madu Hutan'
        ];

        const pNameLower = (p.name || '').toLowerCase();
        const isDynamicTopping = pNameLower.includes('bubble') || pNameLower.includes('jelly') || pNameLower.includes('pudding') || pNameLower.includes('cao');

        if (p.category !== 'Bahan' && (p.category || 'Lainnya') !== 'Topping' && !isDynamicTopping && !p.is_non_base && !nonCupFlavors.includes(p.name)) {
          // Deteksi variant: cek field variant dulu, jika 'Standar' cek dari nama produk
          let variant = (p.variant || 'Standar').toLowerCase();
          let isPremiProduct = variant.includes('premi');
          if (!isPremiProduct && (variant === 'standar' || !p.variant)) {
            if (p.name.trim().toLowerCase().endsWith(' premi')) isPremiProduct = true;
          }
          // Hitung total cup menggunakan soldQty (fisik terjual sesungguhnya)
          if (isPremiProduct) totals.cupPremi += soldQty;
          else totals.cupOri += soldQty;
        }

        // Revenue dari fisik terjual normal (kecuali Bubble yang dihitung dari porsi_terpakai)
        if (!(p.name && p.name.toLowerCase().includes('bubble'))) {
          totals.revenue += soldQty * (parseInt(p.price) || 0);
        }

        // Revenue tambahan dari susu jika Dual Base
        if (p.is_dual_base && parseInt(p.susu_qty) > 0) {
          totals.revenue += (parseInt(p.susu_qty) || 0) * (parseInt(p.susu_add_price) || 0);
        }

        // TAMBAHAN: Untuk Jelly, Pudding, Cao (jika harga di DB kosong, fallback ke 2000)
        const pName = (p.name || '').toLowerCase();
        if (pName.includes('jelly') || pName.includes('pudding') || pName.includes('cao')) {
          if (!parseInt(p.price)) {
            // Karena di atas sudah ditambah (soldQty * 0), kita tambahkan manual harga fallback 2000
            totals.revenue += soldQty * 2000;
          }
        }
      }

      // TAMBAHAN: Revenue dari Topping yang HANYA pakai porsi_terpakai (Bubble)
      if (p.name && p.name.toLowerCase().includes('bubble') && p.porsi_terpakai) {
        totals.revenue += (parseInt(p.porsi_terpakai) || 0) * (parseInt(p.price) || 2000);
      }
    });

    // Pengeluaran
    expenses.forEach(e => { totals.expense += parseInt(e.amount) || 0; });

    return totals;
  };

  const totals = calculateTotals();
  const cashAkhir = (parseInt(cashAwal) || 0) + totals.revenue - totals.expense;
  const hasSales = products.some(p => getProductSoldQty(p) > 0);


  // F6: hapus log "Auto-Deduct Shift N" milik close yang barusan dibatalkan lewat
  // Buka Ulang Shift. Anchor ke marker "Tutup Shift N" (ditulis di close yg sama, tepat
  // sesudah laporan tersimpan & SEBELUM potong stok → log Auto-Deduct-nya sedikit sesudahnya;
  // laporan lama sebelum 29 Sep: marker sesudah Auto-Deduct).
  // ponytail: window -5mnt..+5mnt dari marker, bukan id/tag pasti. Kalau ada 2 close
  // Shift N dalam 5 menit di outlet yang sama (praktis tak terjadi), bisa kena yg salah.
  // Upgrade: tulis close_id di petugas_name saat Tutup Shift & pakai itu.
  const deleteAutoDeductLogsForClose = async (branchName, shiftNum) => {
    const { data: mark } = await supabase.from('stock_restock_log')
      .select('created_at').eq('branch_name', branchName).eq('item_name', 'Status Aktivitas')
      .ilike('petugas_name', `%Tutup Shift ${shiftNum}%`)
      .order('created_at', { ascending: false }).limit(1);
    if (!mark?.[0]) return;
    const t = new Date(mark[0].created_at).getTime();
    await supabase.from('stock_restock_log').delete()
      .eq('branch_name', branchName)
      .ilike('petugas_name', `%Auto-Deduct Shift ${shiftNum}%`)
      .gte('created_at', new Date(t - 300000).toISOString())
      .lte('created_at', new Date(t + 300000).toISOString());
  };

  const handleReopenShift = async (reportData, branchName, shiftNum) => {
    setIsSaving(true);
    try {
      const staffName = userData?.name || 'Admin';
      const todayStr = reportData.date;
      // ── Jalur baru: snapshot restore-point (dibuat saat Tutup Shift sejak 2 Sep 2026) ──
      const snap = (reportData.details || []).find(d => d._is_preclose_snapshot);

      if (snap && Array.isArray(snap.rows) && snap.rows.length > 0) {
        // Guard: snapshot basi kalau ada shift lain yang ditutup SETELAH shift ini.
        const { data: newerReports } = await supabase
          .from('sales_reports')
          .select('shift')
          .eq('branch_name', branchName)
          .eq('date', todayStr)
          .gt('shift', String(shiftNum));
        if (newerReports && newerReports.length > 0) {
          alert(`Tidak bisa buka ulang Shift ${shiftNum}.\nShift ${newerReports.map(r => r.shift).join(', ')} sudah ditutup setelahnya — buka ulang shift terakhir dulu.`);
          setIsSaving(false);
          checkExistingShifts(branchName);
          return;
        }

        const { data: liveRows } = await supabase
          .from('branch_inventory')
          .select('item_name, current_qty')
          .eq('branch_name', branchName);
        const liveQtyMap = Object.fromEntries((liveRows || []).map(r => [r.item_name, r.current_qty ?? 0]));

        // Kembalikan branch_inventory PERSIS ke keadaan sebelum Tutup Shift.
        await supabase.from('branch_inventory').upsert(
          snap.rows.map(r => ({
            branch_name: branchName, item_name: r.item_name,
            current_qty: r.current_qty, display_qty: r.display_qty,
            safety_qty: r.safety_qty, tambah_qty: r.tambah_qty,
          })),
          { onConflict: 'branch_name,item_name' }
        );

        const adjLogs = snap.rows
          .map(r => {
            const before = liveQtyMap[r.item_name] ?? 0;
            const after = r.current_qty ?? 0;
            return { item_name: r.item_name, diff: after - before, before, after };
          })
          .filter(x => Math.abs(x.diff) > 0.0001)
          .map(x => ({
            branch_name: branchName, item_name: x.item_name, qty_added: x.diff,
            qty_before: x.before, qty_after: x.after,
            petugas_name: `${staffName} (Reversal Buka Ulang Shift ${shiftNum})`,
          }));
        if (adjLogs.length > 0) await supabase.from('stock_restock_log').insert(adjLogs);

        // Buang log "Auto-Deduct Shift N" dari close yang dibatalkan — kalau tidak,
        // pas Tutup Shift lagi jumlahnya numpuk & "Penjualan" di Kartu Stok / Riwayat
        // Aktivitas Stok jadi berlipat (stok fisik sudah benar dari restore di atas).
        await deleteAutoDeductLogsForClose(branchName, shiftNum);

        await supabase.from('sales_reports').delete().eq('id', reportData.id);

        if (snap.display_at_shift_start && typeof snap.display_at_shift_start === 'object') {
          setDisplayAtShiftStart(snap.display_at_shift_start);
        }

        const meta = (reportData.details || []).find(d => d._is_meta && !d._is_preclose_snapshot);
        setProducts(prev => prev.map(p => {
          const dp = (reportData.details || []).find(d =>
            !d._is_meta && !d._is_inventory_snapshot && !d._is_preclose_snapshot &&
            d.name === p.name && (d.variant === p.variant || (d.variant === 'Standar' && !p.variant)));
          if (!dp) return p;
          return {
            ...p,
            qty: (dp.sisa_input === null || dp.sisa_input === undefined) ? '' : dp.sisa_input,
            tambah: dp.tambah ? String(dp.tambah) : '',
            tambah_safety: dp.tambah_safety ? String(dp.tambah_safety) : '',
            porsi_terpakai: dp.porsi_terpakai ? String(dp.porsi_terpakai) : '',
            porsi_rusak: dp.porsi_rusak ? String(dp.porsi_rusak) : '',
            susu_qty: dp.susu_qty || 0,
          };
        }));
        if (reportData.expenses) {
          setExpenses(reportData.expenses.map((e, idx) => ({ id: idx, name: e.name, amount: e.amount })));
        }
        if (reportData.cash_awal) setCashAwal(reportData.cash_awal);
        if (meta) {
          if (typeof meta.note === 'string') setCatatan(meta.note.split(' | [Sistem]')[0].trim());
          if (meta.setoran_aktual) setSetoranAktual(String(meta.setoran_aktual));
        }
      } else {
        // ── Jalur lama (laporan tanpa snapshot): reversal Auto-Deduct perkiraan ±60 detik ──
        const deductQueryString = `%Auto-Deduct Shift ${shiftNum}%`;
        let minTime, maxTime;
        if (reportData.created_at) {
          const reportTime = new Date(reportData.created_at).getTime();
          if (!isNaN(reportTime)) {
            minTime = new Date(reportTime - 60000).toISOString();
            maxTime = new Date(reportTime + 60000).toISOString();
          }
        }

        let query = supabase
          .from('stock_restock_log')
          .select('*')
          .eq('branch_name', branchName)
          .like('petugas_name', deductQueryString);

        if (minTime && maxTime) {
          query = query.gte('created_at', minTime).lte('created_at', maxTime);
        } else {
          query = query.gte('created_at', `${todayStr}T00:00:00`).lte('created_at', `${todayStr}T23:59:59`);
        }

        const { data: logs, error: logsErr } = await query;

        if (!logsErr && logs && logs.length > 0) {
          for (const log of logs) {
            if (log.qty_added < 0 && !log.petugas_name.includes('SELISIH')) { // SELISIH = catatan, bukan potongan
              const reverseAmount = Math.abs(log.qty_added);
              const { data: invData } = await supabase
                .from('branch_inventory')
                .select('current_qty')
                .eq('branch_name', branchName)
                .eq('item_name', log.item_name)
                .single();
              if (invData) {
                await supabase
                  .from('branch_inventory')
                  .update({ current_qty: invData.current_qty + reverseAmount })
                  .eq('branch_name', branchName)
                  .eq('item_name', log.item_name);
              }
              await supabase.from('stock_restock_log').insert([{
                branch_name: branchName,
                item_name: log.item_name,
                qty_added: reverseAmount,
                qty_before: invData ? invData.current_qty : 0,
                qty_after: invData ? (invData.current_qty + reverseAmount) : 0,
                petugas_name: `${staffName} (Reversal Buka Ulang Shift ${shiftNum})`
              }]);
            }
          }
        }

        await supabase.from('sales_reports').delete().eq('id', reportData.id);

        if (reportData.details && reportData.details.length > 0) {
          setProducts(prev => prev.map(p => {
            const detailP = reportData.details.find(dp => dp.name === p.name && (dp.variant === p.variant || (dp.variant === 'Standar' && !p.variant)));
            if (detailP) {
              let restoredQty = detailP.sisa_input;
              if (restoredQty === 0) restoredQty = 0;
              else if (!restoredQty && restoredQty !== 0) restoredQty = '';
              return { ...p, qty: restoredQty, tambah: '' };
            }
            return p;
          }));
        }

        if (reportData.expenses) {
          setExpenses(reportData.expenses.map((e, idx) => ({ id: idx, name: e.name, amount: e.amount })));
        }
        if (reportData.cash_awal) setCashAwal(reportData.cash_awal);
      }

      setExistingShifts(prev => prev.filter(s => s !== shiftNum));

      // Buka ulang Shift 2: pulihkan bawaan porsi Bubble dari Shift 1 induk (handleReopenShift
      // tidak lewat jalur handoff di handleOpenShift, jadi porsi_sisa_awal bisa basi = 0).
      if (String(shiftNum) === '2') {
        let s1 = await supabase.from('sales_reports').select('date, details')
          .eq('branch_name', branchName).eq('date', todayStr).eq('shift', '1').limit(1);
        if (!s1.data || s1.data.length === 0) {
          s1 = await supabase.from('sales_reports').select('date, details')
            .eq('branch_name', branchName).eq('shift', '1').order('date', { ascending: false }).limit(1);
        }
        if (s1.data && s1.data.length > 0) {
          const porsiMap = {};
          (s1.data[0].details || []).forEach(d => {
            if (d._is_meta || d._is_inventory_snapshot) return;
            if (d.name && d.name.toLowerCase().includes('bubble') && d.porsi_sisa !== undefined) porsiMap[d.name] = d.porsi_sisa;
          });
          setProducts(prev => prev.map(p => porsiMap[p.name] !== undefined ? { ...p, porsi_sisa_awal: porsiMap[p.name] } : p));
        }
      }

      // Refetch inventory map so UI reflects the reversed stock immediately!
      await fetchInventory(branchName);

      setIsShiftStarted(true);
      setCurrentSession({ id: 'local_' + Date.now() });
      localStorage.setItem('pos_active_session', JSON.stringify({ branch: branchName, shift: shiftNum, date: selectedDate }));

      alert(`Berhasil membuka ulang Shift ${shiftNum}. Stok telah dikembalikan seperti semula dan form siap diedit.`);
    } catch (err) {
      console.error(err);
      alert(`Terjadi kesalahan saat membuka ulang shift: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // ── Session Management: Open Shift ────────────────────────────

  const handleOpenShift = async () => {
    if (!selectedBranch || !shift) {
      alert('Pilih cabang dan shift terlebih dahulu.');
      return;
    }

    const branchName = selectedBranch || 'Cabang Pusat';
    const staffName = userData?.name || 'Staff';

    // ── Race condition & Duplication check by re-fetching from DB ──
    const todayStr = selectedDate;
    const { data: currentReports, error: checkErr } = await supabase
      .from('sales_reports')
      .select('*')
      .eq('branch_name', branchName)
      .eq('date', todayStr);

    if (!checkErr && currentReports) {
      // Check if the exact shift has already been completed today
      const shiftAlreadyDone = currentReports.some(r => r.shift === shift);
      if (shiftAlreadyDone) {
        if ((['admin', 'administrator', 'owner'].includes(userData?.role?.toLowerCase())) || userData?.role === 'administrator') {
          const confirmReopen = window.confirm(`Shift ${shift} sudah ditutup.\nApakah Anda yakin ingin membuka ulang shift ini? Laporan sebelumnya akan dibatalkan dan stok akan dikembalikan.`);
          if (confirmReopen) {
            const reportToReopen = currentReports.find(r => r.shift === shift);
            await handleReopenShift(reportToReopen, branchName, shift);
            return;
          }
        } else {
          alert(`Gagal membuka Shift ${shift}.\nShift ini sudah selesai dikerjakan dan direkap pada hari ini.`);
        }
        checkExistingShifts(branchName); // update UI
        return;
      }
    }

    // Ensure Shift 1 must exist before Shift 2 can be opened
    if (shift === '2') {
      const shift1Exists = (currentReports || existingShiftsData).some(r => r.shift === '1');
      if (!shift1Exists) {
        alert('Gagal membuka Shift 2.\nShift 1 harus dibuka dan diselesaikan terlebih dahulu agar data dapat digabungkan.');
        return;
      }
    }

    setIsSaving(true);

    try {
      // Lipat tambah_qty yang nyangkut dari sesi sebelumnya (belum sempat ke-reset lewat
      // Simpan Laporan, misal sesi ditinggal tanpa ditutup) ke display_qty. Tanpa ini,
      // "Tambahan" yang tampil di shift baru ikut numpuk kiriman lama yang sebenarnya
      // sudah jadi bagian dari stok Awal, bukan tambahan hari ini.
      // Susulan (tanggal lampau & belum ada laporan sesudahnya, mis. admin isi CS 8 Okt pada 9 Okt):
      // JANGAN lipat — tambah_qty itu kiriman hari susulan itu sendiri, bukan sisa sesi lama.
      const _today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];
      let isSusulan = false;
      if (selectedDate < _today) {
        const { data: laterReps } = await supabase.from('sales_reports').select('id')
          .eq('branch_name', branchName).gt('date', selectedDate).limit(1);
        isSusulan = !(laterReps && laterReps.length);
      }
      const { data: staleInv } = isSusulan ? { data: [] } : await supabase.from('branch_inventory')
        .select('item_name, display_qty, tambah_qty, current_qty')
        .eq('branch_name', branchName)
        .gt('tambah_qty', 0);
      if (staleInv && staleInv.length > 0) {
        await Promise.all(staleInv.map(row =>
          supabase.from('branch_inventory').update({
            display_qty: (row.display_qty || 0) + row.tambah_qty,
            // current_qty (total) HARUS ikut naik — kalau ngga, current_qty jadi lebih kecil
            // dari display_qty dan validasi "sisa > master awal" pakai angka basi (lihat
            // handlePreSubmit yang baca inventoryMap = current_qty).
            current_qty: (row.current_qty || 0) + row.tambah_qty,
            tambah_qty: 0
          }).eq('branch_name', branchName).eq('item_name', row.item_name)
        ));
      }

      // Fetch inventory + snapshot displayAtShiftStart dari DB
      const { displayMap: freshDisplayMap } = await fetchInventory(branchName);
      setDisplayAtShiftStart(isSusulan ? await getAwalSinceLastClose(branchName) : freshDisplayMap);

      // Fetch porsi_sisa from the last shift report (masih diperlukan untuk Bubble).
      // id itu UUID (bukan urut waktu, jangan sort pakai itu) — dan tabel ini gak punya
      // kolom created_at (select itu selalu error 42703 sebelum fix ini, bikin lastRep
      // selalu null/kosong). Urutan yang bener: date lalu shift, sama-sama descending.
      let lastRep;
      let shift2Parent = false; // true = lastRep itu Shift 1 induk dari Shift 2 ini -> porsi SELALU lanjut
      if (shift === '2') {
        // Buka Shift 2 = lanjutan Shift 1 hari laporan yang sama. Porsi Bubble HARUS lanjut
        // dari Shift 1 itu, apapun tanggal kalendernya (admin bisa entry susulan H+1/H+2).
        // Ambil S1 tanggal terpilih dulu; kalau kosong, S1 terakhir yang ada.
        let r = await supabase.from('sales_reports').select('date, details')
          .eq('branch_name', branchName).eq('date', todayStr).eq('shift', '1').limit(1);
        if (!r.data || r.data.length === 0) {
          r = await supabase.from('sales_reports').select('date, details')
            .eq('branch_name', branchName).eq('shift', '1')
            .order('date', { ascending: false }).limit(1);
        }
        if (r.data && r.data.length > 0) { lastRep = r.data; shift2Parent = true; }
      }
      if (!lastRep || lastRep.length === 0) {
        const r = await supabase.from('sales_reports').select('date, details')
          .eq('branch_name', branchName)
          .order('date', { ascending: false })
          .order('shift', { ascending: false })
          .limit(1);
        lastRep = r.data;
      }

      // Kiriman yang masih 'pending' dari hari sebelumnya (belum di-ACC/tolak outlet) otomatis
      // kedaluwarsa pas ganti hari — jangan biarkan nyangkut buat di-ACC/tolak lagi hari ini.
      if (lastRep && lastRep.length > 0 && lastRep[0].date !== todayStr) {
        await supabase.from('pending_stock_actions')
          .update({ status: 'expired' })
          .eq('target_branch', branchName)
          .eq('status', 'pending')
          .lt('created_at', `${todayStr}T00:00:00`);
      }

      let lastPorsiSisaMap = {};
      let lastRepTime = null; // sales_reports gak punya created_at — window transfer dari getPorsiWindowStart di bawah
      if (lastRep && lastRep.length > 0 && lastRep[0].details) {
        const isSameDay = shift2Parent || lastRep[0].date === todayStr;
        lastRep[0].details.forEach(p => {
          if (p._is_meta || p._is_inventory_snapshot) return;
          if (p.name && p.name.toLowerCase().includes('bubble')) {
            if (!isSameDay) {
              lastPorsiSisaMap[p.name] = 0; // Beda hari, sisa porsi hangus
            } else if (p.porsi_sisa !== undefined) {
              lastPorsiSisaMap[p.name] = p.porsi_sisa;
            } else {
              const bungkusKeluar = parseInt(p.terjual_fisik) || parseInt(p.total_fisik) || 0;
              const porsiTerpakai = parseInt(p.porsi_terpakai) || 0;
              const porsiRusak = parseInt(p.porsi_rusak) || 0;
              const multiplier = p.name.toLowerCase().includes('kecil') ? 10 : 20;
              const totalPorsi = bungkusKeluar * multiplier;
              lastPorsiSisaMap[p.name] = Math.max(0, totalPorsi - porsiTerpakai - porsiRusak);
            }
          }
        });
      }

      // Transfer yang dihitung = sesudah laporan basis ditutup (sebelumnya udah ke-bake di porsi_sisa-nya)
      lastRepTime = await getPorsiWindowStart(supabase, branchName, lastRep?.[0]);

      // Check for Porsi transfers since last report (masih diperlukan untuk Bubble)
      let queryPorsiLogs = supabase
        .from('stock_restock_log')
        .select('item_name, qty_added')
        .eq('branch_name', branchName)
        .in('item_name', ['Porsi Bubble Besar', 'Porsi Bubble Kecil']);

      if (lastRepTime) {
        queryPorsiLogs = queryPorsiLogs.gt('created_at', lastRepTime);
      }

      let lastPorsiTransferMap = {};
      const { data: porsiLogs } = await queryPorsiLogs;
      if (porsiLogs) {
        porsiLogs.forEach(log => {
          const baseName = log.item_name.replace('Porsi ', ''); // 'Bubble Besar' or 'Bubble Kecil'
          lastPorsiTransferMap[baseName] = (lastPorsiTransferMap[baseName] || 0) + log.qty_added;
        });
      }

      // applyShiftHandoff: display_awal & safety_awal dihapus (sekarang dari displayMap DB)
      const applyShiftHandoff = (p, extra = {}) => ({
        ...p,
        porsi_sisa_awal: lastPorsiSisaMap[p.name] || 0,
        porsi_transfer_awal: lastPorsiTransferMap[p.name] || 0,
        ...extra
      });

      // Coba load draft jika ada
      const draftKey = `pos_draft_${branchName}_shift${shift}`;
      const savedDraft = localStorage.getItem(draftKey);
      if (savedDraft) {
        try {
          const parsed = JSON.parse(savedDraft);
          // Load draft hanya jika umurnya kurang dari 24 jam
          if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
            if (parsed.products && parsed.products.length > 0) {
              setProducts(prev => prev.map(p => {
                const draftP = parsed.products.find(dp => dp.id === p.id);
                // display_awal & safety_awal selalu dari laporan sebelumnya (Excel),
                // draft hanya memulihkan isian qty/tambah
                return draftP ? applyShiftHandoff(p, { qty: draftP.qty ?? '', tambah: draftP.tambah ?? '', porsi_terpakai: draftP.porsi_terpakai ?? '', porsi_rusak: draftP.porsi_rusak ?? '', susu_qty: draftP.susu_qty ?? '', susu_add_price: draftP.susu_add_price ?? '' }) : applyShiftHandoff(p);
              }));
            }
            if (parsed.expenses && parsed.expenses.length > 0) setExpenses(parsed.expenses);
            if (parsed.cashAwal) setCashAwal(parsed.cashAwal);
            setTimeout(() => alert('Memulihkan isian sebelumnya (Draft) yang belum tersimpan.'), 300);
          } else {
            localStorage.removeItem(draftKey); // Hapus draft usang
            setProducts(prev => prev.map(p => applyShiftHandoff(p)));
          }
        } catch (e) {
          console.error('Gagal load draft', e);
          setProducts(prev => prev.map(p => applyShiftHandoff(p)));
        }
      } else {
        setProducts(prev => prev.map(p => applyShiftHandoff(p)));
      }

      // Baru nyalain isShiftStarted SETELAH draft ke-load — kalau dinyalain di awal (sebelum
      // await di atas), efek Auto-Save Draft sempat nembak duluan pas products masih kosong,
      // nimpa draft asli di localStorage sebelum sempat kebaca di atas.
      setIsShiftStarted(true);
      setCurrentSession({ id: 'local_' + Date.now() });
      localStorage.setItem('pos_active_session', JSON.stringify({ branch: branchName, shift, date: selectedDate }));

      // Log Activity: Online
      await supabase.from('stock_restock_log').insert([{
        branch_name: branchName,
        item_name: 'Status Aktivitas',
        qty_added: 0,
        qty_before: 0,
        qty_after: 0,
        // Susulan: jangan pakai teks "Buka ... Shift N" — log itu jadi batas bawah window aktivitas
        // shift, jadi kiriman/pindah stok hari susulan bakal kepotong dari laporan.
        petugas_name: isSusulan ? `${staffName} (Online - Susulan S${shift} tgl ${selectedDate})` : `${staffName} (Online - Buka Input Shift ${shift})`
      }]);

      fetchPendingActions(branchName);

      alert(`Shift ${shift} berhasil dibuka untuk ${branchName}.`);
    } catch (err) {
      alert(`Gagal membuka shift:\n${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // displayAtShiftStart itu snapshot beku diambil sekali pas shift dibuka (buat "Awal" di Kartu Stok).
  // Kalau admin koreksi stok (Set Stok) SETELAH shift ini jalan, snapshot lama gak ikut berubah
  // walau displayMap/tambahMap live udah update — makanya perlu tombol sinkron manual ini.
  // Ga nyentuh products.qty, jadi input penjualan yang lagi diisi staff aman.
  const handleSyncDisplayAwal = async () => {
    if (!selectedBranch) return;
    const { displayMap: freshDisplayMap } = await fetchInventory(selectedBranch);
    setDisplayAtShiftStart(freshDisplayMap);
    await applyShift1SisaAsAwal(selectedBranch);
    alert('Stok Awal sudah disinkronkan dari data terbaru.');
  };

  // Muat ulang paksa — buat HP yang masih nyimpen versi app lama sesudah update.
  // Buang cache browser + service worker, lalu reload. Draft isian aman (tersimpan di
  // localStorage, ke-load lagi otomatis).
  const [isHardRefreshing, setIsHardRefreshing] = useState(false);
  const handleHardRefresh = async () => {
    setIsHardRefreshing(true);
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if (navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
    } catch (e) {
      console.warn('hard refresh cleanup gagal (lanjut reload):', e);
    }
    // query pemecah cache biar index.html + bundle ditarik ulang, bukan dari bfcache
    window.location.replace(`${window.location.pathname}?_hr=${Date.now()}`);
  };

  // ── Validation Before Deposit Modal ─────────────────────────────
  const handlePreSubmit = (e) => {
    e.preventDefault();
    // Jualan Kasir dari device lain sejak tab ini terakhir difokus — ambil lagi sebelum konfirmasi
    // Tutup Shift, supaya laporan & potong stok pakai angka terbaru.
    kasirLoadRef.current?.();
    if (!hasSales) {
      alert('Isi qty penjualan terlebih dahulu sebelum menyimpan laporan.');
      return;
    }

    // Blocker keras (data pasti salah) — tetap ditahan, bukan sekadar konfirmasi.
    const _today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];
    for (const prod of products) {
      if (prod.qty !== '' && !prod.is_unlimited) {
        if (isInvalidFraction(prod)) {
          alert(`Angka sisa stok untuk ${prod.name} tidak valid. Pastikan takaran pecahan sudah benar (misal: 0.2, 0.4, atau 0.25, 0.5).`);
          return;
        }
        if ((parseQty(prod.qty) || 0) < 0) {
          alert(`Sisa Stok untuk ${getStockKey(prod)} tidak boleh bernilai negatif.`);
          return;
        }
      }
      if (prod.name.toLowerCase().includes('oatmilk')) {
        const soldQty = getProductSoldQty(prod);
        const stockKey = getStockKey(prod);
        const masterAwal = inventoryMap[stockKey] ?? inventoryMap[prod.name] ?? (STOCK_KEY_MAP[prod.name] ? inventoryMap[STOCK_KEY_MAP[prod.name]] : undefined) ?? 0;
        if (soldQty > masterAwal) {
          alert(`Gagal menyimpan: Penjualan Matcha Oat Latte membutuhkan ${soldQty} kotak Oatmilk, namun stok awal Oatmilk hanya ${masterAwal} kotak. Mohon periksa kembali inputan sisa stok Matcha Oat Latte Anda.`);
          return;
        }
      }
    }

    // SATU konfirmasi sebelum Tutup Shift. Kumpulin semua peringatan lunak jadi satu dialog
    // (tanggal bukan hari ini, sisa > stok tersedia, Awal+Tambah-Jual != Sisa) lalu tutup
    // dengan pertanyaan opname.
    const warns = [];
    if (selectedDate !== _today && getActiveShiftDate() === selectedDate) {
      warns.push(`• Shift dibuka tanggal ${selectedDate} dan lewat tengah malam — laporan tetap masuk tanggal ${selectedDate}. Ini normal, lanjut saja.`);
    } else if (selectedDate !== _today) {
      warns.push(`• Laporan disimpan untuk tanggal ${selectedDate} — BUKAN hari ini (${_today}). Kalau bukan entry susulan yang disengaja, BATAL & betulkan tanggal dulu.`);
    }
    for (const prod of products) {
      if (prod.qty === '' || prod.is_unlimited) continue;
      const stockKey = getStockKey(prod);
      const awal = displayMap[stockKey] ?? displayMap[prod.name]
        ?? inventoryMap[stockKey] ?? inventoryMap[prod.name]
        ?? (STOCK_KEY_MAP[prod.name] ? (displayMap[STOCK_KEY_MAP[prod.name]] ?? inventoryMap[STOCK_KEY_MAP[prod.name]]) : undefined) ?? 0;
      const tambahDB = tambahMap[stockKey] ?? tambahMap[prod.name] ?? 0;
      const fisikTambah = parseQty(prod.tambah) || 0;
      const sisa = parseQty(prod.qty) || 0;
      const totalAvailable = awal + tambahDB + fisikTambah;
      if (sisa > totalAvailable + 0.001) {
        warns.push(`• Sisa ${stockKey} = ${formatFraction(sisa)} melebihi stok tersedia (${formatFraction(totalAvailable)}) — isi kolom Tambah kalau ada stok belum dicatat.`);
        continue;
      }
      const jual = getProductSoldQty(prod);
      // Sisa manual bikin Terjual < yang tercatat di Kasir = ada struk yang tidak masuk laporan.
      const kasirQ = kasirQtyFor(prod);
      if (kasirQ > jual + 0.001) {
        warns.push(`• ${stockKey}: Kasir sudah jual ${formatFraction(kasirQ)}, tapi dari Sisa yang diisi terjual cuma ${formatFraction(jual)} — cek Sisa (kosongkan biar otomatis).`);
      }
      const expected = awal + tambahDB + fisikTambah - jual;
      if (Math.abs(expected - sisa) > 0.001) {
        warns.push(`• ${stockKey}: ${formatFraction(awal)}+${formatFraction(tambahDB + fisikTambah)}-${formatFraction(jual)} = ${formatFraction(expected)}, Sisa diisi ${formatFraction(sisa)}`);
      }
    }

    const head = warns.length > 0
      ? `Perlu dicek dulu (selisih wajar kalau ada kurasi / pindah stok / barang rusak):\n\n${warns.slice(0, 14).join('\n')}${warns.length > 14 ? `\n... dan ${warns.length - 14} lagi` : ''}\n\n`
      : '';
    if (!window.confirm(`${head}Sudah kamu pastikan semua stok cocok dengan hitungan fisik (opname)?\nKalau yakin, lanjut Tutup Shift ${shift}.`)) {
      return;
    }

    setSetoranAktual(''); // Reset input
    setIsDepositModalOpen(true); // Open Modal
  };

  // ── Full Submit: Save + Deduct + Export Excel ─────────────────
  const processSubmit = async () => {
    setIsSaving(true);
    const branchName = selectedBranch || 'Cabang Pusat';
    const staffName = userData?.name || 'Staff';
    const todayDate = selectedDate;
    const cleanedSetoran = parseInt(String(setoranAktual).replace(/\D/g, '')) || 0;

    try {
      // 0a. PRE-FLIGHT KONEKSI — cek server bisa dijangkau SEBELUM sentuh stok apa pun.
      // Kalau sinyal bermasalah: batalkan total. Jangan sampai stok kepotong tapi laporan gagal.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setIsSaving(false); setIsDepositModalOpen(false);
        alert('❌ Tidak ada koneksi internet.\n\nTutup Shift DIBATALKAN — stok TIDAK dipotong, laporan TIDAK disimpan.\nSambungkan internet dulu, lalu Tutup Shift lagi.');
        return;
      }
      try {
        const pf = await supabase.from('sales_reports').select('id', { head: true, count: 'exact' }).eq('branch_name', branchName).limit(1);
        if (pf.error) throw new Error(pf.error.message);
      } catch (pfErr) {
        setIsSaving(false); setIsDepositModalOpen(false);
        alert(`❌ Server tidak merespons (sinyal bermasalah).\n\nTutup Shift DIBATALKAN — stok TIDAK dipotong, laporan TIDAK disimpan.\nCoba lagi saat koneksi stabil.\n\n(${pfErr.message})`);
        return;
      }
      // App versi lama jangan sampai Tutup Shift — logika potong stoknya bisa sudah salah.
      if (await isStaleBuild()) {
        setIsSaving(false); setIsDepositModalOpen(false);
        alert('Ada versi app baru.\n\nTutup Shift DIBATALKAN — halaman dimuat ulang dulu. Isian kamu aman (draft tersimpan).\nSesudah terbuka lagi, cek isian lalu Tutup Shift lagi.');
        window.location.reload();
        return;
      }

      // Shift 2 = kesempatan terakhir ACC: kiriman 'pending' yang tidak di-ACC sampai Tutup Shift 2 hangus
      // (kedaluwarsa pas ganti hari) dan stoknya tidak pernah masuk. Peringatkan dulu — staff boleh tetap tutup.
      if (shift === '2') {
        const { data: stillPending } = await supabase.from('pending_stock_actions').select('item_name, qty')
          .eq('target_branch', branchName).eq('status', 'pending');
        if (stillPending && stillPending.length > 0) {
          const list = stillPending.slice(0, 12).map(a => `• ${a.qty} ${a.item_name}`).join('\n') + (stillPending.length > 12 ? `\n… dan ${stillPending.length - 12} lainnya` : '');
          if (!window.confirm(`Masih ada ${stillPending.length} kiriman/operan yang BELUM di-ACC:\n\n${list}\n\nKalau Tutup Shift 2 sekarang, kiriman ini hangus (kedaluwarsa saat ganti hari) dan stoknya TIDAK masuk — gudang harus kirim ulang.\n\nOK = tetap Tutup Shift.\nBatal = kembali, ACC dulu.`)) {
            setIsSaving(false); setIsDepositModalOpen(false);
            return;
          }
        }
      }

      // 0. Double check duplicate submit to prevent double entry
      const { data: currentReports, error: checkErr } = await supabase
        .from('sales_reports')
        .select('*')
        .eq('branch_name', branchName)
        .eq('date', todayDate)
        .eq('shift', shift);

      if (!checkErr && currentReports && currentReports.length > 0) {
        // Dulu cuma setIsShiftStarted(false) — pos_active_session tetap ada, reload balik lagi ke
        // shift yang sama & staff nyangkut. Lepas sesinya, isian disimpan sebagai draft.
        setIsSaving(false);
        await handleStaleSession({ branch: branchName, date: todayDate, shift });
        return;
      }

      // Fetch latest inventory to properly account for any restocks via WTR during the shift
      const { totalMap: realtimeInventoryMap, tambahMap: realtimeTambahMap } = await fetchInventory(branchName);

      // Snapshot penuh branch_inventory PERSIS sebelum potong stok & timpa display_qty.
      // Dipakai handleReopenShift untuk mengembalikan state ke detik sebelum Tutup Shift ditekan.
      const { data: preCloseInvRows } = await supabase
        .from('branch_inventory')
        .select('item_name, current_qty, display_qty, safety_qty, tambah_qty')
        .eq('branch_name', branchName);
      // SATU snapshot konsisten dipakai buat sisa_input laporan DAN potong stok di bawah —
      // jadi angka "Sisa" di laporan == angka yang ditulis ke display_qty, tidak melenceng.
      const preCloseByItem = Object.fromEntries((preCloseInvRows || []).map(r => [r.item_name, r]));
      const preCloseDisplayMap = Object.fromEntries((preCloseInvRows || []).map(r => [r.item_name, r.display_qty ?? 0]));

      // 0.5 Ambil data penambahan riil dari Laci Stok (berdasarkan shift dan hari ini)
      const [y, m, d] = todayDate.split('-');
      const startOfDayObj = new Date(parseInt(y), parseInt(m) - 1, parseInt(d), 0, 0, 0);
      const endOfDayObj = new Date(parseInt(y), parseInt(m) - 1, parseInt(d), 23, 59, 59, 999);
      const startOfDay = startOfDayObj.toISOString();

      // Batas dilebarkan: kalau tanggal admin masih ketinggalan (selectedDate stale),
      // aktivitas shift hari ini (Pindah ke Display dll) tetap ke-fetch. Window shift yang
      // sebenarnya di-narrow lagi di filter shiftLogs di bawah.
      const logLo = new Date(Math.min(startOfDayObj.getTime(), Date.now() - 48 * 3600 * 1000)).toISOString();
      const logHi = new Date(Math.max(endOfDayObj.getTime(), Date.now() + 3600 * 1000)).toISOString();
      const { data: allLogs, error: logsErr } = await supabase
        .from('stock_restock_log')
        .select('item_name, qty_added, qty_after, created_at, petugas_name')
        .eq('branch_name', branchName)
        .gte('created_at', logLo)
        .lte('created_at', logHi)
        .not('petugas_name', 'ilike', '%Auto-Deduct%');

      const { data: closeLogs } = await supabase.from('stock_restock_log').select('created_at')
        .eq('branch_name', branchName).eq('item_name', 'Status Aktivitas')
        .ilike('petugas_name', '%Tutup Shift%').order('created_at', { ascending: false }).limit(1);
      const lastRepTime = (closeLogs && closeLogs.length > 0) ? new Date(closeLogs[0].created_at).getTime() : 0;

      // Batas bawah shift = waktu "Buka Input Shift N" TERAKHIR. Kalau shift dibuka ulang,
      // aktivitas sebelum buka-ulang (mis. Pindah ke Display) sudah baked-in ke snapshot Awal
      // yang baru — jangan dihitung lagi (double count) di kolom Tambah.
      const { data: openLogs } = await supabase.from('stock_restock_log').select('created_at')
        .eq('branch_name', branchName).eq('item_name', 'Status Aktivitas')
        .ilike('petugas_name', `%Buka%Shift ${shift}%`).order('created_at', { ascending: false }).limit(1);
      const lastOpenTime = openLogs?.[0] ? new Date(openLogs[0].created_at).getTime() : 0;

      let shiftLogs = [];
      let koreksiLogs = [];
      if (allLogs && !logsErr) {
        // sales_reports gak punya kolom created_at (query itu selalu error 42703 sebelumnya,
        // s1Reps/s2Reps selalu kosong diam-diam). Waktu batas shift yang bener justru ada
        // di log "Tutup Shift N" sendiri (stock_restock_log), sama pola kayak lastRepTime di atas.
        const { data: s1CloseLogs } = await supabase.from('stock_restock_log').select('created_at')
          .eq('branch_name', branchName).eq('item_name', 'Status Aktivitas')
          .ilike('petugas_name', '%Tutup Shift 1%').order('created_at', { ascending: false }).limit(1);

        const s1Time = s1CloseLogs?.[0] ? new Date(s1CloseLogs[0].created_at).getTime() : Date.now();
        const s2Time = Date.now();

        shiftLogs = allLogs.filter(log => {
          const t = new Date(log.created_at).getTime();
          // Pindah Stok->Display (staff & [PERBAIKI]) TIDAK ikut terpotong buka-ulang: Awal sudah dipatok ke Sisa
          // laporan sebelumnya (applyShift1SisaAsAwal), jadi pindahan sebelum buka-ulang tetap harus tampil di Tambah.
          const _pet = log.petugas_name || '';
          const isPindah = _pet.includes('(Pindah ke Display)') || _pet.includes('[PERBAIKI]');
          if (shift === '1') {
            return (t > Math.max(lastRepTime, lastOpenTime) && t <= s1Time) || (isPindah && t > lastRepTime && t <= s1Time);
          } else if (shift === '2') {
            const shiftStart = s1CloseLogs?.[0] ? new Date(s1CloseLogs[0].created_at).getTime() : Math.max(startOfDayObj.getTime(), lastRepTime);
            const afterTime = Math.max(lastOpenTime, shiftStart);
            return (t > afterTime && t <= s2Time) || (isPindah && t > shiftStart && t <= s2Time);
          }
          return true;
        });
        // Koreksi stok (admin/gudang, halaman Penyesuaian Stok) cuma buat Keterangan Excel —
        // sengaja TIDAK masuk shiftLogs (tag [GUDANG]-nya bakal kehitung jadi tambah safety).
        // Batasnya dari awal shift (tutup shift sebelumnya), bukan buka-ulang, biar koreksi
        // yang udah ke-bake ke Awal tetap kejelasan asalnya.
        const koreksiFrom = shift === '2' && s1CloseLogs?.[0]
          ? new Date(s1CloseLogs[0].created_at).getTime()
          : Math.max(startOfDayObj.getTime(), lastRepTime);
        koreksiLogs = allLogs.filter(l => (l.petugas_name || '').includes('(Koreksi)') && new Date(l.created_at).getTime() > koreksiFrom);
      }

      const shiftAdditionsByItem = {};
      // Qty "Pindah ke Display" (stok gudang -> display) per item selama shift ini.
      const pindahByItem = {};
      Object.assign(pindahByItem, pindahLogsByItem(shiftLogs || [], koreksiLogs));
      let autoOperNote = '';
      if (shiftLogs) {
        const groupedOper = {};
        shiftLogs.forEach(log => {
          shiftAdditionsByItem[log.item_name] = (shiftAdditionsByItem[log.item_name] || 0) + log.qty_added;

          if (log.qty_added !== 0 && log.petugas_name) {
            const pet = log.petugas_name;
            const petLower = pet.toLowerCase();
            const isKurasiKeyword = petLower.includes('kurasi') || petLower.includes('ditarik gudang') || petLower.includes('buang');

            if (isKurasiKeyword) {
              // Mengembalikan auto-note untuk kurasi agar perbedaan Awal dan Sisa 
              // dapat dijelaskan sebagai "di kurasi" pada kolom Note di file Excel.
              const key = `${log.item_name}|di kurasi`;
              groupedOper[key] = (groupedOper[key] || 0) + Math.abs(log.qty_added);
            } else if (log.qty_added < 0) {
              if (pet.includes('(Oper ke ') || pet.includes('Dioper ke ')) {
                let dest = 'Unknown';
                if (pet.includes('(Oper ke ')) dest = pet.split('(Oper ke ')[1]?.replace(')', '') || 'Unknown';
                else if (pet.includes('Dioper ke ')) dest = pet.split('Dioper ke ')[1]?.split(' (')[0] || 'Unknown';
                let destStr = dest.trim();
                if (destStr.toLowerCase() !== 'gudang' && !destStr.toLowerCase().startsWith('cabang')) destStr = `cabang ${destStr}`;
                const key = `${log.item_name}|di oper ke ${destStr}`;
                groupedOper[key] = (groupedOper[key] || 0) + Math.abs(log.qty_added);
              }
            } else if (!isKurasiKeyword && log.qty_added > 0) {
              if (pet.includes('Operan dari ')) {
                let src = pet.split('Operan dari ')[1]?.split(' (')[0] || 'Unknown';
                let srcStr = src.trim();
                if (srcStr.toLowerCase() !== 'gudang' && !srcStr.toLowerCase().startsWith('cabang')) srcStr = `cabang ${srcStr}`;
                const key = `${log.item_name}|di oper dari ${srcStr}`;
                groupedOper[key] = (groupedOper[key] || 0) + Math.abs(log.qty_added);
              }
            }
          }
        });

        const operItems = Object.entries(groupedOper)
          .filter(([, qty]) => Math.abs(qty) > 0.001) // koreksi bisa netto jadi 0 — jangan ditulis di note
          .map(([key, qty]) => {
            const [itemName, action] = key.split('|');
            return `${Math.abs(qty)} ${itemName} ${action}`;
          });

        if (operItems.length > 0) {
          autoOperNote = ` | [Sistem] ${operItems.join(', ')}`;
        }
      }

      // realTambahMap: langsung dari tambah_qty di DB (kolom eksplisit, bukan derived).
      // Pakai realtimeTambahMap (fetch barusan), bukan state `tambahMap` lokal —
      // state lokal bisa basi kalau restock terjadi dari tab/device lain selama shift jalan.
      const realTambahMap = {};
      const realTambahSafetyMap = {};

      for (const prod of products) {
        const key = getDetailKey(prod);
        const stockKey = getStockKey(prod);
        realTambahMap[key] = realtimeTambahMap[stockKey] ?? realtimeTambahMap[prod.name] ?? 0;
        realTambahSafetyMap[key] = 0; // akan diisi oleh scan log admin restock di bawah
      }

      // Scan log hanya untuk admin restock (tambah ke safety/gudang)
      if (shiftLogs) {
        shiftLogs.forEach(log => {
          const pet = log.petugas_name || '';
          const isGudangTag = pet.includes('[GUDANG]');
          const isLegacyAdmin = !pet.includes('[DISPLAY]') && !isGudangTag &&
            (pet.toLowerCase().includes('admin') || pet.toLowerCase().includes('mode restock') || pet.toLowerCase().includes('restock ops'));
          if ((isGudangTag || isLegacyAdmin) && log.qty_added > 0) {
            for (const prod of products) {
              const stockKey = getStockKey(prod);
              if (log.item_name === stockKey) {
                const key = getDetailKey(prod);
                realTambahSafetyMap[key] = (realTambahSafetyMap[key] || 0) + log.qty_added;
                break;
              }
            }
          }
        });
      }

      // 0.9 Guard anti potong-dobel.
      // Bug lama: kalau insert sales_reports (step 4) gagal, stok TERLANJUR dipotong di step 1
      // & display_qty ditimpa di step 2, tapi tidak ada baris laporan. Staff ulangi Tutup Shift
      // -> pengecekan duplikat di step 0 (cek sales_reports) lolos -> stok dipotong LAGI.
      // Solusi: cek net Auto-Deduct untuk shift+hari ini dari stock_restock_log. Kalau sudah
      // ada potongan yang belum di-reverse, lewati step 1 & 2 — cukup ulang simpan laporan.
      // Reversal Buka Ulang Shift N (dari handleReopenShift) ikut dihitung supaya alur
      // reopen -> resubmit tetap memotong stok seperti seharusnya (net kembali 0).
      // Window mulai dari "Buka Shift N" terakhir, BUKAN awal hari kalender: Shift 2 kemarin
      // yang ditutup lewat tengah malam (mis. 01:21) nulis Auto-Deduct Shift 2 di tanggal hari
      // ini → dulu ke-anggap "sudah dipotong" & Shift 2 hari ini dilewati potong stoknya
      // (PDK 28 Sep: 51 item ga kepotong).
      // Juga tak boleh mundur melewati "Tutup Shift" terakhir (shift mana pun): log "Buka Shift N"
      // bisa tak ada untuk shift ini (sesi dipindah/dipulihkan tanpa Buka), lalu window mundur ke
      // Buka Shift N kemarin & nangkep Auto-Deduct susulan admin → potong stok dilewati
      // (CS 10 Okt S2: Buka S2 terakhir 9 Okt 22:41, kena Auto-Deduct S2 susulan 10 Okt 09:59).
      // Potongan sah dari percobaan sebelumnya selalu SESUDAH marker Tutup-nya sendiri.
      const guardFromMs = Math.max(lastOpenTime, lastRepTime);
      const guardFrom = guardFromMs ? new Date(guardFromMs).toISOString() : startOfDay;
      const { data: prevDeductLogs } = await supabase
        .from('stock_restock_log')
        .select('qty_added')
        .eq('branch_name', branchName)
        .gte('created_at', guardFrom)
        .or(`petugas_name.ilike.%Auto-Deduct Shift ${shift}%,petugas_name.ilike.%Reversal Buka Ulang Shift ${shift}%`);
      const netPrevDeduct = (prevDeductLogs || []).reduce((s, l) => s + (Number(l.qty_added) || 0), 0);
      const alreadyDeducted = netPrevDeduct < -0.001;
      // ponytail: guard pakai NET sum, bukan atomic. Kalau Promise.all step 1 gagal separuh
      // (sebagian item kepotong, sebagian tidak) lalu di-retry, item yang belum kepotong tidak
      // akan pernah kepotong. Perbaikan tuntas = pindah step 1+2+4 ke satu RPC Postgres transaksional.
      if (alreadyDeducted) {
        console.warn(`[processSubmit] Shift ${shift} ${branchName}: stok sudah dipotong di percobaan sebelumnya (net ${netPrevDeduct}). Lewati potong stok + update display, langsung simpan laporan.`);
      }

      // ====================================================================
      // URUTAN BARU: SIMPAN LAPORAN DULU, potong stok BELAKANGAN.
      // Bug lama: stok dipotong (langkah 1) sebelum laporan tersimpan (langkah 4).
      // Kalau sinyal putus di langkah 4 -> stok kepotong TAPI tidak ada laporan
      // (mis. "Shift 2 tertutup" padahal cuma isi Shift 1). Sekarang: kalau insert
      // laporan gagal -> throw ke catch -> TIDAK ada stok yang tersentuh.
      // ====================================================================

      // 3. Snapshot inventori SEBELUM potong (buat kolom `sisa` + Buka Ulang Shift).
      const { totalMap: freshInventoryMap, safetyMap: freshSafetyMap } = await fetchInventory(branchName);

      let autoKurasiNote = '';
      const kurasiItems = [];

      const payload = {
        branch_name: branchName,
        date: todayDate,
        shift,
        staff_name: staffName,
        cash_awal: parseInt(cashAwal) || 0,
        total_revenue: totals.revenue,
        total_expense: totals.expense,
        cash_akhir: cashAkhir,
        details: products.map(p => {
          const key = p.variant && p.variant !== 'Standar' ? `${p.name} ${p.variant}` : p.name;

          let porsi_sisa = 0;
          let porsi_rusak = parseInt(p.porsi_rusak) || 0;
          if (p.name && p.name.toLowerCase().includes('bubble')) {
            const bungkusKeluar = getProductSoldQty(p);
            const porsiAwal = parseInt(p.porsi_sisa_awal) || 0;
            const porsiTambah = shiftAdditionsByItem[`Porsi ${p.name}`] || 0;
            const multiplier = p.name.toLowerCase().includes('kecil') ? 10 : 20;
            const transferAwal = parseInt(p.porsi_transfer_awal) || 0;
            const sessionTransfer = sessionPorsiTransfers[`Porsi ${p.name}`] || 0;
            const totalPorsi = (bungkusKeluar * multiplier) + porsiAwal + transferAwal + sessionTransfer;

            porsi_sisa = Math.max(0, totalPorsi - (parseInt(p.porsi_terpakai) || 0) - porsi_rusak);

            if (shift === '2') {
              if (porsi_sisa > 0) {
                porsi_rusak += porsi_sisa;
                porsi_sisa = 0;
              }
            }
          }

          if (porsi_rusak > 0) {
            kurasiItems.push(`${p.name} (${porsi_rusak} porsi)`);
          }

          // ── Rekonsiliasi arus masuk display biar baris SELALU balance ──
          // masuk_net = arus masuk BERSIH ke display shift ini (pindah dari gudang + kiriman
          // − kurasi). Diturunkan dari Sisa (LIVE, akurat) − Awal + Jual. Kolom pindah_display
          // dari scan log bisa 0 walau ada pergerakan (window ke-truncate buka-ulang shift) —
          // di-cap ke masuk_net biar Excel & layar Checking nunjukin pergerakannya, bukan
          // selisih tak terjelaskan. Kalau Awal sudah termasuk pindah, masuk_net ~0 → cap 0.
          const _sInput = getEffectiveDisplaySisa(p, realTambahMap, key, preCloseDisplayMap);
          const _awal = displayAtShiftStart[getStockKey(p)];
          const _jual = getProductSoldQty(p);
          const _tambah = realTambahMap[key] ?? 0;
          const _rawPindah = pindahByItem[getStockKey(p)] ?? pindahByItem[key] ?? 0;
          // Produk is_unlimited (Es Teh/Teh Tarik/Full Cream/Milk Tea) tak punya stok display
          // asli — Awal & Sisa-nya sama-sama default 0, jadi masuk_net = 0-0+Jual = Jual SELALU,
          // lalu ke-cap jadi "pindah_display" walau tak ada pemindahan apa pun (bug: Excel/Kartu
          // Stok nulis "N pindah stok ke display" tiap shift, padahal itu cuma qty terjual).
          const _masukNet = (!p.is_unlimited && _awal !== undefined && _awal !== null && Number.isFinite(_sInput))
            ? Math.round((_sInput - _awal + _jual) * 1000) / 1000
            : null;
          // cap = pindah maksimum yang masih bikin baris balance (Awal + Tambah + pindah − Jual = Sisa)
          const _cap = _masukNet !== null ? Math.max(0, _masukNet - _tambah) : null;
          const _pindahFinal = _cap === null ? _rawPindah : (_rawPindah > 0 ? Math.min(_rawPindah, _cap) : _cap);

          return {
            name: p.name,
            qty: getPureSoldQty(p), // Terjual Pure
            total_fisik: getProductSoldQty(p), // Total fisik bubuk yang terjual
            price: p.price,
            variant: p.variant || 'Standar',
            category: p.category || 'Lainnya',
            sisa: freshInventoryMap[key] ?? 0,
            sisa_input: _sInput, // Sisa display LIVE − terjual (opname manual menang)
            tambah: _tambah, // Pindah ke Display saja
            pindah_display: _pindahFinal, // qty pindah stok gudang->display shift ini (kolom Tambah hijau)
            masuk_net: _masukNet, // arus masuk bersih ke display = Sisa − Awal + Jual (selalu balance)
            display_awal: _awal ?? undefined, // Stok display awal shift dari DB
            tambah_safety: parseQty(p.tambah_safety) || 0, // Input Tambah ke Safety
            safety_remaining: calcSafetyRemaining(p, freshSafetyMap, key),
            ...(p.name === 'Diamond Besar' ? { ultra_qty: ultraInDiamondRef.current } : {}),
            // Tambahan khusus Dual Base
            is_dual_base: p.is_dual_base || false,
            susu_qty: parseInt(p.susu_qty) || 0,
            susu_add_price: parseInt(p.susu_add_price) || 0,
            porsi_terpakai: parseInt(p.porsi_terpakai) || 0,
            porsi_rusak: porsi_rusak,
            porsi_sisa: porsi_sisa
          };
        }),
        expenses: expenses.filter(e => e.name && e.amount)
          .map(e => ({ name: e.name, amount: parseInt(e.amount) })),
        stocks: [] // Obsolete, kept empty for backward compatibility
      };

      // Buang catatan [Sistem] lama dulu (dari close sebelumnya / buka ulang) biar ga dobel.
      let finalCatatan = (catatan || '').split(' | [Sistem]')[0].trim();
      if (autoOperNote) {
        finalCatatan += autoOperNote;
      }
      if (kurasiItems.length > 0) {
        finalCatatan += ` | [Sistem] Kurasi/Buang: ${kurasiItems.join(', ')}`;
      }

      // Tambahkan metadata setoran ke dalam array details agar tidak error schema DB
      payload.details.push({
        _is_meta: true,
        closed_at: new Date().toISOString(), // batas window Oper Porsi Bubble shift berikutnya (getPorsiWindowStart)
        setoran_aktual: cleanedSetoran,
        selisih: cleanedSetoran - (totals.revenue - totals.expense),
        note: finalCatatan.trim()
      });

      // Simpan snapshot inventory agar laporan historis tetap akurat
      payload.details.push({
        _is_inventory_snapshot: true,
        inventory_map: freshInventoryMap
      });

      // Snapshot restore-point: keadaan persis sebelum Tutup Shift (untuk Buka Ulang Shift).
      // Tag _is_meta + _is_inventory_snapshot juga supaya semua filter details yg ada ikut skip.
      payload.details.push({
        _is_preclose_snapshot: true,
        _is_meta: true,
        _is_inventory_snapshot: true,
        rows: preCloseInvRows || [],
        display_at_shift_start: displayAtShiftStart,
      });

      // 4. SIMPAN LAPORAN — kalau ini gagal (sinyal putus dll), throw ke catch:
      //    tidak ada stok yang dipotong / display yang ditimpa.
      const { error: saveError } = await supabase
        .from('sales_reports')
        .insert([payload]);

      if (saveError) throw new Error(`Supabase: ${saveError.message}`);
      let stockFailCount = 0;

      // Penanda shift ditutup — tulis LANGSUNG setelah laporan aman, jangan di akhir.
      // Kalau sinyal putus / tab ketutup di tengah potong stok / download Excel, marker ini
      // tetap ada; tanpa marker, window Oper Porsi Bubble shift berikutnya mundur ke Tutup
      // Shift sebelumnya → operan kehitung dua kali (kasus PDK 28 Sep: 9 porsi jadi 4).
      await supabase.from('stock_restock_log').insert([{
        branch_name: branchName,
        item_name: 'Status Aktivitas',
        qty_added: 0,
        qty_before: 0,
        qty_after: 0,
        petugas_name: `${staffName} (Tutup Shift ${shift})`
      }]);

      // 5. Laporan AMAN tersimpan — baru potong stok.
      // (dulu langkah ini di ATAS langkah 4 -> stok kepotong walau laporan gagal)
      if (!alreadyDeducted) {
        // SATU snapshot konsisten sebagai basis semua tulisan di bawah: preCloseInvRows
        // (diambil beberapa baris di atas, tepat sebelum blok ini). BUKAN realtimeInventoryMap
        // yang di-fetch jauh lebih awal — nilai basi bikin Pindah ke Display / kiriman / kurasi
        // yang terjadi setelah shift dibuka ketimpa balik ke angka lama alias KEBUANG DIAM-DIAM.
        // preCloseByItem sudah dibangun dari snapshot yang sama di atas.
        const stockJobs = [];

        // Beberapa produk bisa memetakan ke stockKey yang SAMA (mis. menu "Milk Tea Premi"
        // + bahan "Gula Milk Tea Premi" → dua-duanya "Gula Milk Tea Premi"). Kalau tiap
        // produk menulis upsert-nya sendiri via Promise.all, urutannya balapan & yang
        // salah bisa menang → display bahan driver tak kepotong (bug lama). Pilih SATU
        // produk otoritatif per stockKey: yang opname-nya diisi (getDetailKey === stockKey
        // & qty terisi) menang; lalu baris item itu sendiri (bahan "Gula Milk Tea Ori", bukan menu
        // Milk Tea yang unlimited); lalu yang sold terbesar. Tanpa langkah kedua, Sisa kosong +
        // jualan dari Kasir bikin sold seri -> menu unlimited yang menang -> bahan tak kepotong.
        const byKey = new Map();
        const rank = (r) => [r.ownOpname ? 1 : 0, r.own ? 1 : 0, r.sold];
        const better = (a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
        for (const prod of products) {
          const k = getStockKey(prod);
          const own = getDetailKey(prod) === k && !prod.is_unlimited;
          const ownOpname = own && prod.qty !== '' && prod.qty !== null && prod.qty !== undefined;
          const cand = { prod, own, ownOpname, sold: getProductSoldQty(prod) };
          const cur = byKey.get(k);
          if (!cur || better(cand, cur)) byKey.set(k, cand);
        }

        for (const { prod, sold } of byKey.values()) {
          const stockKey = getStockKey(prod);
          const pre = preCloseByItem[stockKey];

          // display_qty LIVE = sudah termasuk SEMUA aksi Laci Stok shift ini (Pindah ke
          // Display, kiriman ACC, kurasi). Kolom safety_qty independen, ikut apa adanya.
          const hasLiveDisplay = pre && pre.display_qty !== null && pre.display_qty !== undefined;
          const liveDisplay = hasLiveDisplay
            ? pre.display_qty
            : (realtimeInventoryMap[stockKey] ?? realtimeInventoryMap[prod.name] ?? 0);
          const safety = pre ? (pre.safety_qty ?? 0) : 0;
          const beforeCurrent = pre ? (pre.current_qty ?? (liveDisplay + safety)) : (liveDisplay + safety);

          // Sisa display akhir shift: opname manual kasir menang. Kalau blank, turunkan dari
          // display LIVE dikurangi terjual — TIDAK dari displayAtShiftStart+tambah (snapshot
          // Awal bisa basi kalau ada aksi stok sesudah shift dibuka, selisihnya kebuang).
          const manual = (prod.qty !== '' && prod.qty !== null && prod.qty !== undefined && !prod.is_unlimited)
            ? (parseQty(prod.qty) || 0) : null;
          let newDisplay;
          if (manual !== null) newDisplay = manual;
          else if (hasLiveDisplay && !prod.is_unlimited) newDisplay = Math.max(0, liveDisplay - sold);
          else newDisplay = getEffectiveDisplaySisa(prod, realTambahMap, getDetailKey(prod));

          const newCurrent = newDisplay + safety;
          const displayChanged = !pre || Math.abs((pre.display_qty ?? -999) - newDisplay) > 0.001;
          const currentChanged = Math.abs(beforeCurrent - newCurrent) > 0.001;

          if (sold > 0 || displayChanged || currentChanged) {
            stockJobs.push(supabase.from('branch_inventory').upsert(
              { branch_name: branchName, item_name: stockKey, display_qty: newDisplay, safety_qty: safety, current_qty: newCurrent, tambah_qty: 0 },
              { onConflict: 'branch_name,item_name' }
            ));
          }
          if (sold > 0) {
            stockJobs.push(supabase.from('stock_restock_log').insert([{
              branch_name: branchName, item_name: stockKey,
              qty_added: -sold, qty_before: beforeCurrent, qty_after: newCurrent,
              petugas_name: `${staffName} (Auto-Deduct Shift ${shift})`,
            }]));
          }
          // Terjual > stok display: JANGAN telan diam-diam — catat selisihnya ke Riwayat.
          // qty_added 0: baris ini cuma catatan, potongannya sudah di log Auto-Deduct di atas.
          // Dulu -(sold − display) → Riwayat kelihatan "kepotong 2x" & Hapus Laporan admin
          // ngembaliin stok dobel (PDK Es Teh Ori tiap shift).
          // Es Teh / Teh Tarik: terjualnya dihitung otomatis (cup / bahan sendiri), stoknya
          // memang tak pernah diisi (selalu 0) — bukan selisih, jangan dicatat.
          const autoNoStock = /^(es teh|teh tarik)/i.test(stockKey);
          if (manual === null && hasLiveDisplay && !prod.is_unlimited && !autoNoStock && sold > liveDisplay + 0.001) {
            stockJobs.push(supabase.from('stock_restock_log').insert([{
              branch_name: branchName, item_name: stockKey,
              qty_added: 0, qty_before: liveDisplay, qty_after: 0,
              petugas_name: `${staffName} (Auto-Deduct Shift ${shift} — SELISIH: terjual ${formatFraction(sold)} > stok display ${formatFraction(liveDisplay)}, cek opname)`,
            }]));
          }
        }
        // Supabase ga throw kalau gagal — cek .error satu-satu biar ga ada potong stok yang
        // hilang diam-diam. Laporan sudah tersimpan, jadi cukup peringatkan (jangan throw).
        const stockResults = await Promise.all(stockJobs);
        stockFailCount = stockResults.filter(r => r?.error).length;

        // sinkron current_qty = display_qty + safety_qty semua item cabang ini
        const { data: syncRows } = await supabase.from('branch_inventory').select('item_name, display_qty, safety_qty, current_qty').eq('branch_name', branchName);
        await Promise.all((syncRows || [])
          .filter(r => Math.abs(((r.display_qty || 0) + (r.safety_qty || 0)) - (r.current_qty || 0)) > 0.001)
          .map(r => supabase.from('branch_inventory').update({ current_qty: (r.display_qty || 0) + (r.safety_qty || 0) }).eq('branch_name', branchName).eq('item_name', r.item_name)));
      }

      // 6. Export Excel
      if (shift === '2') {
        // Shift 2 / Full: fetch Shift 1 data and generate combined Kartu Stok
        const shift1Report = shift === '2' ? await fetchShift1Report(branchName) : null;

        // Fetch distributions for today
        const todayStr = selectedDate;
        const { data: distributions } = await supabase
          .from('stock_distributions')
          .select('*')
          .eq('to_branch', branchName)
          .gte('created_at', `${todayStr}T00:00:00`)
          .lte('created_at', `${todayStr}T23:59:59`);

        let shift1Distributions = [];
        let shift2Distributions = [];

        if (distributions) {
          if (shift1Report && shift1Report.created_at) {
            const s1Time = new Date(shift1Report.created_at).getTime();
            shift1Distributions = distributions.filter(d => new Date(d.created_at).getTime() <= s1Time);
            shift2Distributions = distributions.filter(d => new Date(d.created_at).getTime() > s1Time);
          } else {
            // If shift 3, all distributions go to shift 1 (or 2). Let's just put all to shift 1 for simplicity
            shift1Distributions = distributions;
          }
        }

        const mappedProducts = products.map(p => {
          const key = getStockKey(p);
          let porsi_sisa = 0;
          let porsi_rusak = parseInt(p.porsi_rusak) || 0;
          if (p.name && p.name.toLowerCase().includes('bubble')) {
            const bungkusKeluar = getProductSoldQty(p);
            const porsiAwal = parseInt(p.porsi_sisa_awal) || 0;
            const transferAwal = parseInt(p.porsi_transfer_awal) || 0;
            const sessionTransfer = sessionPorsiTransfers[`Porsi ${p.name}`] || 0;
            const multiplier = p.name.toLowerCase().includes('kecil') ? 10 : 20;
            const totalPorsi = (bungkusKeluar * multiplier) + porsiAwal + transferAwal + sessionTransfer;

            porsi_sisa = Math.max(0, totalPorsi - (parseInt(p.porsi_terpakai) || 0) - porsi_rusak);

            // Jika Shift 2 (akhir hari), sisa porsi dibuang (jadi porsi rusak)
            if (porsi_sisa > 0) {
              porsi_rusak += porsi_sisa;
              porsi_sisa = 0;
            }
          }
          return {
            id: p.id,
            name: p.name,
            category: p.category,
            price: p.price,
            variant: p.variant,
            is_dual_base: p.is_dual_base,
            susu_qty: parseInt(p.susu_qty) || 0,
            susu_add_price: parseInt(p.susu_add_price) || 0,
            qty: p.category === 'Bahan' ? parseQty(p.qty) : getPureSoldQty(p),
            terjual_fisik: getProductSoldQty(p),
            sisa_input: getEffectiveDisplaySisa(p, realTambahMap, key, preCloseDisplayMap),
            safety_qty: parseQty(p.safety_qty) || 0,
            tambah: (realTambahMap[key] ?? 0),
            display_awal: displayAtShiftStart[getStockKey(p)] ?? undefined,
            tambah_safety: realTambahSafetyMap[key] ?? 0,
            safety_remaining: calcSafetyRemaining(p, freshSafetyMap, key),
            ...(p.name === 'Diamond Besar' ? { ultra_qty: ultraInDiamondRef.current } : {}),
            porsi_terpakai: parseInt(p.porsi_terpakai) || 0,
            porsi_rusak: porsi_rusak,
            porsi_sisa: porsi_sisa
          };
        });
        exportShiftToExcel(
          { shift, staffName, cashAwal, products: mappedProducts, expenses, stocks: mappedProducts.filter(p => p.category === 'Bahan' || p.category === 'Operasional'), inventoryMap: freshInventoryMap, shift1Report, shift1Distributions, shift2Distributions, date: todayDate, setoranAktual: cleanedSetoran, selisih: cleanedSetoran - (totals.revenue - totals.expense), note: finalCatatan.trim(), shiftLogs: shiftLogs, koreksiLogs },
          branchName
        );
      } else {
        const cleanedSetoran1 = cleanedSetoran;
        const mappedProducts1 = products.map(p => {
          const key = getStockKey(p);
          let porsi_sisa = 0;
          if (p.name && p.name.toLowerCase().includes('bubble')) {
            const bungkusKeluar = getProductSoldQty(p);
            const porsiAwal = parseInt(p.porsi_sisa_awal) || 0;
            const transferAwal = parseInt(p.porsi_transfer_awal) || 0;
            const sessionTransfer = sessionPorsiTransfers[`Porsi ${p.name}`] || 0;
            const multiplier = p.name.toLowerCase().includes('kecil') ? 10 : 20;
            const totalPorsi = (bungkusKeluar * multiplier) + porsiAwal + transferAwal + sessionTransfer;
            porsi_sisa = Math.max(0, totalPorsi - (parseInt(p.porsi_terpakai) || 0) - (parseInt(p.porsi_rusak) || 0));
          }
          return {
            id: p.id,
            name: p.name,
            category: p.category,
            price: p.price,
            variant: p.variant,
            is_dual_base: p.is_dual_base,
            susu_qty: parseInt(p.susu_qty) || 0,
            susu_add_price: parseInt(p.susu_add_price) || 0,
            qty: p.category === 'Bahan' ? parseQty(p.qty) : getPureSoldQty(p),
            terjual_fisik: getProductSoldQty(p),
            sisa_input: getEffectiveDisplaySisa(p, realTambahMap, key, preCloseDisplayMap),
            tambah: (realTambahMap[key] ?? 0),
            display_awal: displayAtShiftStart[getStockKey(p)] ?? undefined,
            tambah_safety: realTambahSafetyMap[key] ?? 0,
            safety_remaining: calcSafetyRemaining(p, freshSafetyMap, key),
            ...(p.name === 'Diamond Besar' ? { ultra_qty: ultraInDiamondRef.current } : {}),
            porsi_terpakai: parseInt(p.porsi_terpakai) || 0,
            porsi_rusak: parseInt(p.porsi_rusak) || 0,
            porsi_sisa: porsi_sisa
          };
        });
        exportShiftToExcel(
          { shift, staffName, cashAwal, products: mappedProducts1, expenses, stocks: mappedProducts1.filter(p => p.category === 'Bahan' || p.category === 'Operasional'), inventoryMap: freshInventoryMap, date: todayDate, setoranAktual: cleanedSetoran1, selisih: cleanedSetoran1 - (totals.revenue - totals.expense), note: finalCatatan.trim(), shiftLogs: shiftLogs, koreksiLogs },
          branchName
        );
      }

      // Hapus Draft setelah berhasil simpan
      localStorage.removeItem(`pos_draft_${branchName}_shift${shift}`);
      localStorage.removeItem('pos_active_session');
      // Staff habis nutup Shift 2 kemarin (lewat tengah malam) → balik ke hari ini.
      if (!canPickDate(userData)) setSelectedDateState(new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0]);

      // 5. Reset form. Matikan status shift DULUAN (satu batch dengan reset isian): kalau masih
      // true, Auto-Save Draft nulis ulang draft kosong -> "isian belum selesai (Shift N)" muncul
      // lagi di layar Mulai Sesi padahal shift sudah ditutup.
      setIsShiftStarted(false);
      setPorsiTransfers({});
      setProducts(products.map(p => ({ ...p, qty: '', tambah: '', safety_qty: '', tambah_safety: '', porsi_terpakai: '', porsi_rusak: '' })));
      setExpenses([{ id: 1, name: 'Isi Ulang Galon', amount: '' }, { id: 2, name: 'Es Batu', amount: '' }]);
      await fetchInventory(branchName);
      await checkExistingShifts(branchName);

      const nextMsg = shift === '1'
        ? "Shift 1 telah selesai, beralih pada shift 2"
        : `Laporan Shift ${shift} berhasil disimpan!`;
      setCompletionMsg(nextMsg);
      localStorage.removeItem(`pos_draft_${branchName}_shift${shift}`); // jaga-jaga render yang sempat lolos

      // Alert sukses PALING AKHIR — dulu muncul sebelum marker Tutup Shift & beres-beres
      // ditulis; staff lihat "berhasil", tutup aplikasi, sisa tulisan ga kekirim.
      const doneMsg = shift === '2'
        ? `Shift ${shift} berhasil disimpan! Laporan + Kartu Stok gabungan sudah diunduh.`
        : 'Shift 1 berhasil disimpan! Laporan penjualan dan Kartu Stok sudah diunduh.';
      const failMsg = stockFailCount > 0
        ? `\n\n⚠️ ${stockFailCount} potongan stok GAGAL tersimpan (sinyal?). Laporan aman, tapi stok perlu dicek — lapor admin.`
        : alreadyDeducted
          ? '\n\n⚠️ Stok TIDAK dipotong ulang (terdeteksi sudah dipotong di percobaan sebelumnya). Kalau ini tutup shift pertama, lapor admin.'
          : '';
      setTimeout(() => alert(doneMsg + failMsg), 100);
    } catch (error) {
      console.error('Submit error:', error);
      const cleanedSetoranErr = parseInt(String(setoranAktual).replace(/\D/g, '')) || 0;
      const mappedProductsErr = products.map(p => ({
        ...p,
        qty: p.category === 'Bahan' ? parseQty(p.qty) : getPureSoldQty(p),
        porsi_terpakai: parseInt(p.porsi_terpakai) || 0,
        porsi_rusak: parseInt(p.porsi_rusak) || 0
      }));
      exportShiftToExcel({ shift, staffName, cashAwal, products: mappedProductsErr, expenses, stocks: mappedProductsErr.filter(p => p.category === 'Bahan' || p.category === 'Operasional'), inventoryMap: inventoryMap, skipKartuStok: false, date: todayDate, setoranAktual: cleanedSetoranErr, selisih: cleanedSetoranErr - (totals.revenue - totals.expense), note: catatan }, branchName);
      alert(`❌ GAGAL simpan laporan ke server.\n\n${error.message}\n\nShift ini BELUM ditutup — stok TIDAK dipotong. Excel sudah diunduh sebagai backup.\nCoba Tutup Shift lagi saat koneksi stabil. (Data yang kamu isi masih tersimpan di form.)`);
    } finally {
      setIsSaving(false);
      setIsDepositModalOpen(false);
    }
  };

  const handleTestExport = async () => {
    try {
      const branchName = selectedBranch || 'Cabang Pusat';
      const staffName = userData?.name || 'Staff';
      const todayDate = selectedDate;

      const { totalMap: realtimeInventoryMap, tambahMap: realtimeTambahMap, safetyMap: realtimeSafetyMap, displayMap: realtimeDisplayMap } = await fetchInventory(branchName);
      const [y, m, d] = todayDate.split('-');
      const startOfDayObj = new Date(parseInt(y), parseInt(m) - 1, parseInt(d), 0, 0, 0);
      const endOfDayObj = new Date(parseInt(y), parseInt(m) - 1, parseInt(d), 23, 59, 59, 999);
      const startOfDay = startOfDayObj.toISOString();

      // Batas dilebarkan: kalau tanggal admin masih ketinggalan (selectedDate stale),
      // aktivitas shift hari ini (Pindah ke Display dll) tetap ke-fetch. Window shift yang
      // sebenarnya di-narrow lagi di filter shiftLogs di bawah.
      const logLo = new Date(Math.min(startOfDayObj.getTime(), Date.now() - 48 * 3600 * 1000)).toISOString();
      const logHi = new Date(Math.max(endOfDayObj.getTime(), Date.now() + 3600 * 1000)).toISOString();
      const { data: allLogs, error: logsErr } = await supabase
        .from('stock_restock_log')
        .select('item_name, qty_added, qty_after, created_at, petugas_name')
        .eq('branch_name', branchName)
        .gte('created_at', logLo)
        .lte('created_at', logHi)
        .not('petugas_name', 'ilike', '%Auto-Deduct%');

      const { data: closeLogs } = await supabase.from('stock_restock_log').select('created_at')
        .eq('branch_name', branchName).eq('item_name', 'Status Aktivitas')
        .ilike('petugas_name', '%Tutup Shift%').order('created_at', { ascending: false }).limit(1);
      const lastRepTime = (closeLogs && closeLogs.length > 0) ? new Date(closeLogs[0].created_at).getTime() : 0;

      // Batas bawah = "Buka Input Shift N" TERAKHIR — aktivitas sebelum buka-ulang shift
      // sudah baked-in ke snapshot Awal baru, jangan dihitung ulang.
      const { data: openLogs } = await supabase.from('stock_restock_log').select('created_at')
        .eq('branch_name', branchName).eq('item_name', 'Status Aktivitas')
        .ilike('petugas_name', `%Buka%Shift ${shift}%`).order('created_at', { ascending: false }).limit(1);
      const lastOpenTime = openLogs?.[0] ? new Date(openLogs[0].created_at).getTime() : 0;

      let shiftLogs = [];
      let koreksiLogs = [];
      if (allLogs && !logsErr) {
        // sales_reports gak punya kolom created_at — ambil batas waktu shift 1 dari log
        // "Tutup Shift 1" sendiri (stock_restock_log), sama pola kayak lastRepTime di atas.
        const { data: s1CloseLogs } = await supabase.from('stock_restock_log').select('created_at')
          .eq('branch_name', branchName).eq('item_name', 'Status Aktivitas')
          .ilike('petugas_name', '%Tutup Shift 1%').order('created_at', { ascending: false }).limit(1);

        // Dalam mode test generate, simulasikan seolah-olah shift di-submit SEKARANG
        const now = new Date();
        const s1Time = now.getTime();
        const s2Time = now.getTime();

        shiftLogs = allLogs.filter(log => {
          const t = new Date(log.created_at).getTime();
          // Pindah Stok->Display (staff & [PERBAIKI]) TIDAK ikut terpotong buka-ulang: Awal sudah dipatok ke Sisa
          // laporan sebelumnya (applyShift1SisaAsAwal), jadi pindahan sebelum buka-ulang tetap harus tampil di Tambah.
          const _pet = log.petugas_name || '';
          const isPindah = _pet.includes('(Pindah ke Display)') || _pet.includes('[PERBAIKI]');
          if (shift === '1') {
            return (t > Math.max(lastRepTime, lastOpenTime) && t <= s1Time) || (isPindah && t > lastRepTime && t <= s1Time);
          } else if (shift === '2') {
            const shiftStart = s1CloseLogs?.[0] ? new Date(s1CloseLogs[0].created_at).getTime() : Math.max(startOfDayObj.getTime(), lastRepTime);
            const afterTime = Math.max(lastOpenTime, shiftStart);
            return (t > afterTime && t <= s2Time) || (isPindah && t > shiftStart && t <= s2Time);
          }
          return true;
        });
        // Koreksi stok (admin/gudang, halaman Penyesuaian Stok) cuma buat Keterangan Excel —
        // sengaja TIDAK masuk shiftLogs (tag [GUDANG]-nya bakal kehitung jadi tambah safety).
        // Batasnya dari awal shift (tutup shift sebelumnya), bukan buka-ulang, biar koreksi
        // yang udah ke-bake ke Awal tetap kejelasan asalnya.
        const koreksiFrom = shift === '2' && s1CloseLogs?.[0]
          ? new Date(s1CloseLogs[0].created_at).getTime()
          : Math.max(startOfDayObj.getTime(), lastRepTime);
        koreksiLogs = allLogs.filter(l => (l.petugas_name || '').includes('(Koreksi)') && new Date(l.created_at).getTime() > koreksiFrom);
      }

      const shiftAdditionsByItem = {};
      // Qty "Pindah ke Display" (stok gudang -> display) per item selama shift ini.
      const pindahByItem = {};
      Object.assign(pindahByItem, pindahLogsByItem(shiftLogs || [], koreksiLogs));
      let autoOperNote = '';
      if (shiftLogs) {
        const groupedOper = {};
        shiftLogs.forEach(log => {
          shiftAdditionsByItem[log.item_name] = (shiftAdditionsByItem[log.item_name] || 0) + log.qty_added;

          if (log.qty_added !== 0 && log.petugas_name) {
            const pet = log.petugas_name;
            const petLower = pet.toLowerCase();
            const isKurasiKeyword = petLower.includes('kurasi') || petLower.includes('ditarik gudang') || petLower.includes('buang');

            if (isKurasiKeyword) {
              const key = `${log.item_name}|di kurasi`;
              groupedOper[key] = (groupedOper[key] || 0) + Math.abs(log.qty_added);
            } else if (log.qty_added < 0) {
              if (pet.includes('(Oper ke ') || pet.includes('Dioper ke ')) {
                let dest = 'Unknown';
                if (pet.includes('(Oper ke ')) dest = pet.split('(Oper ke ')[1]?.replace(')', '') || 'Unknown';
                else if (pet.includes('Dioper ke ')) dest = pet.split('Dioper ke ')[1]?.split(' (')[0] || 'Unknown';
                let destStr = dest.trim();
                if (destStr.toLowerCase() !== 'gudang' && !destStr.toLowerCase().startsWith('cabang')) destStr = `cabang ${destStr}`;
                const key = `${log.item_name}|di oper ke ${destStr}`;
                groupedOper[key] = (groupedOper[key] || 0) + Math.abs(log.qty_added);
              }
            } else if (!isKurasiKeyword && log.qty_added > 0) {
              if (pet.includes('Operan dari ')) {
                let src = pet.split('Operan dari ')[1]?.split(' (')[0] || 'Unknown';
                let srcStr = src.trim();
                if (srcStr.toLowerCase() !== 'gudang' && !srcStr.toLowerCase().startsWith('cabang')) srcStr = `cabang ${srcStr}`;
                const key = `${log.item_name}|di oper dari ${srcStr}`;
                groupedOper[key] = (groupedOper[key] || 0) + Math.abs(log.qty_added);
              }
            }
          }
        });

        const operItems = Object.entries(groupedOper)
          .filter(([, qty]) => Math.abs(qty) > 0.001) // koreksi bisa netto jadi 0 — jangan ditulis di note
          .map(([key, qty]) => {
            const [itemName, action] = key.split('|');
            return `${Math.abs(qty)} ${itemName} ${action}`;
          });

        if (operItems.length > 0) {
          autoOperNote = ` | [Sistem] ${operItems.join(', ')}`;
        }
      }

      // realTambahMap: langsung dari kolom tambah_qty di DB (kolom eksplisit, bukan derived).
      // display_qty TIDAK di-update oleh aksi Tambah/Restock (lihat AdminInventory.jsx) — cuma
      // di-reset saat Set Manual — jadi displayNow-displayStart selalu salah/basi selama shift
      // masih jalan. Pakai realtimeTambahMap (fetch barusan), sama kayak processSubmit.
      const realTambahMap = {};
      const realTambahSafetyMap = {};

      for (const prod of products) {
        const key = getDetailKey(prod);
        const stockKey = getStockKey(prod);
        realTambahMap[key] = realtimeTambahMap[stockKey] ?? realtimeTambahMap[prod.name] ?? 0;
        realTambahSafetyMap[key] = 0;
      }

      // Scan log hanya untuk admin restock
      if (shiftLogs) {
        shiftLogs.forEach(log => {
          const pet = log.petugas_name || '';
          const isGudangTag = pet.includes('[GUDANG]');
          const isLegacyAdmin = !pet.includes('[DISPLAY]') && !isGudangTag &&
            (pet.toLowerCase().includes('admin') || pet.toLowerCase().includes('mode restock') || pet.toLowerCase().includes('restock ops'));
          if ((isGudangTag || isLegacyAdmin) && log.qty_added > 0) {
            for (const prod of products) {
              const stockKey = getStockKey(prod);
              if (log.item_name === stockKey) {
                const key = getDetailKey(prod);
                realTambahSafetyMap[key] = (realTambahSafetyMap[key] || 0) + log.qty_added;
                break;
              }
            }
          }
        });
      }

      const kurasiItems = [];
      const mappedProducts = products.map(p => {
        const key = getStockKey(p);
        let porsi_sisa = 0;
        let porsi_rusak = parseInt(p.porsi_rusak) || 0;
        if (p.name && p.name.toLowerCase().includes('bubble')) {
          const bungkusKeluar = getProductSoldQty(p);
          const porsiAwal = parseInt(p.porsi_sisa_awal) || 0;
          const transferAwal = parseInt(p.porsi_transfer_awal) || 0;
          const sessionTransfer = sessionPorsiTransfers[`Porsi ${p.name}`] || 0;
          const multiplier = p.name.toLowerCase().includes('kecil') ? 10 : 20;
          const totalPorsi = (bungkusKeluar * multiplier) + porsiAwal + transferAwal + sessionTransfer;
          porsi_sisa = Math.max(0, totalPorsi - (parseInt(p.porsi_terpakai) || 0) - porsi_rusak);

          if (shift === '2') {
            if (porsi_sisa > 0) {
              porsi_rusak += porsi_sisa;
              porsi_sisa = 0;
            }
          }
        }

        if (porsi_rusak > 0) {
          kurasiItems.push(`${p.name} (${porsi_rusak} porsi)`);
        }

        return {
          id: p.id,
          name: p.name,
          category: p.category,
          price: p.price,
          variant: p.variant,
          is_dual_base: p.is_dual_base,
          susu_qty: parseInt(p.susu_qty) || 0,
          susu_add_price: parseInt(p.susu_add_price) || 0,
          qty: p.category === 'Bahan' ? p.qty : getPureSoldQty(p),
          terjual_fisik: getProductSoldQty(p),
          // Pakai display_qty LIVE (sudah termasuk Pindah ke Display / kiriman) seperti processSubmit — tanpa ini Sisa = Awal + Tambah(kiriman) saja
          // dan pindahan Stok->Display tidak ikut menambah Sisa.
          sisa_input: getEffectiveDisplaySisa(p, realTambahMap, key, realtimeDisplayMap),
          tambah: (realTambahMap[key] ?? 0),
          display_awal: displayAtShiftStart[getStockKey(p)] ?? undefined,
          safety_remaining: calcSafetyRemaining(p, realtimeSafetyMap, key),
          ...(p.name === 'Diamond Besar' ? { ultra_qty: ultraInDiamondRef.current } : {}),
          porsi_terpakai: parseInt(p.porsi_terpakai) || 0,
          porsi_rusak: porsi_rusak,
          porsi_sisa: porsi_sisa
        };
      });

      let testFinalCatatan = (catatan || '').split(' | [Sistem]')[0].trim();
      if (autoOperNote) testFinalCatatan += autoOperNote;
      if (kurasiItems.length > 0) {
        testFinalCatatan += ` | [Sistem] Kurasi/Buang: ${kurasiItems.join(', ')}`;
      }
      testFinalCatatan = testFinalCatatan.trim();

      if (shift === '2') {
        const shift1Report = shift === '2' ? await fetchShift1Report(branchName) : null;
        const { data: distributions } = await supabase
          .from('stock_distributions')
          .select('*')
          .eq('to_branch', branchName)
          .gte('created_at', `${todayDate}T00:00:00`)
          .lte('created_at', `${todayDate}T23:59:59`);

        let shift1Distributions = [];
        let shift2Distributions = [];

        if (distributions) {
          if (shift1Report && shift1Report.created_at) {
            const s1Time = new Date(shift1Report.created_at).getTime();
            shift1Distributions = distributions.filter(d => new Date(d.created_at).getTime() <= s1Time);
            shift2Distributions = distributions.filter(d => new Date(d.created_at).getTime() > s1Time);
          } else {
            shift1Distributions = distributions;
          }
        }

        // Simulate what freshInventoryMap would be after submission
        const simulatedInventoryMap = { ...realtimeInventoryMap };
        products.forEach(prod => {
          const stockKey = getStockKey(prod);
          const currentQty = realtimeInventoryMap[stockKey] ?? realtimeInventoryMap[prod.name] ?? (STOCK_KEY_MAP[prod.name] ? realtimeInventoryMap[STOCK_KEY_MAP[prod.name]] : undefined) ?? 0;
          const soldQty = getProductSoldQty(prod);

          if (prod.qty !== '' || (isAutoCalculated(prod) && soldQty > 0)) {
            let newQty = 0;
            if (isAutoCalculated(prod)) {
              newQty = Math.max(0, currentQty - soldQty);
            } else {
              newQty = parseQty(prod.qty) || 0;
            }
            simulatedInventoryMap[stockKey] = newQty;
          } else {
            simulatedInventoryMap[stockKey] = currentQty;
          }
        });

        exportShiftToExcel(
          { shift, staffName, cashAwal, products: mappedProducts, expenses, stocks: mappedProducts.filter(p => p.category === 'Bahan' || p.category === 'Operasional'), inventoryMap: simulatedInventoryMap, shift1Report, shift1Distributions, shift2Distributions, date: todayDate, note: testFinalCatatan, shiftLogs: shiftLogs, koreksiLogs },
          branchName
        );
      } else {
        const cleanedSetoran = parseInt(String(setoranAktual).replace(/\D/g, '')) || 0;

        // Simulate what freshInventoryMap would be after submission
        const simulatedInventoryMap = { ...realtimeInventoryMap };
        products.forEach(prod => {
          const stockKey = getStockKey(prod);
          const currentQty = realtimeInventoryMap[stockKey] ?? realtimeInventoryMap[prod.name] ?? (STOCK_KEY_MAP[prod.name] ? realtimeInventoryMap[STOCK_KEY_MAP[prod.name]] : undefined) ?? 0;
          const soldQty = getProductSoldQty(prod);

          if (prod.qty !== '' || (isAutoCalculated(prod) && soldQty > 0)) {
            let newQty = 0;
            if (isAutoCalculated(prod)) {
              newQty = Math.max(0, currentQty - soldQty);
            } else {
              newQty = parseQty(prod.qty) || 0;
            }
            simulatedInventoryMap[stockKey] = newQty;
          } else {
            simulatedInventoryMap[stockKey] = currentQty;
          }
        });

        exportShiftToExcel(
          { shift, staffName, cashAwal, products: mappedProducts, expenses, stocks: mappedProducts.filter(p => p.category === 'Bahan' || p.category === 'Operasional'), inventoryMap: simulatedInventoryMap, skipKartuStok: false, date: todayDate, setoranAktual: cleanedSetoran, selisih: cleanedSetoran - (totals.revenue - totals.expense), note: testFinalCatatan, shiftLogs: shiftLogs, koreksiLogs },
          branchName
        );
      }
      alert('Test Generate Laporan berhasil! File Excel sedang diunduh.');
    } catch (error) {
      console.error('Test Export Error:', error);
      alert('Gagal Test Generate Laporan: ' + error.message);
    }
  };

  const livePorsiSisaMemo = useMemo(() => {
    if (!isShiftStarted) return null;
    const livePorsiSisa = {};
    products.forEach(p => {
      if (p.name && p.name.toLowerCase().includes('bubble')) {
        const bungkusKeluar = getProductSoldQty(p);
        const porsiAwal = parseInt(p.porsi_sisa_awal) || 0;
        const transferAwal = parseInt(p.porsi_transfer_awal) || 0;
        const sessionTransfer = sessionPorsiTransfers[`Porsi ${p.name}`] || 0;
        const multiplier = p.name.toLowerCase().includes('kecil') ? 10 : 20;
        const totalPorsi = (bungkusKeluar * multiplier) + porsiAwal + transferAwal + sessionTransfer;
        livePorsiSisa[p.name] = Math.max(0, totalPorsi - (parseInt(p.porsi_terpakai) || 0) - (parseInt(p.porsi_rusak) || 0));
      }
    });
    return livePorsiSisa;
  }, [products, isShiftStarted, sessionPorsiTransfers]);

  useEffect(() => {
    setLivePorsiSisa(livePorsiSisaMemo);
  }, [livePorsiSisaMemo, setLivePorsiSisa]);

  // fetchRealtimeTambah dihapus: display_qty sekarang disimpan langsung di DB (branch_inventory.display_qty)
  // Tidak perlu polling log setiap 5 detik — safety dihitung dari current_qty - display_qty.

  if (!isShiftStarted) {
    return (
      <div className="flex justify-center animate-fade-in" style={{ minHeight: '80vh', alignItems: 'center' }}>
        <div className="glass-panel" style={{ width: '100%', maxWidth: '400px', padding: '2.5rem', textAlign: 'center' }}>
          <div className="flex justify-center mb-4 text-primary">
            <Icon name="store" size={48} />
          </div>
          <h2 style={{ fontSize: '1.4rem', marginBottom: '0.5rem' }}>Mulai Sesi Kasir</h2>
          {completionMsg && (
            <div style={{ backgroundColor: 'rgba(52, 199, 89,0.1)', color: 'var(--primary)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', fontWeight: 600, fontSize: '0.9rem' }}>
              {completionMsg}
            </div>
          )}
          <p className="text-muted" style={{ fontSize: '0.9rem', marginBottom: '1.5rem' }}>Pastikan cabang dan shift sudah benar sebelum menginput POS.</p>

          <div style={{ textAlign: 'left', marginBottom: '1rem' }}>
            <label className="text-muted" style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem' }}>Pilih Cabang</label>
            <select value={selectedBranch} onChange={e => {
              setSelectedBranch(e.target.value);
              localStorage.setItem('lastSelectedBranch', e.target.value);
            }} className="input-field">
              {branches.length === 0 ? <option value="">Memuat Cabang...</option> : null}
              {branches.map(b => {
                let mark = '';
                try {
                  for (const sh of ['1', '2']) {
                    const d = localStorage.getItem(`pos_draft_${b.name}_shift${sh}`);
                    if (d && Date.now() - (JSON.parse(d).timestamp || 0) < 24 * 3600 * 1000) mark += ` • draft S${sh}`;
                  }
                } catch { /* ignore */ }
                return <option key={b.name} value={b.name}>{b.name}{mark}</option>;
              })}
            </select>
          </div>
          {(() => {
            try {
              const marks = ['1', '2'].filter(sh => {
                const d = localStorage.getItem(`pos_draft_${selectedBranch}_shift${sh}`);
                return d && Date.now() - (JSON.parse(d).timestamp || 0) < 24 * 3600 * 1000;
              });
              if (!marks.length) return null;
              return <p style={{ fontSize: '0.82rem', color: 'var(--primary)', marginTop: '-0.5rem', marginBottom: '1rem', fontWeight: 600 }}>📝 {selectedBranch} punya isian belum selesai (Shift {marks.join(' & ')}) — buka shift itu buat lanjut.</p>;
            } catch { return null; }
          })()}

          {canPickDate(userData) && (
            <div style={{ textAlign: 'left', marginBottom: '1rem' }}>
              <label className="text-muted" style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem' }}>
                Pilih Tanggal {(['admin', 'administrator', 'owner'].includes(userData?.role?.toLowerCase())) ? '(Khusus Admin)' : '(Mode Testing — diizinkan Admin)'}
              </label>
              <input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="input-field"
              />
            </div>
          )}

          {!canPickDate(userData) && s2KemarinPending && (() => {
            const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];
            const onS2 = selectedDate === s2KemarinPending;
            return (
              <div style={{ textAlign: 'left', marginBottom: '1rem', padding: '0.75rem', borderRadius: '8px', background: '#fff4e5', border: '1px solid #f5a623', fontSize: '0.85rem' }}>
                {onS2
                  ? <>Kamu mengisi <b>Shift 2 (Malam) tanggal {s2KemarinPending}</b> — Shift 2 kemarin belum ditutup.</>
                  : <>Shift 2 tanggal {s2KemarinPending} <b>belum ditutup</b>. Kamu staff malam kemarin?</>}
                <button type="button" className="btn" style={{ display: 'block', marginTop: '0.5rem', width: '100%' }}
                  onClick={() => setSelectedDateState(onS2 ? today : s2KemarinPending)}>
                  {onS2 ? `Bukan, saya Shift 1 hari ini (${today})` : `Ya, isi Shift 2 tanggal ${s2KemarinPending}`}
                </button>
              </div>
            );
          })()}

          <div style={{ textAlign: 'left', marginBottom: '2rem' }}>
            <label className="text-muted" style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem' }}>Pilih Shift</label>
            <select value={shift} onChange={e => setShift(e.target.value)} className="input-field">
              {/* Tampilkan Shift 1 jika belum ada Shift 1 hari ini, ATAU jika Admin */}
              {(!existingShifts.includes('1') || (['admin', 'administrator', 'owner'].includes(userData?.role?.toLowerCase()))) && (
                <option value="1">Shift 1 (Pagi)</option>
              )}

              {/* Tampilkan Shift 2 jika belum ada Shift 2 hari ini, ATAU jika Admin */}
              {(!existingShifts.includes('2') || (['admin', 'administrator', 'owner'].includes(userData?.role?.toLowerCase()))) && (
                <option value="2">Shift 2 (Malam)</option>
              )}

              {/* Status Message if all shifts taken */}
              {(existingShifts.includes('1') && existingShifts.includes('2') && (!['admin', 'administrator', 'owner'].includes(userData?.role?.toLowerCase()))) && (
                <option value="" disabled>Semua Shift Sudah Terisi</option>
              )}
            </select>
            {(shift === '1' || shift === '2') && (
              <p className="text-muted" style={{ marginTop: '0.3rem', fontSize: '0.8rem' }}>
                Jam kerja: {shift === '1' ? '08:00 - 16:00' : '15:00 - 23:00'}
              </p>
            )}
          </div>

          <div style={{ textAlign: 'left', marginBottom: '1.5rem' }}>
            <label className="text-muted" style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem' }}>Modal Kasir (Cash Awal)</label>
            <div style={{ display: 'flex', alignItems: 'center', backgroundColor: '#f2f2f7', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0 0.75rem' }}>
              <span style={{ fontWeight: 700, color: 'var(--text-muted)', marginRight: '0.5rem' }}>Rp</span>
              <input
                type="number"
                className="input-field"
                style={{ border: 'none', background: 'transparent', padding: '0.6rem 0' }}
                value={cashAwal}
                onChange={e => setCashAwal(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          {blockedMsg ? (
            <div style={{
              padding: '0.8rem', backgroundColor: 'rgba(255, 56, 60,0.1)',
              color: 'var(--danger)', borderRadius: '10px', fontSize: '0.9rem',
              marginBottom: '1rem', fontWeight: 600
            }}>
              {blockedMsg}
            </div>
          ) : (existingShifts.length >= 2 || existingShifts.includes('3')) && (!['admin', 'administrator', 'owner'].includes(userData?.role?.toLowerCase())) ? (
            <div style={{
              padding: '0.8rem', backgroundColor: 'rgba(255, 56, 60,0.1)',
              color: 'var(--danger)', borderRadius: '10px', fontSize: '0.9rem',
              marginBottom: '1rem', fontWeight: 600
            }}>
              Laporan untuk hari ini sudah terpenuhi (2 Shift).
            </div>
          ) : (
            <button
              type="button"
              className="btn-primary"
              style={{ width: '100%', padding: '0.8rem', fontSize: '1rem' }}
              disabled={!selectedBranch || !shift || isSaving}
              onClick={handleOpenShift}
            >
              {isSaving ? 'Membuka...' : `Buka Kasir - Shift ${shift}`}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '10rem' }}>

      <BranchStockDrawer
        isOpen={stockOpen}
        onClose={() => setStockOpen(false)}
        branchName={selectedBranch}
        petugasName={userData?.name || 'Admin'}
        allowEdit={['admin', 'administrator', 'owner'].includes(userData?.role?.toLowerCase())}
        livePorsiSisa={livePorsiSisaMemo}
        onPorsiTransfer={(itemName, qty) => {
          setPorsiTransfers(prev => ({...prev, [itemName]: (prev[itemName]||0) + qty}));
        }}
        liveSafetyStock={localLiveSafetyStock}
        onStockChange={() => fetchInventory(selectedBranch)}
      />

      {/* Header */}
      <div className="page-title flex justify-between items-center">
        <div>
          <h1 className="text-primary" style={{ fontSize: '1.2rem', marginBottom: 0 }}>Input Laporan Shift</h1>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {isShiftStarted && (
            <Link
              to={kasirPath}
              className="btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', borderColor: 'var(--primary)', color: 'var(--primary)', textDecoration: 'none' }}
            >
              <Icon name="cart" size={16} /> Kasir
            </Link>
          )}
          {(['admin', 'administrator', 'owner'].includes(userData?.role?.toLowerCase())) && (
            <button
              type="button"
              onClick={() => setStockOpen(true)}
              className="btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', borderColor: 'var(--primary)', color: 'var(--primary)' }}
            >
              <Icon name="package" size={16} /> Stok
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (!window.confirm(`Tinggalkan ${selectedBranch}?\n\nIsian penjualan kamu DISIMPAN OTOMATIS sebagai draft — kalau balik ke ${selectedBranch} (shift ${shift}) dalam 24 jam, isiannya dipulihkan.`)) return;
              // Simpan draft cabang ini SEKARANG (jangan andalkan effect — isShiftStarted keburu false).
              try {
                localStorage.setItem(`pos_draft_${selectedBranch}_shift${shift}`, JSON.stringify({
                  products: products.map(p => ({ id: p.id, qty: p.qty, tambah: p.tambah, safety_qty: p.safety_qty, tambah_safety: p.tambah_safety, porsi_terpakai: p.porsi_terpakai, porsi_rusak: p.porsi_rusak, susu_qty: p.susu_qty, susu_add_price: p.susu_add_price })),
                  expenses, cashAwal, displayAtShiftStart, timestamp: Date.now()
                }));
              } catch (e) { /* localStorage penuh — abaikan */ }
              setIsShiftStarted(false);
              localStorage.removeItem('pos_active_session');
            }}
            className="btn-primary"
            style={{ whiteSpace: 'nowrap' }}
          >
            Ganti Cabang
          </button>
        </div>
      </div>

      {/* Info bar */}
      <div className="glass-panel" style={{ padding: '0.6rem 0.9rem', marginBottom: '1rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <div style={{ backgroundColor: '#1d1d1f', color: '#ffffff', padding: '0.35rem 0.75rem', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <Icon name="user" size={15} /> {userData?.name || 'Staff'}
        </div>
        <div style={{ padding: '0.35rem 0.75rem', borderRadius: '8px', fontSize: '0.85rem', backgroundColor: '#1d1d1f', color: '#ffffff', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <Icon name="calendar" size={15} /> {new Date(`${selectedDate}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
        </div>
        <div style={{ padding: '0.35rem 0.75rem', borderRadius: '8px', fontSize: '0.85rem', background: 'var(--fill-subtle)', fontWeight: 600, border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <Icon name="store" size={15} /> {selectedBranch}
        </div>
        <div style={{ padding: '0.35rem 0.75rem', borderRadius: '8px', fontSize: '0.85rem', background: 'var(--fill-subtle)', fontWeight: 600, border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <Icon name="clock" size={15} /> Shift {shift}
        </div>
        {isShiftStarted && (
          <button
            type="button"
            onClick={handleSyncDisplayAwal}
            title="Ambil ulang Stok Awal dari database (dipakai kalau ada koreksi Set Stok setelah shift ini dibuka)"
            className="btn-secondary"
            style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <Icon name="refresh" size={14} /> Sinkron Stok Awal
          </button>
        )}
        <button
          type="button"
          onClick={handleHardRefresh}
          disabled={isHardRefreshing}
          title="Muat ulang paksa: buang cache browser & tarik versi app terbaru. Isian draft aman."
          className="btn-secondary"
          style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
        >
          <Icon name="refresh" size={14} className={isHardRefreshing ? 'animate-spin' : ''} />
          {isHardRefreshing ? 'Memuat ulang…' : 'Muat Ulang'}
        </button>
      </div>

      {/* Pending Actions Banner */}
      {isShiftStarted && pendingActions.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: 600 }}>
            <Icon name="clock" size={12} style={{ verticalAlign: '-2px', marginRight: '0.25rem' }} />
            Kiriman/operan yang belum di-ACC atau ditolak sampai ganti hari akan otomatis kedaluwarsa dan harus dikirim ulang oleh gudang.
          </p>
          {bulkAcceptableIds().length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', padding: '0.5rem 0.75rem', marginBottom: '0.5rem', background: 'var(--panel-bg)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}>
                <input type="checkbox"
                  checked={bulkAcceptableIds().every(id => selectedActions[id])}
                  onChange={toggleSelectAll}
                  style={{ width: '1.05rem', height: '1.05rem', cursor: 'pointer' }} />
                Pilih semua
              </label>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {Object.values(selectedActions).filter(Boolean).length} terpilih
              </span>
              <button type="button" onClick={handleBulkAccept}
                disabled={bulkLoading || Object.values(selectedActions).filter(Boolean).length === 0}
                className="btn-primary"
                style={{ marginLeft: 'auto', padding: '0.4rem 0.9rem', fontSize: '0.85rem', whiteSpace: 'nowrap', opacity: (bulkLoading || Object.values(selectedActions).filter(Boolean).length === 0) ? 0.5 : 1 }}>
                {bulkLoading ? 'Memproses...' : `ACC Terpilih (${Object.values(selectedActions).filter(Boolean).length})`}
              </button>
            </div>
          )}
          {pendingActions.map(action => (
            <div key={action.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
              flexWrap: 'wrap', gap: '0.75rem',
              padding: '0.8rem 1rem', borderRadius: '8px', marginBottom: '0.5rem',
              backgroundColor: action.action_type === 'transfer' ? 'rgba(13, 111, 255, 0.1)' : action.action_type === 'transfer_out' ? 'rgba(255, 149, 0, 0.1)' : action.action_type === 'pengiriman_display' ? 'rgba(13, 111, 255, 0.1)' : action.action_type === 'pengiriman_gudang' ? 'rgba(255, 149, 0, 0.1)' : 'rgba(255, 56, 60, 0.1)',
              border: `1px solid ${action.action_type === 'transfer' ? 'rgba(13, 111, 255, 0.3)' : action.action_type === 'transfer_out' ? 'rgba(255, 149, 0, 0.3)' : action.action_type === 'pengiriman_display' ? 'rgba(13, 111, 255, 0.3)' : action.action_type === 'pengiriman_gudang' ? 'rgba(255, 149, 0, 0.3)' : 'rgba(255, 56, 60, 0.3)'}`
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.7rem', minWidth: 0, flex: '1 1 240px' }}>
                {(action.action_type === 'pengiriman_display' || action.action_type === 'pengiriman_gudang' || action.action_type === 'transfer') && (
                  <input type="checkbox"
                    checked={!!selectedActions[action.id]}
                    onChange={() => toggleSelectAction(action.id)}
                    disabled={accLoading[action.id] || bulkLoading}
                    style={{ width: '1.1rem', height: '1.1rem', marginTop: '0.2rem', flexShrink: 0, cursor: 'pointer' }} />
                )}
              <div style={{ minWidth: 0, flex: 1, wordBreak: 'break-word' }}>
                <p style={{ fontWeight: 700, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', color: action.action_type === 'transfer' ? '#0d6fff' : action.action_type === 'transfer_out' ? '#c2410c' : action.action_type === 'pengiriman_display' ? '#0d6fff' : action.action_type === 'pengiriman_gudang' ? '#c2410c' : 'var(--danger)' }}>
                  <Icon name={action.action_type === 'transfer_out' ? 'arrow-up-right' : action.action_type === 'deduct' ? 'alert-triangle' : 'package'} size={16} />
                  {action.action_type === 'transfer' ? 'Kiriman Barang Masuk'
                    : action.action_type === 'transfer_out' ? 'Permintaan Operan Keluar'
                    : action.action_type === 'pengiriman_display' ? 'Kiriman Baru → Display'
                    : action.action_type === 'pengiriman_gudang' ? 'Kiriman Baru → Stok (Safety)'
                    : 'Penarikan Barang Keluar'}
                </p>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-color)', marginTop: '0.2rem' }}>
                  <strong>{action.qty} unit</strong> - {action.item_name}
                </p>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {action.action_type === 'transfer_out' ? `Tujuan: ${action.source_branch} (Req: ${action.created_by})` : `Dari Gudang: ${action.created_by}`}
                </p>
                {(action.action_type === 'pengiriman_display' || action.action_type === 'pengiriman_gudang') && (
                  <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', marginTop: '0.4rem' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>Masuk ke:</span>
                    {[
                      { t: 'pengiriman_display', label: 'Display' },
                      { t: 'pengiriman_gudang', label: 'Stok' }
                    ].map(({ t, label }) => {
                      const active = destOf(action) === t;
                      return (
                        <button
                          key={t}
                          type="button"
                          disabled={accLoading[action.id]}
                          onClick={() => setDestChoice(prev => ({ ...prev, [action.id]: t }))}
                          style={{
                            padding: '0.15rem 0.55rem', fontSize: '0.72rem', fontWeight: 700,
                            borderRadius: '6px', cursor: accLoading[action.id] ? 'not-allowed' : 'pointer',
                            border: `1px solid ${active ? '#0d6fff' : 'var(--border-color)'}`,
                            backgroundColor: active ? '#0d6fff' : 'white',
                            color: active ? 'white' : 'var(--text-muted)'
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                    {destOf(action) !== action.action_type && (
                      <span style={{ fontSize: '0.68rem', color: '#c2410c' }}>(diubah dari {action.action_type === 'pengiriman_display' ? 'Display' : 'Stok'})</span>
                    )}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-start', marginTop: '0.65rem' }}>
                {editQty[action.id] !== undefined ? (
                  <>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      autoFocus
                      value={editQty[action.id]}
                      onChange={e => setEditQty(prev => ({ ...prev, [action.id]: e.target.value }))}
                      style={{
                        width: '72px', padding: '0.4rem 0.5rem', fontSize: '0.85rem',
                        border: '1px solid var(--border-color)', borderRadius: '6px', textAlign: 'center'
                      }}
                    />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>unit diterima</span>
                    <button
                      onClick={() => handleAcceptEditSave(action)}
                      disabled={accLoading[action.id]}
                      style={{
                        backgroundColor: accLoading[action.id] ? '#8e8e93' : 'var(--primary)',
                        color: 'white', padding: '0.5rem 1rem',
                        border: 'none', borderRadius: '6px', fontWeight: 700,
                        cursor: accLoading[action.id] ? 'not-allowed' : 'pointer',
                        fontSize: '0.85rem', whiteSpace: 'nowrap'
                      }}
                    >
                      {accLoading[action.id] ? 'Memproses...' : 'Simpan & ACC'}
                    </button>
                    <button
                      onClick={() => setEditQty(prev => { const n = { ...prev }; delete n[action.id]; return n; })}
                      disabled={accLoading[action.id]}
                      style={{
                        backgroundColor: 'white', color: 'var(--text-muted)', padding: '0.5rem 0.8rem',
                        border: '1px solid var(--border-color)', borderRadius: '6px', fontWeight: 700,
                        cursor: 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap'
                      }}
                    >
                      Batal
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => handleRejectAction(action.id)}
                      disabled={accLoading[action.id]}
                      style={{
                        backgroundColor: accLoading[action.id] ? '#f2f2f7' : 'white',
                        color: 'var(--danger)', padding: '0.5rem 0.8rem',
                        border: '1px solid var(--danger)', borderRadius: '6px', fontWeight: 700,
                        cursor: accLoading[action.id] ? 'not-allowed' : 'pointer',
                        fontSize: '0.8rem', whiteSpace: 'nowrap'
                      }}
                    >
                      Tolak
                    </button>
                    {(action.action_type === 'pengiriman_display' || action.action_type === 'pengiriman_gudang') && (
                      <button
                        onClick={() => setEditQty(prev => ({ ...prev, [action.id]: String(action.qty) }))}
                        disabled={accLoading[action.id]}
                        style={{
                          backgroundColor: accLoading[action.id] ? '#f2f2f7' : 'white',
                          color: '#c2410c', padding: '0.5rem 0.8rem',
                          border: '1px solid #c2410c', borderRadius: '6px', fontWeight: 700,
                          cursor: accLoading[action.id] ? 'not-allowed' : 'pointer',
                          fontSize: '0.8rem', whiteSpace: 'nowrap'
                        }}
                      >
                        Terima + Edit
                      </button>
                    )}
                    <button
                      onClick={() => handleAcceptAction(action.id, { action_type: destOf(action) })}
                      disabled={accLoading[action.id]}
                      style={{
                        backgroundColor: accLoading[action.id] ? '#8e8e93' : 'var(--primary)',
                        color: 'white', padding: '0.5rem 1rem',
                        border: 'none', borderRadius: '6px', fontWeight: 700,
                        cursor: accLoading[action.id] ? 'not-allowed' : 'pointer',
                        fontSize: '0.85rem', whiteSpace: 'nowrap'
                      }}
                    >
                      {accLoading[action.id] ? 'Memproses...' : 'ACC Terima'}
                    </button>
                  </>
                )}
                </div>
              </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <KasirOmzetBanner branchName={selectedBranch} date={selectedDate} />

      {/* Shift info banner */}
      <div style={{
        padding: '0.5rem 0.9rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.82rem', fontWeight: 600,
        backgroundColor: shift === '1' ? 'rgba(255, 204, 0,0.12)' : 'rgba(52, 199, 89,0.1)',
        color: shift === '1' ? '#9a3412' : 'var(--primary)',
        border: `1px solid ${shift === '1' ? 'rgba(255, 204, 0,0.4)' : 'rgba(52, 199, 89,0.3)'}`,
        display: 'flex', alignItems: 'center', gap: '0.4rem'
      }}>
        <Icon name="info" size={15} />
        {shift === '1'
          ? 'Shift 1: Laporan penjualan + Kartu Stok Shift 1 akan diunduh.'
          : shift === '2'
            ? 'Shift 2: Laporan penjualan + Kartu Stok gabungan (Shift 1 & 2) akan diunduh.'
            : 'Shift Full: Laporan penjualan + Kartu Stok lengkap akan diunduh.'}
      </div>

      <form onSubmit={handlePreSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', alignItems: 'start' }}>

          {/* LEFT: Products + Update Stock Button */}
          <div>
            <div className="glass-panel" style={{ padding: '1rem', marginBottom: '0.75rem' }}>
              <h2 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>Form Stok Outlet</h2>
              <p className="text-muted" style={{ fontSize: '0.78rem', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                Masukkan <strong>Sisa Stok Akhir</strong> untuk setiap item. Urutan mengikuti Form Stok Outlet.
              </p>

              {loading ? (
                <p className="text-muted" style={{ textAlign: 'center', padding: '1rem 0' }}>Memuat produk...</p>
              ) : products.length === 0 ? (
                <p className="text-muted" style={{ textAlign: 'center', padding: '1rem 0' }}>Belum ada produk. Hubungi Admin.</p>
              ) : (() => {
                // ═══ MERGED VIEW: Gabungkan semua produk + bahan dalam 1 list ═══
                const allItems = products.filter(p => !(p.category === 'Bahan' && (p.name === 'Coffee Cream' || p.name === 'Coffe Cream' || p.name === 'Coffe Cream Ori')));

                // Group by name
                const byName = allItems.reduce((acc, prod) => {
                  if (!acc[prod.name]) acc[prod.name] = [];
                  acc[prod.name].push(prod);
                  return acc;
                }, {});

                // Sort groups by minimum display_order
                const sortedGroups = Object.entries(byName).sort((a, b) => {
                  const minOrderA = Math.min(...a[1].map(v => v.display_order || 999));
                  const minOrderB = Math.min(...b[1].map(v => v.display_order || 999));
                  if (minOrderA !== minOrderB) return minOrderA - minOrderB;
                  return a[0].localeCompare(b[0]);
                });

                return (
                  <div>

                    {/* INFORMASI ES TEH TERJUAL */}
                    <div style={{ marginBottom: '0.75rem' }}>
                      <button
                        type="button"
                        onClick={() => setShowEsTehInfo(!showEsTehInfo)}
                        style={{
                          fontSize: '0.75rem', fontWeight: 700,
                          padding: '0.4rem 0.75rem', borderRadius: '6px',
                          backgroundColor: showEsTehInfo ? 'rgba(13, 111, 255,0.15)' : 'rgba(0,0,0,0.05)',
                          color: showEsTehInfo ? '#0d6fff' : 'var(--text-muted)',
                          border: 'none', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: '0.4rem'
                        }}
                      >
                        {showEsTehInfo ? 'Sembunyikan Informasi Es Teh Terjual' : 'Tampilkan Informasi Es Teh Terjual'}
                      </button>
                    </div>

                    {showEsTehInfo && (
                      <div style={{
                        marginBottom: '1rem',
                        padding: '0.75rem',
                        backgroundColor: 'rgba(13,111,255,0.08)',
                        borderRadius: '8px',
                        borderLeft: '4px solid #0d6fff',
                        fontSize: '0.8rem',
                        color: '#1d1d1f'
                      }}>
                        <div style={{ marginBottom: '0.5rem' }}>
                          <strong>Info:</strong> Penjualan <strong>Es Teh</strong> dihitung otomatis dari sisa stok fisik <strong>Cup (Ori/Premi)</strong>.
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontWeight: 600, fontSize: '0.85rem' }}>
                          <div>
                            <span style={{ color: 'var(--accent)', display: 'block', marginBottom: '0.2rem' }}>
                              → Es Teh Ori Terjual: {
                                getPureSoldQty(products.find(p => p.name === 'Es Teh' && p.variant !== 'Premi') || { name: 'Es Teh', variant: 'Ori' })
                              } cup
                            </span>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', paddingLeft: '1rem', fontWeight: 400 }}>
                              Rincian Minuman Ori Lain yg memotong (termasuk Varian Susu):
                              {products.filter(p => {
                                let pIsPremi = p.variant === 'Premi';
                                if (p.variant === 'Standar' || !p.variant) {
                                  if (p.name.trim().toLowerCase().endsWith(' premi')) pIsPremi = true;
                                }
                                if (pIsPremi) return false;

                                const nonCupFlavors = ['Strawberry', 'Melon', 'Avocado', 'Green Tea', 'Green Tea Latte', 'Choco Oreo', 'Taro', 'Hazelnut', 'Brown Sugar', 'Salted Caramel', 'Madu Hutan'];
                                const isSubtractor = CUP_SUBTRACTOR_DRINKS.includes(p.name);
                                const isMilkBase = p.is_unlimited && p.name !== 'Es Teh' && !nonCupFlavors.includes(p.name);
                                const isDualBaseMilk = p.is_dual_base && parseInt(p.susu_qty) > 0 && p.name !== 'Es Teh';

                                return isSubtractor || isMilkBase || isDualBaseMilk;
                              }).map(p => {
                                let q = 0;
                                const nonCupFlavors = ['Strawberry', 'Melon', 'Avocado', 'Green Tea', 'Green Tea Latte', 'Choco Oreo', 'Taro', 'Hazelnut', 'Brown Sugar', 'Salted Caramel', 'Madu Hutan'];
                                if (CUP_SUBTRACTOR_DRINKS.includes(p.name) || (p.is_unlimited && !nonCupFlavors.includes(p.name))) {
                                  q = getProductSoldQty(p);
                                } else if (p.is_dual_base) {
                                  q = parseInt(p.susu_qty) || 0;
                                }
                                return q > 0 ? ` ${p.name} (${q}),` : '';
                              }).filter(Boolean).join('') || ' Belum ada'}
                            </div>
                          </div>
                          <div>
                            <span style={{ color: '#c2410c', display: 'block', marginBottom: '0.2rem' }}>
                              → Es Teh Premi Terjual: {
                                getPureSoldQty(products.find(p => p.name === 'Es Teh' && p.variant === 'Premi') || { name: 'Es Teh', variant: 'Premi' })
                              } cup
                            </span>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', paddingLeft: '1rem', fontWeight: 400 }}>
                              Rincian Minuman Premi Lain yg memotong (termasuk Varian Susu):
                              {products.filter(p => {
                                let pIsPremi = p.variant === 'Premi';
                                if (p.variant === 'Standar' || !p.variant) {
                                  if (p.name.trim().toLowerCase().endsWith(' premi')) pIsPremi = true;
                                }
                                if (!pIsPremi) return false;

                                const nonCupFlavors = ['Strawberry', 'Melon', 'Avocado', 'Green Tea', 'Green Tea Latte', 'Choco Oreo', 'Taro', 'Hazelnut', 'Brown Sugar', 'Salted Caramel', 'Madu Hutan'];
                                const isSubtractor = CUP_SUBTRACTOR_DRINKS.includes(p.name);
                                const isMilkBase = p.is_unlimited && p.name !== 'Es Teh' && !nonCupFlavors.includes(p.name);
                                const isDualBaseMilk = p.is_dual_base && parseInt(p.susu_qty) > 0 && p.name !== 'Es Teh';

                                return isSubtractor || isMilkBase || isDualBaseMilk;
                              }).map(p => {
                                let q = 0;
                                const nonCupFlavors = ['Strawberry', 'Melon', 'Avocado', 'Green Tea', 'Green Tea Latte', 'Choco Oreo', 'Taro', 'Hazelnut', 'Brown Sugar', 'Salted Caramel', 'Madu Hutan'];
                                if (CUP_SUBTRACTOR_DRINKS.includes(p.name) || (p.is_unlimited && !nonCupFlavors.includes(p.name))) {
                                  q = getProductSoldQty(p);
                                } else if (p.is_dual_base) {
                                  q = parseInt(p.susu_qty) || 0;
                                }
                                return q > 0 ? ` ${p.name} (${q}),` : '';
                              }).filter(Boolean).join('') || ' Belum ada'}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ═══ UNIFIED MERGED LIST ═══ */}
                    {sortedGroups.map(([itemName, rawVariants], nameIdx) => {
                      const variantOrder = { 'Ori': 1, 'Premi': 2, 'Standar': 3 };
                      const variants = [...rawVariants].sort((a, b) => (variantOrder[a.variant] || 99) - (variantOrder[b.variant] || 99));
                      const orderNumber = Math.min(...variants.map(v => v.display_order || 999));
                      const isBahan = variants[0].category === 'Bahan';

                      return (
                        <div key={itemName} style={{
                          border: `1px solid ${isBahan ? 'rgba(13, 111, 255,0.3)' : 'var(--border-color)'}`,
                          borderLeft: isBahan ? '3px solid #0d6fff' : '1px solid var(--border-color)',
                          borderRadius: '10px',
                          marginBottom: nameIdx === sortedGroups.length - 1 ? '0' : '0.5rem',
                          overflow: 'hidden'
                        }}>
                          {/* Item Name Header */}
                          <div style={{
                            padding: '0.4rem 0.75rem',
                            backgroundColor: isBahan ? 'rgba(13, 111, 255,0.06)' : '#f2f2f7',
                            borderBottom: '1px solid var(--border-color)',
                            fontWeight: 700,
                            fontSize: '0.88rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem'
                          }}>
                            {orderNumber <= 70 && (
                              <span style={{
                                backgroundColor: isBahan ? '#0d6fff' : 'var(--primary)', color: 'white', padding: '0.1rem 0.45rem',
                                borderRadius: '6px', fontSize: '0.7rem', fontWeight: 800, minWidth: '22px', textAlign: 'center'
                              }}>
                                {orderNumber}
                              </span>
                            )}
                            <span style={{ flex: 1 }}>{itemName}</span>
                            {(!isBahan || autoBahanNames.has(itemName))
                              ? <span title="Terjual dihitung otomatis dari transaksi Kasir" style={{ fontSize: '0.65rem', fontWeight: 800, padding: '0.1rem 0.4rem', borderRadius: '5px', background: 'rgba(52,199,89,0.15)', color: '#096C46' }}>Otomatis (Kasir)</span>
                              : <span title="Tidak tercatat di Kasir / resep — isi Sisa manual saat opname" style={{ fontSize: '0.65rem', fontWeight: 800, padding: '0.1rem 0.4rem', borderRadius: '5px', background: 'rgba(255,149,0,0.18)', color: '#c2410c' }}>Isi Manual</span>}
                          </div>

                          {/* Variant/Item Rows */}
                          {variants.map((prod, vIdx) => {
                            const stockKey = isBahan ? prod.name : getStockKey(prod);
                            const cStock = inventoryMap[stockKey] ?? inventoryMap[prod.name] ?? 0;
                            const displayNow = displayMap[stockKey] ?? displayMap[prod.name] ?? 0;
                            const safetyAwal = safetyMap[stockKey] ?? safetyMap[prod.name] ?? 0;
                            const displayAwal = displayNow;
                            const pindahan = tambahMap[stockKey] ?? tambahMap[prod.name] ?? 0;
                            const isEmpty = displayAwal === 0 && safetyAwal === 0;
                            const isLastVariant = vIdx === variants.length - 1;

                            return (
                              <div key={prod.id} style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.5rem',
                                padding: '0.75rem',
                                borderBottom: isLastVariant ? 'none' : '1px dashed var(--border-color)',
                                backgroundColor: isEmpty ? 'rgba(255, 56, 60,0.02)' : vIdx % 2 === 0 ? 'rgba(13, 111, 255,0.02)' : 'white'
                              }}>
                                {/* Top Row: Variant Name, Price, Sold Qty */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    {variants.length > 1 && (
                                      <span style={{
                                        padding: '0.15rem 0.5rem', borderRadius: '5px', fontSize: '0.72rem', fontWeight: 700,
                                        backgroundColor: prod.variant === 'Ori' ? 'rgba(255, 204, 0,0.2)' : prod.variant === 'Premi' ? 'rgba(13, 111, 255,0.15)' : 'rgba(13, 111, 255,0.12)',
                                        color: prod.variant === 'Ori' ? '#c2410c' : prod.variant === 'Premi' ? '#0d6fff' : '#0d6fff'
                                      }}>{prod.name !== itemName ? (prod.name.replace(itemName, '').trim() || prod.variant) : prod.variant}</span>
                                    )}
                                    {!isBahan && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Rp {(prod.price || 0).toLocaleString('id-ID')}</span>}
                                  </div>
                                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--primary)' }}>
                                    {isAutoCalculated(prod) ? `${formatFraction(getProductSoldQty(prod))} Terjual (Auto)` : `${formatFraction(getProductSoldQty(prod))} Keluar`}
                                  </div>
                                </div>

                                {isAutoCalculated(prod) && !isBahan && (
                                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'right', marginTop: '-0.2rem' }}>{getEsTehCalculationText(prod)}</div>
                                )}

                                {/* Stock Cards (The new layout) */}
                                {!isAutoCalculated(prod) && (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.2rem' }}>

                                    {/* Safety Row */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0.6rem', backgroundColor: '#f2f2f7', borderRadius: '6px', border: '1px dashed var(--border-color)', flexWrap: 'wrap', gap: '0.5rem' }}>
                                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                        Stok/Gudang: <strong style={{ color: 'var(--text-color)' }}>{formatFraction(safetyAwal)}</strong>
                                      </div>
                                      {prod.name === 'Diamond Besar' && ultraInDiamond > 0 && (
                                        <div style={{ fontSize: '0.72rem', color: '#ff9500', fontWeight: 700 }}>
                                          Hasil konversi Ultra: {formatFraction(ultraInDiamond)} kotak (sisanya Diamond asli)
                                        </div>
                                      )}
                                    </div>

                                    {/* Display Row */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.6rem', backgroundColor: 'rgba(13, 111, 255,0.05)', borderRadius: '6px', border: '1px solid rgba(13, 111, 255,0.2)' }}>
                                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                        Awal: <strong style={{ color: '#0d6fff' }}>{formatFraction(displayAwal)}</strong>
                                        {pindahan > 0 && (
                                          <span style={{ color: '#096C46', fontSize: '0.75rem', fontWeight: 700 }}>(+{formatFraction(pindahan)} Tambahan)</span>
                                        )}
                                        {kasirQtyFor(prod) > 0 && (
                                          <span style={{ color: '#ff9500', fontSize: '0.75rem', fontWeight: 700 }}>(−{formatFraction(kasirQtyFor(prod))} Kasir)</span>
                                        )}
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <span style={{ fontSize: '0.85rem', color: '#0d6fff', fontWeight: 700 }}>Sisa:</span>
                                        <input type="text"
                                          // Bahan bisa diisi pecahan "1/2" → keyboard penuh. Minuman
                                          // cuma angka → numpad (tablet ga nebak sendiri kayak HP).
                                          inputMode={prod.category === 'Bahan' ? 'text' : 'decimal'}
                                          className="pos-stock-input"
                                          data-col="qty"
                                          onKeyDown={e => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault();
                                              const inputs = Array.from(document.querySelectorAll('.pos-stock-input'));
                                              const idx = inputs.indexOf(e.target);
                                              if (idx > -1 && idx < inputs.length - 1) {
                                                inputs[idx + 1].focus();
                                                inputs[idx + 1].select();
                                              }
                                            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                                              e.preventDefault();
                                              const col = e.target.getAttribute('data-col');
                                              const inputs = Array.from(document.querySelectorAll(`.pos-stock-input[data-col="${col}"]`));
                                              const idx = inputs.indexOf(e.target);
                                              const nextIdx = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
                                              if (nextIdx >= 0 && nextIdx < inputs.length) {
                                                inputs[nextIdx].focus();
                                                inputs[nextIdx].select();
                                              }
                                            }
                                          }}
                                          title={exceedsAvail(prod) ? 'Sisa melebihi stok tersedia — akan diingatkan saat Tutup Shift' : undefined}
                                          style={{
                                            width: '60px', padding: '0.3rem', borderRadius: '6px', fontSize: '0.9rem', fontWeight: 700, textAlign: 'center',
                                            border: `2px solid ${(isInvalidFraction(prod) || exceedsAvail(prod)) ? '#ff383c' : prod.qty !== '' ? '#0d6fff' : 'rgba(13, 111, 255,0.4)'}`,
                                            backgroundColor: (isInvalidFraction(prod) || exceedsAvail(prod)) ? 'rgba(255, 56, 60,0.1)' : 'white',
                                            color: (isInvalidFraction(prod) || exceedsAvail(prod)) ? '#ff383c' : 'inherit'
                                          }}
                                          placeholder={formatFraction(Math.max(0, displayAwal + pindahan - kasirQtyFor(prod)))} value={prod.qty}
                                          onChange={e => handleProductChange(prod.id, 'qty', e.target.value)} />
                                      </div>
                                    </div>

                                  </div>
                                )}

                                {/* Extra Bubble & Milky Logic */}
                                {(() => {
                                  const bungkusKeluar = getProductSoldQty(prod);
                                  const isBubble = prod.name && prod.name.toLowerCase().includes('bubble');
                                  let loosePortions = 0;
                                  if (isBubble) {
                                    const porsiAwal = parseInt(prod.porsi_sisa_awal) || 0;
                                    const transferAwal = parseInt(prod.porsi_transfer_awal) || 0;
                                    const sessionTransfer = sessionPorsiTransfers[`Porsi ${prod.name}`] || 0;
                                    loosePortions = porsiAwal + transferAwal + sessionTransfer;
                                  }

                                  return (
                                    <>
                                      {isBubble && (
                                        <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem', backgroundColor: 'rgba(175, 82, 222, 0.05)', padding: '0.4rem', borderRadius: '6px', border: '1px dashed rgba(175, 82, 222, 0.3)', flexWrap: 'wrap' }}>
                                          <span style={{ width: '100%', color: '#9c33c0', fontSize: '0.7rem', paddingBottom: '0.2rem', borderBottom: '1px solid rgba(175, 82, 222, 0.1)' }}>
                                            Sisa Porsi (Luar Wadah): <strong>{loosePortions}</strong>
                                          </span>
                                          <span style={{ color: '#9c33c0', fontSize: '0.7rem' }}>Porsi terpakai:</span>
                                          <input
                                            type="number"
                                            inputMode="numeric"
                                            style={{
                                              width: '45px', padding: '0.2rem',
                                              border: '1px solid #e0b3f0', borderRadius: '4px',
                                              fontSize: '0.8rem', textAlign: 'center', color: '#9c33c0', fontWeight: 700
                                            }}
                                            placeholder="0"
                                            value={prod.porsi_terpakai || ''}
                                            onChange={e => {
                                              const porsiAwal = parseInt(prod.porsi_sisa_awal) || 0;
                                              const transferAwal = parseInt(prod.porsi_transfer_awal) || 0;
                                              const sessionTransfer = sessionPorsiTransfers[`Porsi ${prod.name}`] || 0;
                                              const maxTotal = (bungkusKeluar * (prod.name && prod.name.toLowerCase().includes('kecil') ? 10 : 20)) + porsiAwal + transferAwal + sessionTransfer;
                                              const currentRusak = parseInt(prod.porsi_rusak) || 0;
                                              let val = parseInt(e.target.value) || 0;
                                              if (e.target.value !== '' && val + currentRusak > maxTotal) val = maxTotal - currentRusak;
                                              handleProductChange(prod.id, 'porsi_terpakai', e.target.value === '' ? '' : Math.max(0, val).toString());
                                            }}
                                          />
                                          <span style={{ color: '#ff383c', fontSize: '0.7rem', marginLeft: '0.4rem' }}>Rusak:</span>
                                          <input
                                            type="number"
                                            inputMode="numeric"
                                            style={{
                                              width: '45px', padding: '0.2rem',
                                              border: '1px solid #ffb3b5', borderRadius: '4px',
                                              fontSize: '0.8rem', textAlign: 'center', color: '#ff383c', fontWeight: 700
                                            }}
                                            placeholder="0"
                                            value={prod.porsi_rusak || ''}
                                            onChange={e => {
                                              const porsiAwal = parseInt(prod.porsi_sisa_awal) || 0;
                                              const transferAwal = parseInt(prod.porsi_transfer_awal) || 0;
                                              const sessionTransfer = sessionPorsiTransfers[`Porsi ${prod.name}`] || 0;
                                              const maxTotal = (bungkusKeluar * (prod.name && prod.name.toLowerCase().includes('kecil') ? 10 : 20)) + porsiAwal + transferAwal + sessionTransfer;
                                              const currentTerpakai = parseInt(prod.porsi_terpakai) || 0;
                                              let val = parseInt(e.target.value) || 0;
                                              if (e.target.value !== '' && currentTerpakai + val > maxTotal) val = maxTotal - currentTerpakai;
                                              handleProductChange(prod.id, 'porsi_rusak', e.target.value === '' ? '' : Math.max(0, val).toString());
                                            }}
                                          />
                                        </div>
                                      )}

                                      {/* Dual Base (Milky) Logic */}
                                      {prod.is_dual_base && (
                                        <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.4rem' }}>
                                          <button
                                            onClick={() => toggleSusuInput(prod.id)}
                                            style={{
                                              fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.5rem',
                                              borderRadius: '6px', cursor: 'pointer',
                                              backgroundColor: showSusuInput[prod.id] ? 'rgba(13, 111, 255, 0.15)' : 'rgba(0,0,0,0.05)',
                                              color: showSusuInput[prod.id] ? '#0d6fff' : 'var(--text-muted)',
                                              border: 'none',
                                              transition: 'all 0.2s'
                                            }}
                                          >
                                            + Milky
                                          </button>

                                          {showSusuInput[prod.id] && (
                                            <div className="animate-fade-in" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', backgroundColor: 'rgba(13, 111, 255,0.1)', padding: '0.3rem 0.5rem', borderRadius: '8px', border: '1px dashed #0d6fff' }}>
                                              <input type="number" inputMode="numeric" min="0" step="any" max={getProductSoldQty(prod)}
                                                style={{
                                                  width: '60px',
                                                  padding: '0.2rem',
                                                  border: '1px solid #9cc4ff',
                                                  borderRadius: '6px',
                                                  fontSize: '0.85rem',
                                                  textAlign: 'center',
                                                  backgroundColor: 'white'
                                                }}
                                                placeholder="0" value={prod.susu_qty || ''}
                                                onChange={e => {
                                                  const maxSold = getProductSoldQty(prod);
                                                  let val = parseInt(e.target.value) || 0;
                                                  if (val > maxSold) val = maxSold;
                                                  handleProductChange(prod.id, 'susu_qty', e.target.value === '' ? '' : val.toString());
                                                }} />
                                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <span style={{ fontSize: '0.7rem', color: '#0d6fff', fontWeight: 700, lineHeight: 1 }}>porsi pakai susu</span>
                                                <span style={{ fontSize: '0.65rem', color: '#0d6fff', lineHeight: 1 }}>+Rp{prod.susu_add_price?.toLocaleString('id-ID')}</span>
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </>
                                  );
                                })()}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                    <div style={{ marginBottom: '1rem' }} />
                  </div>
                );
              })()}
            </div>

          </div>

          {/* RIGHT: Expenses + Stock Opname */}
          <div className="flex-col gap-4">

            <div className="glass-panel" style={{ padding: '1.5rem', opacity: 0.7, pointerEvents: 'none', backgroundColor: '#f2f2f7' }}>
              <h2 style={{ fontSize: '1.2rem', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>Arus Kas & Pengeluaran</h2>
              <div style={{ marginBottom: '1rem' }}>
                <label className="text-muted" style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem' }}>Uang Modal Kasir (Cash Awal)</label>
                <input type="number" className="input-field" value={cashAwal} readOnly disabled />
                <p style={{ fontSize: '0.7rem', color: 'var(--primary)', marginTop: '0.3rem' }}>* Modal awal sudah dikunci sejak buka kasir</p>
              </div>
              <div style={{ marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="text-muted" style={{ fontSize: '0.85rem' }}>Pengeluaran Operasional</label>
                <button type="button" style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'not-allowed' }}><Icon name="plus" size={18} /></button>
              </div>
            </div>

            {/* Added a real expenses section that is NOT disabled */}
            <div className="glass-panel" style={{ padding: '1.5rem', marginTop: '1rem' }}>
              <div style={{ marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="text-muted" style={{ fontSize: '0.85rem' }}>Input Pengeluaran Hari Ini</label>
                <button type="button" onClick={handleAddExpense} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer' }}><Icon name="plus" size={18} /></button>
              </div>
              {expenses.map(exp => (
                <div key={exp.id} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <input type="text" className="input-field" placeholder="Keterangan" value={exp.name} readOnly={exp.auto} title={exp.auto ? 'Otomatis dari Kasir (non-tunai, tidak masuk laci)' : undefined} onChange={e => handleExpenseChange(exp.id, 'name', e.target.value)} style={{ flex: 2, ...(exp.auto ? { background: 'rgba(13,111,255,0.06)', fontWeight: 700 } : {}) }} />
                  <input type="number" className="input-field" placeholder="Rp" value={exp.amount} readOnly={exp.auto} onChange={e => handleExpenseChange(exp.id, 'amount', e.target.value)} style={{ flex: 1, ...(exp.auto ? { background: 'rgba(13,111,255,0.06)', fontWeight: 700 } : {}) }} />
                </div>
              ))}
            </div>

            {/* NEW: Catatan */}
            <div className="glass-panel" style={{ padding: '1.5rem', marginTop: '1rem' }}>
              <div style={{ marginBottom: '0.5rem' }}>
                <label className="text-muted" style={{ fontSize: '0.85rem' }}>Catatan Laporan (Opsional)</label>
              </div>
              <textarea
                placeholder="Tulis catatan di sini..."
                value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
                className="input-field"
                style={{ resize: 'vertical', minHeight: '80px', width: '100%', padding: '0.75rem' }}
              />

              {/* Scroll to Top Button (Inline) */}
              <button
                type="button"
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                style={{
                  width: '100%',
                  marginTop: '1rem',
                  padding: '0.8rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  backgroundColor: 'rgba(9, 108, 70, 0.08)',
                  color: 'var(--primary)',
                  border: '1.5px solid rgba(9, 108, 70, 0.3)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.9rem'
                }}
              >
                <Icon name="arrow-up" size={18} /> Naik ke Atas
              </button>
            </div>

          </div>
        </div>

        {/* Bottom Submit Bar */}
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          backgroundColor: 'var(--panel-bg)',
          borderTop: '2px solid var(--border-color)',
          padding: '0.75rem 1rem',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.08)',
          zIndex: 50
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start', gap: '0.25rem', marginBottom: '0.5rem', padding: '0 0.25rem' }}>
            <div style={{ textAlign: 'center', flex: 1 }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem', lineHeight: '1.2' }}>Total Cup<br />Ori</p>
              <p style={{ fontSize: '1rem', fontWeight: 700 }}>{totals.cupOri}</p>
            </div>
            <div style={{ textAlign: 'center', flex: 1 }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem', lineHeight: '1.2' }}>Total Cup<br />Premi</p>
              <p style={{ fontSize: '1rem', fontWeight: 700 }}>{totals.cupPremi}</p>
            </div>
            <div style={{ textAlign: 'center', flex: 1 }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem', lineHeight: '1.2' }}>Penjualan<br />Bersih</p>
              <p style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--success)' }}>Rp {(totals.revenue - totals.expense).toLocaleString('id-ID')}</p>
              <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                ({(totals.revenue / 1000)}k - {(totals.expense / 1000)}k)
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" onClick={handleTestExport} disabled={isSaving || !hasSales} className="btn-secondary"
              style={{ padding: '0.85rem', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', opacity: hasSales ? 1 : 0.6, flex: 1, backgroundColor: '#ff9500', color: 'white', border: 'none', borderRadius: '8px' }}>
              <Icon name="download" size={18} />
              Cek Laporan
            </button>
            <button type="submit" disabled={isSaving || !hasSales} className="btn-primary"
              style={{ padding: '0.85rem', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', opacity: hasSales ? 1 : 0.6, flex: 1.5, backgroundColor: 'var(--primary)', borderRadius: '10px' }}>
              <Icon name="save" size={18} />
              {isSaving ? 'Menyimpan...' : `Tutup Shift ${shift}`}
            </button>
          </div>
          {!hasSales && (
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '0.3rem' }}>Isi qty penjualan untuk menyimpan laporan</p>
          )}
        </div>
      </form>

      {/* MODAL SETORAN */}
      {isDepositModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
        }}>
          <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '450px', padding: '2rem' }}>
            <h2 className="text-primary mb-2 text-center" style={{ fontSize: '1.4rem' }}>Konfirmasi Setoran Shift {shift}</h2>
            <p className="text-muted text-center mb-6" style={{ fontSize: '0.9rem' }}>Lengkapi jumlah uang cash yang disetor sebelum menyimpan laporan.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '1px dashed var(--border-color)' }}>
                <span className="text-muted">Modal Awal</span>
                <span style={{ fontWeight: 600 }}>Rp {(parseInt(cashAwal) || 0).toLocaleString('id-ID')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '1px dashed var(--border-color)' }}>
                <span className="text-muted">Total Penjualan</span>
                <span style={{ fontWeight: 600 }}>Rp {totals.revenue.toLocaleString('id-ID')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '1px dashed var(--border-color)' }}>
                <span className="text-muted">Pengeluaran</span>
                <span style={{ fontWeight: 600, color: 'var(--danger)' }}>Rp {totals.expense.toLocaleString('id-ID')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>
                <span style={{ fontWeight: 700 }}>Seharusnya Disetor</span>
                <span style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--primary)' }}>Rp {(totals.revenue - totals.expense).toLocaleString('id-ID')}</span>
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Jumlah Uang Fisik / Disetor (Aktual)</label>
              <div style={{ display: 'flex', alignItems: 'center', backgroundColor: '#f2f2f7', border: '2px solid var(--primary)', borderRadius: '8px', padding: '0 0.75rem' }}>
                <span style={{ fontWeight: 700, color: 'var(--primary)', marginRight: '0.5rem' }}>Rp</span>
                <input
                  type="text"
                  inputMode="numeric"
                  className="input-field"
                  style={{ border: 'none', background: 'transparent', padding: '0.8rem 0', fontSize: '1.2rem', fontWeight: 700 }}
                  value={setoranAktual ? parseInt(String(setoranAktual).replace(/\D/g, '')).toLocaleString('id-ID') : ''}
                  onChange={e => setSetoranAktual(e.target.value.replace(/\D/g, ''))}
                  placeholder="0"
                  autoFocus
                />
              </div>
            </div>

            {setoranAktual !== '' && (() => {
              const cleanedSetoranUI = parseInt(String(setoranAktual).replace(/\D/g, '')) || 0;
              const targetDisetor = totals.revenue - totals.expense;
              const selisihValUI = cleanedSetoranUI - targetDisetor;
              return (
                <div style={{
                  marginBottom: '2rem', padding: '1rem', borderRadius: '8px',
                  backgroundColor: selisihValUI >= 0 ? 'rgba(52, 199, 89,0.1)' : 'rgba(255, 56, 60,0.1)',
                  border: `1px solid ${selisihValUI >= 0 ? 'rgba(52, 199, 89,0.3)' : 'rgba(255, 56, 60,0.3)'}`
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                    <span style={{ fontWeight: 600, color: selisihValUI >= 0 ? 'var(--primary)' : 'var(--danger)' }}>Selisih</span>
                    <span style={{ fontWeight: 800, fontSize: '1.2rem', color: selisihValUI >= 0 ? 'var(--primary)' : 'var(--danger)' }}>
                      Rp {selisihValUI.toLocaleString('id-ID')}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: selisihValUI >= 0 ? 'var(--primary)' : 'var(--danger)' }}>
                    {selisihValUI > 0
                      ? '(Uang Lebih / Surplus)'
                      : selisihValUI < 0
                        ? '(Uang Kurang / Minus)'
                        : '(Sesuai / Pas)'}
                  </p>
                </div>
              );
            })()}

            <div style={{ display: 'flex', gap: '1rem' }}>
              <button type="button" className="btn-secondary" style={{ flex: 1 }} onClick={() => setIsDepositModalOpen(false)} disabled={isSaving}>
                Batal
              </button>
              <button type="button" className="btn-primary" style={{ flex: 1 }} onClick={processSubmit} disabled={isSaving || setoranAktual === ''}>
                {isSaving ? 'Menyimpan...' : 'Simpan Final'}
              </button>
            </div>
          </div>
        </div>
      )}



    </div>
  );

}

