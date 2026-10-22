import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../supabase';
import { useAuth } from '../contexts/AuthContext';
import { parseQty, formatFraction, getPorsiWindowStart } from '../utils/stockUtils';
import Icon from './Icon';

// Ultra Milk Besar (kotak 4 porsi) dipakai sbg Diamond Besar (5 porsi, Full Cream Ori). Jumlah kotak yg asalnya
// dari Ultra dicatat di baris log meta ULTRA_META (qty_after = sisa 'ultra' di dalam stok Diamond) buat Form Stok.
const ULTRA_SRC = 'Ultra Milk Besar', DIAMOND = 'Diamond Besar', ULTRA_META = 'Ultra di Diamond Besar';

export default function BranchStockDrawer({ isOpen, onClose, branchName, petugasName, allowEdit = false, livePorsiSisa, onPorsiTransfer, liveSafetyStock, onStockChange }) {
  const { userData } = useAuth();
  const isGudangOrAdmin = ['gudang', 'admin', 'administrator', 'owner'].includes(userData?.role?.toLowerCase());
  const [inventory, setInventory] = useState([]);
  const [restockLog, setRestockLog] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [loading, setLoading] = useState(false);

  // actionModal: { type: 'add' | 'deduct' | 'transfer', item_name, current_qty }
  const [actionModal, setActionModal] = useState(null);
  const [actionQty, setActionQty] = useState('');
  const [transferDest, setTransferDest] = useState('');

  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('stock'); // 'stock' | 'log'
  const [logFilter, setLogFilter] = useState('all'); // 'all', 'status', 'deduction', 'addition', 'gudang'
  const [stockMode, setStockMode] = useState('display'); // 'display', 'laci', 'transfer', 'deduct', 'add'
  const [showFullRecent, setShowFullRecent] = useState(false);

  useEffect(() => {
    if (isOpen && branchName) {
      // Reset stale data first
      setInventory([]);
      setRestockLog([]);
      fetchInventory(branchName);
      fetchRestockLog(branchName);
      fetchOutlets();
    }
    // F3: livePorsiSisa SENGAJA tidak di sini. Dia dapat identitas baru tiap
    // keystroke form (products berubah), padahal fetch di bawah tak memakainya —
    // dulu bikin drawer re-fetch terus → "Memuat..." → mode-bar & daftar item
    // unmount sekejap (klik cepat gagal). Fetch cukup pas drawer dibuka / ganti cabang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, branchName]);

  const fetchOutlets = async () => {
    const { data } = await supabase.from('outlets').select('name').neq('name', branchName);
    setOutlets(data || []);
  };

  const fetchInventory = async (branch) => {
    setLoading(true);
    // Fetch inventory + display_order from both products and operational_items
    const [invRes, prodRes, opRes, pendingRes] = await Promise.all([
      supabase.from('branch_inventory').select('*').eq('branch_name', branch),
      supabase.from('products').select('name, variant, display_order').order('display_order'),
      supabase.from('operational_items').select('name, display_order').order('display_order'),
      supabase.from('pending_stock_actions').select('item_name, qty, target_branch, action_type').eq('source_branch', branch).eq('status', 'pending')
    ]);

    // Barang yang lagi dioper, masih nunggu ACC cabang tujuan — biar staff ga bingung
    // kenapa stok kelihatan udah berkurang padahal belum ke-konfirmasi.
    const pendingOutMap = {};
    (pendingRes.data || []).forEach(p => {
      if (!pendingOutMap[p.item_name]) pendingOutMap[p.item_name] = [];
      pendingOutMap[p.item_name].push({ qty: p.qty, target: p.target_branch, type: p.action_type });
    });

    const invData = invRes.data || [];
    const existingItems = new Set(invData.map(i => i.item_name));

    // Build a lookup: item_name -> minimum display_order
    const orderMap = {};
    (prodRes.data || []).forEach(p => {
      const key = p.variant && p.variant !== 'Standar' ? `${p.name} ${p.variant}` : p.name;
      if (orderMap[key] === undefined || p.display_order < orderMap[key]) {
        orderMap[key] = p.display_order;
      }
      // Also map by just name (for items without variant suffix in inventory)
      if (orderMap[p.name] === undefined || p.display_order < orderMap[p.name]) {
        orderMap[p.name] = p.display_order;
      }

      // Ensure item is in invData so it shows up even with 0 stock
      if (!existingItems.has(key)) {
        invData.push({ id: `temp_${key}`, branch_name: branch, item_name: key, current_qty: 0 });
        existingItems.add(key);
      }
    });
    
    (opRes.data || []).forEach(o => {
      if (orderMap[o.name] === undefined || o.display_order < orderMap[o.name]) {
        orderMap[o.name] = o.display_order;
      }
      
      // Ensure operational item is in invData
      if (!existingItems.has(o.name)) {
        invData.push({ id: `temp_${o.name}`, branch_name: branch, item_name: o.name, current_qty: 0 });
        existingItems.add(o.name);
      }
    });

    // Porsi Virtual Items
    let currentPorsiBesar = 0;
    let currentPorsiKecil = 0;

    if (livePorsiSisa) {
      currentPorsiBesar = livePorsiSisa['Bubble Besar'] || 0;
      currentPorsiKecil = livePorsiSisa['Bubble Kecil'] || 0;
    } else {
      const { data: lastRep } = await supabase
        .from('sales_reports')
        .select('details')
        .eq('branch_name', branch)
        // id itu UUID & kolom created_at ga ada — urut pakai date lalu shift
        .order('date', { ascending: false })
        .order('shift', { ascending: false })
        .limit(1);

      let basePorsiBesar = 0;
      let basePorsiKecil = 0;
      let lastRepTime = await getPorsiWindowStart(supabase, branch, lastRep?.[0]);

      // Sisa porsi Bubble hangus otomatis lewat jam 08.00 hari berikutnya (shift yang lupa ditutup dianggap tutup).
      // ponytail: batas tetap 08.00; ganti ke 00.00 kalau staf sudah biasa Tutup Shift tengah malam.
      const now = new Date();
      const porsiHangus = now.getHours() >= 8 && lastRep?.[0]?.date < now.toLocaleDateString('sv');
      if (porsiHangus) lastRepTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8).toISOString();

      if (lastRep && lastRep.length > 0 && !porsiHangus) {
        (lastRep[0].details || []).forEach(p => {
          if (p.name === 'Bubble Besar' && p.porsi_sisa !== undefined) basePorsiBesar = p.porsi_sisa;
          if (p.name === 'Bubble Kecil' && p.porsi_sisa !== undefined) basePorsiKecil = p.porsi_sisa;
        });
      }

      let porsiBesarTambah = 0;
      let porsiKecilTambah = 0;

      let queryLogs = supabase
        .from('stock_restock_log')
        .select('item_name, qty_added')
        .eq('branch_name', branch)
        .in('item_name', ['Porsi Bubble Besar', 'Porsi Bubble Kecil']);

      if (lastRepTime) {
        queryLogs = queryLogs.gt('created_at', lastRepTime);
      }
      const { data: porsiLogs } = await queryLogs;

      if (porsiLogs) {
        porsiLogs.forEach(l => {
          if (l.item_name === 'Porsi Bubble Besar') porsiBesarTambah += l.qty_added;
          if (l.item_name === 'Porsi Bubble Kecil') porsiKecilTambah += l.qty_added;
        });
      }

      currentPorsiBesar = Math.max(0, basePorsiBesar + porsiBesarTambah);
      currentPorsiKecil = Math.max(0, basePorsiKecil + porsiKecilTambah);
    }

    invData.push({ id: 'porsi_bubble_besar', branch_name: branch, item_name: 'Porsi Bubble Besar', current_qty: currentPorsiBesar, isVirtual: true });
    invData.push({ id: 'porsi_bubble_kecil', branch_name: branch, item_name: 'Porsi Bubble Kecil', current_qty: currentPorsiKecil, isVirtual: true });

    orderMap['Porsi Bubble Besar'] = (orderMap['Bubble Besar'] ?? 0) + 0.1;
    orderMap['Porsi Bubble Kecil'] = (orderMap['Bubble Kecil'] ?? 0) + 0.1;

    // Sort inventory by display_order
    const sorted = invData.sort((a, b) => {
      const orderA = orderMap[a.item_name] ?? 999;
      const orderB = orderMap[b.item_name] ?? 999;
      if (orderA !== orderB) return orderA - orderB;
      return a.item_name.localeCompare(b.item_name);
    }).map(item => ({ ...item, pendingOut: pendingOutMap[item.item_name] || null }));

    setInventory(sorted);
    setLoading(false);
  };

  const fetchRestockLog = async (branch) => {
    // Only fetch logs for today (current shift)
    const todayStr = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];
    const { data } = await supabase
      .from('stock_restock_log')
      .select('*')
      .eq('branch_name', branch)
      .gte('created_at', `${todayStr}T00:00:00`)
      .order('created_at', { ascending: false })
      .limit(100);
    setRestockLog(data || []);
  };

  const handleActionSubmit = async (e) => {
    e.preventDefault();
    // Terima pecahan: "0.5", "1/2", "2 1/4" (buat bahan spt Diamond BC yg per kotak).
    const qty = parseQty(actionQty);
    if (isNaN(qty) || qty <= 0) return alert('Masukkan jumlah yang valid (boleh pecahan, mis. 0.5 atau 1/2)');

    const item = inventory.find(i => i.item_name === actionModal.item_name);
    const currentQty = item?.current_qty ?? 0;

    if (actionModal.type === 'deduct' || actionModal.type === 'transfer') {
      if (qty > currentQty) {
        return alert('Jumlah tidak boleh melebihi stok saat ini!');
      }
    }

    // Kurasi HANYA boleh memotong stok Display, bukan Gudang/Laci. Gudang harus dipindah
    // ke Display dulu kalau memang mau dibuang — biar angka Awal/Sisa staff & log akurat.
    if (actionModal.type === 'deduct' && !item?.isVirtual) {
      const displayStock = item?.display_qty ?? 0;
      if (qty > displayStock) {
        return alert(`Kurasi maksimal sebanyak stok Display saat ini (${displayStock} unit). Stok Gudang tidak bisa dikurasi langsung.`);
      }
    }

    if (actionModal.type === 'to_display') {
      const safetyStock = item?.safety_qty ?? 0; // safety_qty kolom independen, bukan turunan total-display
      if (qty > safetyStock) {
        return alert(`Jumlah tidak boleh melebihi Safety Stok saat ini (${safetyStock} unit)!`);
      }
    }

    if (actionModal.type === 'to_diamond') {
      const safetyStock = item?.safety_qty ?? 0;
      if (qty > safetyStock) return alert(`Jumlah tidak boleh melebihi Stok Gudang saat ini (${safetyStock} unit)!`);
      if (!inventory.some(i => i.item_name === DIAMOND)) return alert(`Item "${DIAMOND}" belum ada di cabang ini.`);
    }

    if (actionModal.type === 'to_safety') {
      const currentDisplayQty = item?.display_qty ?? 0;
      const displayStock = currentDisplayQty; // display = display_qty
      if (qty > displayStock) {
        return alert(`Jumlah tidak boleh melebihi Display Stok saat ini (${displayStock} unit)!`);
      }
    }

    if (actionModal.type === 'transfer') {
      if (!transferDest) return alert('Pilih cabang tujuan!');
      if (qty > currentQty) return alert(`Jumlah oper (${qty}) melebihi total stok (${currentQty}).`);
    }

    // Kurasi motong stok cabang sendiri, langsung eksekusi — gak perlu antri ACC
    // (dulu bikin pending_stock_actions nunggu di-ACC sendiri, sering ke-skip/bingung).
    if (actionModal.type === 'deduct') {
      if (!window.confirm(`Yakin ingin kurasi/buang ${qty} unit ${actionModal.item_name}? Stok akan langsung berkurang.`)) return;
    }

    setSaving(true);
    try {
      const actorName = petugasName || (userData?.name
        ? `${userData.name} (${userData.role || 'kasir'})`
        : 'Kasir');

      if (actionModal.type === 'add') {
        const newQty = currentQty + qty;

        if (!item?.isVirtual) {
          const { error: invErr } = await supabase.from('branch_inventory').upsert({
            branch_name: branchName,
            item_name: actionModal.item_name,
            current_qty: newQty
          }, { onConflict: 'branch_name,item_name' });
          if (invErr) throw invErr;
        }

        // Log the action
        const { error: logErr } = await supabase.from('stock_restock_log').insert([{
          branch_name: branchName,
          item_name: actionModal.item_name,
          qty_added: qty,
          qty_before: currentQty,
          qty_after: newQty,
          petugas_name: `${actorName}`
        }]);
        if (logErr) throw logErr;

        if (onPorsiTransfer && item?.isVirtual) {
          onPorsiTransfer(actionModal.item_name, qty);
        }

      } else if (actionModal.type === 'to_display') {
        // Mode 1: Pindah Ke Laci (Safety) ke Display.
        // safety_qty kolom independen (bukan turunan current_qty-display_qty) — harus
        // dikurangi eksplisit di sini, kalau ngga stok gudang ga pernah berkurang.
        // Total stok (current_qty) TIDAK berubah, cuma pindah internal.
        const newDisplayQty = (item?.display_qty ?? 0) + qty;
        const newSafetyQty = Math.max(0, (item?.safety_qty ?? 0) - qty);
        const { error: invErr } = await supabase.from('branch_inventory').upsert({
          branch_name: branchName,
          item_name: actionModal.item_name,
          current_qty: currentQty, // tidak berubah
          display_qty: newDisplayQty,
          safety_qty: newSafetyQty
        }, { onConflict: 'branch_name,item_name' });
        if (invErr) throw invErr;

        const { error: logErr } = await supabase.from('stock_restock_log').insert([{
          branch_name: branchName,
          item_name: actionModal.item_name,
          qty_added: -qty,
          qty_before: currentQty,
          qty_after: currentQty,
          petugas_name: `${actorName} (Pindah ke Display)`
        }]);
        if (logErr) throw logErr;

        if (onPorsiTransfer && item?.isVirtual) {
          onPorsiTransfer(actionModal.item_name, -qty);
        }

      } else if (actionModal.type === 'to_diamond') {
        // Ultra Milk jadi Diamond Besar: Gudang -> Gudang. Display tidak
        // disentuh, jadi Awal/Tambah/Sisa shift & rumus Full Cream tidak terdistorsi. Baca fresh.
        const rd = (n) => supabase.from('branch_inventory').select('current_qty, safety_qty')
          .eq('branch_name', branchName).eq('item_name', n).single();
        const [{ data: src }, { data: dst }] = await Promise.all([rd(actionModal.item_name), rd(DIAMOND)]);
        const srcSafety = src?.safety_qty ?? 0;
        if (qty > srcSafety) throw new Error(`Stok Gudang ${actionModal.item_name} tinggal ${srcSafety} unit`);
        const up = (n, cur, d) => supabase.from('branch_inventory').upsert({
          branch_name: branchName, item_name: n,
          current_qty: (cur?.current_qty ?? 0) + d, safety_qty: (cur?.safety_qty ?? 0) + d
        }, { onConflict: 'branch_name,item_name' });
        // Sisa 'ultra' di dalam stok Diamond: yang lama dibatasi total Diamond saat ini (Diamond asli dipakai duluan).
        const { data: lastMeta } = await supabase.from('stock_restock_log').select('qty_after')
          .eq('branch_name', branchName).eq('item_name', ULTRA_META).order('created_at', { ascending: false }).limit(1);
        const prevU = Math.min(Number(lastMeta?.[0]?.qty_after) || 0, dst?.current_qty ?? 0);
        const r1 = await up(actionModal.item_name, src, -qty);
        if (r1.error) throw r1.error;
        const r2 = await up(DIAMOND, dst, qty);
        if (r2.error) {
          await up(actionModal.item_name, src, 0); // rollback sumber
          throw r2.error;
        }
        const { error: logErr } = await supabase.from('stock_restock_log').insert([
          { branch_name: branchName, item_name: actionModal.item_name, qty_added: -qty, qty_before: src?.current_qty ?? 0, qty_after: (src?.current_qty ?? 0) - qty, petugas_name: `${actorName} (Jadi ${DIAMOND})` },
          { branch_name: branchName, item_name: DIAMOND, qty_added: qty, qty_before: dst?.current_qty ?? 0, qty_after: (dst?.current_qty ?? 0) + qty, petugas_name: `${actorName} (Dari ${actionModal.item_name})` },
          { branch_name: branchName, item_name: ULTRA_META, qty_added: qty, qty_before: prevU, qty_after: prevU + qty, petugas_name: `${actorName} (Ultra jadi Diamond)` },
        ]);
        if (logErr) throw logErr;

      } else if (actionModal.type === 'to_safety') {
        // Mode 2: Pindah Ke Laci (Safety). safety_qty kolom independen — harus ditambah
        // eksplisit di sini juga, simetris sama fix di 'to_display'.
        // Total stok (current_qty) TIDAK berubah.
        const newDisplayQty = Math.max(0, (item?.display_qty ?? 0) - qty);
        const newSafetyQty = (item?.safety_qty ?? 0) + qty;
        const { error: invErr } = await supabase.from('branch_inventory').upsert({
          branch_name: branchName,
          item_name: actionModal.item_name,
          current_qty: currentQty,
          display_qty: newDisplayQty,
          safety_qty: newSafetyQty
        }, { onConflict: 'branch_name,item_name' });
        if (invErr) throw invErr;

        const { error: logErr } = await supabase.from('stock_restock_log').insert([{
          branch_name: branchName,
          item_name: actionModal.item_name,
          qty_added: -qty, // negative untuk audit log
          qty_before: currentQty,
          qty_after: currentQty,
          petugas_name: `${actorName} (Pindah ke Laci)`
        }]);
        if (logErr) throw logErr;

        if (onPorsiTransfer && item?.isVirtual) {
          onPorsiTransfer(actionModal.item_name, qty);
        }

        alert(`Berhasil memindahkan ${qty} unit ${actionModal.item_name} kembali ke Stok (Safety Stok).`);

      } else if (actionModal.type === 'deduct') {
        // Kurasi HANYA memotong stok Display. Baca FRESH dari DB dulu (state client bisa basi
        // → numpuk kurasi ganda). current_qty & display_qty turun dengan jumlah SAMA = jumlah
        // nyata yang dibuang dari display; Gudang/safety_qty tidak disentuh.
        const { data: freshItem } = await supabase.from('branch_inventory')
          .select('current_qty, display_qty').eq('branch_name', branchName).eq('item_name', actionModal.item_name).single();
        const freshQty = freshItem?.current_qty ?? currentQty;
        const freshDisplay = freshItem?.display_qty ?? 0;
        if (!item?.isVirtual && qty > freshDisplay) {
          alert(`Kurasi maksimal sebanyak stok Display saat ini (${freshDisplay} unit). Stok Gudang tidak bisa dikurasi langsung — pindahkan ke Display dulu.`);
          setSaving(false);
          return;
        }
        const newQty = Math.max(0, freshQty - qty);
        const newDisplayQty = Math.max(0, freshDisplay - qty);

        if (!item?.isVirtual) {
          const { error: invErr } = await supabase.from('branch_inventory').upsert({
            branch_name: branchName,
            item_name: actionModal.item_name,
            current_qty: newQty,
            display_qty: newDisplayQty
          }, { onConflict: 'branch_name,item_name' });
          if (invErr) throw invErr;
        }

        // Log ditulis dalam satuan Display (yang benar-benar berkurang), bukan total.
        const { error: logErr } = await supabase.from('stock_restock_log').insert([{
          branch_name: branchName,
          item_name: actionModal.item_name,
          qty_added: -qty,
          qty_before: item?.isVirtual ? freshQty : freshDisplay,
          qty_after: item?.isVirtual ? Math.max(0, freshQty - qty) : newDisplayQty,
          petugas_name: `${actorName} (Kurasi/Buang)`
        }]);
        if (logErr) throw logErr;

        if (onPorsiTransfer && item?.isVirtual) {
          onPorsiTransfer(actionModal.item_name, -qty);
        }

      } else if (actionModal.type === 'transfer') {
        // Transfer logic - Deduct source immediately as "In Transit".
        // Ambil dari Display dulu, sisanya dari Gudang/Safety. current_qty ikut turun.
        const curDisplay = item?.display_qty ?? 0;
        const curSafety = item?.safety_qty ?? 0;
        const fromDisplay = Math.min(qty, curDisplay);
        const fromSafety = qty - fromDisplay;
        const newDisplay = curDisplay - fromDisplay;
        const newSafety = Math.max(0, curSafety - fromSafety);

        if (!item?.isVirtual) {
          const { error: invErr } = await supabase.from('branch_inventory').upsert({
            branch_name: branchName,
            item_name: actionModal.item_name,
            display_qty: newDisplay,
            safety_qty: newSafety,
            current_qty: newDisplay + newSafety
          }, { onConflict: 'branch_name,item_name' });
          if (invErr) throw invErr;
        }

        // 2. Insert to pending_stock_actions for destination
        const { error: pendingErr } = await supabase.from('pending_stock_actions').insert([{
          action_type: 'transfer',
          item_name: actionModal.item_name,
          qty: qty,
          source_branch: branchName,
          target_branch: transferDest,
          created_by: actorName,
          status: 'pending'
        }]);
        if (pendingErr) throw pendingErr;

        // 3. Log Source Branch (Keluar - Status Pending ACC)
        await supabase.from('stock_restock_log').insert([{
          branch_name: branchName,
          item_name: actionModal.item_name,
          qty_added: -qty,
          qty_before: currentQty,
          qty_after: newDisplay + newSafety,
          petugas_name: `${actorName} (Oper ke ${transferDest} - Pending ACC)`
        }]);

        if (onPorsiTransfer && item?.isVirtual) {
          onPorsiTransfer(actionModal.item_name, -qty);
        }

        alert(`Barang operan telah dikirim dan menunggu ACC dari ${transferDest}.`);
      }

      setActionModal(null);
      setActionQty('');
      setTransferDest('');
      await fetchInventory(branchName);
      await fetchRestockLog(branchName);
      // Kabari BranchPOS supaya refetch inventory — kurasi/pindah/tambah baru harus langsung
      // kebaca di form Tutup Shift, jangan sampai kurasi ke-anggap penjualan.
      if (onStockChange) onStockChange();
    } catch (err) {
      alert(`Gagal menyimpan aksi: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const getStockColor = (qty) => {
    if (qty === null || qty === undefined) return '#a1a1a6';
    if (qty === 0) return '#ff383c';
    if (qty <= 10) return '#ff9500';
    return 'var(--primary)';
  };

  const formatTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  const isManualAddition = (log) => {
    if (log.qty_added <= 0 || log.item_name === 'Status Aktivitas') return false;
    const name = (log.petugas_name || '').toLowerCase();
    // Exclude automatic system operations (tapi biarkan operan masuk terekam sebagai addition)
    return !name.includes('buka') && !name.includes('tutup') && !name.includes('shift');
  };

  // Recent additions (last 24h) — for notification banner
  const recentAdditions = restockLog.filter(log => {
    if (!isManualAddition(log)) return false;
    return new Date(log.created_at) > new Date(Date.now() - 24 * 60 * 60 * 1000);
  });

  const uniqueRecentItems = [...new Set(recentAdditions.map(l => l.item_name))];
  const uniqueRecentActors = [...new Set(recentAdditions.map(l => l.petugas_name))];

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 200
      }} />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: '100%', maxWidth: '420px',
        backgroundColor: 'var(--panel-bg)', zIndex: 201, display: 'flex', flexDirection: 'column',
        boxShadow: '-4px 0 30px rgba(0,0,0,0.15)', overflowY: 'auto'
      }}>
        {/* Header */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--panel-bg)', position: 'sticky', top: 0, zIndex: 10 }}>
          <div>
            <p style={{ fontWeight: 700, fontSize: '1rem' }}>Stok Inventaris</p>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{branchName}</p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button onClick={() => { fetchInventory(branchName); fetchRestockLog(branchName); fetchOutlets(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', padding: '0.3rem' }} title="Refresh">
              <Icon name="refresh" size={18} />
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.3rem' }}>
              <Icon name="close" size={22} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '2px solid var(--border-color)' }}>
          {[['stock', 'Stok Sekarang'], ['log', 'Riwayat Stok']]
            .map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)} style={{
                flex: 1, padding: '0.6rem', border: 'none', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
                backgroundColor: tab === key ? 'rgba(9, 108, 70, 0.08)' : 'transparent',
                color: tab === key ? 'var(--primary)' : 'var(--text-muted)',
                borderBottom: tab === key ? '2px solid var(--primary)' : '2px solid transparent',
                marginBottom: '-2px',
                position: 'relative'
              }}>
                {label}
                {key === 'log' && recentAdditions.length > 0 && (
                  <span style={{
                    position: 'absolute', top: '4px', right: '8px',
                    backgroundColor: 'var(--primary)', color: 'white',
                    borderRadius: '50%', width: '16px', height: '16px',
                    fontSize: '0.6rem', fontWeight: 900,
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>{recentAdditions.length}</span>
                )}
              </button>
            ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, padding: '0.75rem' }}>
          {loading ? (
            <p className="text-muted" style={{ textAlign: 'center', padding: '2rem', fontSize: '0.9rem' }}>Memuat...</p>
          ) : tab === 'stock' ? (
            <>
              {/* Notification Banner: Recent manual additions */}
              {recentAdditions.length > 0 && (
                <div style={{
                  backgroundColor: 'rgba(52, 199, 89,0.1)',
                  border: '1.5px solid rgba(52, 199, 89,0.45)',
                  borderRadius: '10px',
                  padding: '0.7rem 0.9rem',
                  marginBottom: '0.85rem',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.5rem'
                }}>
                  <span style={{ color: 'var(--primary)', display: 'inline-flex', lineHeight: 1 }}><Icon name="package" size={17} /></span>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: 800, fontSize: '0.82rem', color: 'var(--primary)', marginBottom: '0.15rem' }}>
                      Penambahan Stok Terbaru
                    </p>
                    <p style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginBottom: '0.25rem', lineHeight: '1.4' }}>
                      <strong>
                        {showFullRecent ? uniqueRecentItems.join(', ') : uniqueRecentItems.slice(0, 5).join(', ')}
                        {uniqueRecentItems.length > 5 && !showFullRecent ? '...' : ''}
                      </strong>
                      {uniqueRecentItems.length > 5 && (
                        <span
                          onClick={() => setShowFullRecent(!showFullRecent)}
                          style={{ color: 'var(--primary)', cursor: 'pointer', marginLeft: '4px', textDecoration: 'underline', fontWeight: 600 }}
                        >
                          {showFullRecent ? 'Sembunyikan' : 'Detail'}
                        </span>
                      )}
                      <br />
                      <span style={{ fontSize: '0.7rem' }}>Oleh: <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{uniqueRecentActors.join(', ')}</span></span>
                    </p>
                    <button
                      onClick={() => { setTab('log'); setLogFilter('addition'); }}
                      style={{ background: 'none', border: 'none', padding: 0, fontSize: '0.7rem', color: 'var(--primary)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
                    >
                      Lihat Riwayat Masuk →
                    </button>
                  </div>
                </div>
              )}

              {/* Mode Selector for Actions */}
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
                {[
                  { id: 'display', label: 'Ke Display', icon: 'arrow-right', color: '#34c759' },
                  { id: 'laci', label: 'Ke Stok', icon: 'arrow-left', color: '#af52de' },
                  { id: 'transfer', label: 'Oper', icon: 'refresh', color: '#0d6fff' },
                  { id: 'deduct', label: 'Kurasi', icon: 'alert-triangle', color: 'var(--danger)' },
                  ...(isGudangOrAdmin ? [{ id: 'add', label: 'Tambah', icon: 'package-plus', color: 'var(--primary)' }] : [])
                ].map(m => (
                  <button
                    key={m.id}
                    onClick={() => setStockMode(m.id)}
                    style={{
                      padding: '0.4rem 0.75rem',
                      borderRadius: '20px',
                      border: `1.5px solid ${stockMode === m.id ? m.color : 'var(--border-color)'}`,
                      backgroundColor: stockMode === m.id ? `${m.color}15` : 'transparent',
                      color: stockMode === m.id ? m.color : 'var(--text-muted)',
                      fontWeight: stockMode === m.id ? 700 : 500,
                      fontSize: '0.75rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <Icon name={m.icon} size={14} /> {m.label}
                  </button>
                ))}
              </div>

              {inventory.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                  <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Belum ada data stok</p>
                  <p className="text-muted" style={{ fontSize: '0.85rem' }}>Hubungi admin untuk set stok awal.</p>
                </div>
              ) : (
                inventory.map(item => {
                  const qty = item.current_qty;
                  const color = getStockColor(qty);
                  const isEmpty = qty === 0;
                  // Check if this item was recently added
                  const recentAdd = recentAdditions.find(l => l.item_name === item.item_name);
                  return (
                    <div key={item.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '0.6rem 0.5rem', marginBottom: '0.4rem', gap: '0.5rem',
                      border: `1px solid ${recentAdd ? 'rgba(52, 199, 89,0.4)' : isEmpty ? 'rgba(255, 56, 60,0.3)' : 'var(--border-color)'}`,
                      borderRadius: '8px',
                      backgroundColor: recentAdd ? 'rgba(52, 199, 89,0.04)' : isEmpty ? 'rgba(255, 56, 60,0.04)' : 'transparent'
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.15rem', flexWrap: 'wrap' }}>
                          <p style={{ fontWeight: 600, fontSize: '0.88rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {item.isVirtual ? '' : ''}{item.item_name}
                          </p>
                          {recentAdd && (
                            <span style={{ backgroundColor: 'rgba(52, 199, 89,0.15)', color: 'var(--primary)', padding: '0.05rem 0.35rem', borderRadius: '4px', fontSize: '0.62rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
                              +{recentAdd.qty_added} baru
                            </span>
                          )}
                          {item.pendingOut && item.pendingOut.map((p, pi) => (
                            <span key={pi} title={`Menunggu ACC dari ${p.target}`} style={{ backgroundColor: 'rgba(255, 149, 0,0.15)', color: '#c2410c', padding: '0.05rem 0.35rem', borderRadius: '4px', fontSize: '0.62rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
                              {p.qty} ke {p.target}
                            </span>
                          ))}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          {item.isVirtual ? (
                            <span style={{ fontSize: '0.72rem', color: '#34c759' }}>Siap Pakai</span>
                          ) : isEmpty ? (
                            <span style={{ fontSize: '0.72rem', color: '#ff383c', fontWeight: 700 }}>STOK HABIS</span>
                          ) : qty <= 10 ? (
                            <span style={{ fontSize: '0.72rem', color: '#ff9500', fontWeight: 700 }}>Stok Menipis</span>
                          ) : (
                            <span style={{ fontSize: '0.72rem', color: 'var(--primary)' }}>Tersedia</span>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem' }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Total Stok</span>
                          <span style={{ fontWeight: 800, fontSize: '0.95rem', color: color }}>
                            {qty ?? '?'}
                          </span>
                        </div>

                        {!item.isVirtual && (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem', paddingLeft: '0.5rem', borderLeft: '1px solid var(--border-color)' }}>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Safety Stok</span>
                            <span style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-color)' }}>
                              {item.safety_qty ?? 0}
                            </span>
                          </div>
                        )}

                        <>
                          <div style={{ display: 'flex', gap: '0.3rem' }}>
                            {/* Transfer Mode */}
                            {stockMode === 'transfer' && (
                              <button
                                onClick={() => { setActionModal({ type: 'transfer', ...item }); setActionQty(''); setTransferDest(''); }}
                                disabled={isEmpty}
                                title="Oper Stok ke Cabang Lain"
                                style={{
                                  padding: '0.4rem 0.6rem', border: '1.5px solid #0d6fff', borderRadius: '6px',
                                  backgroundColor: isEmpty ? '#f2f2f7' : 'rgba(13, 111, 255, 0.08)',
                                  color: isEmpty ? '#8e8e93' : '#0d6fff',
                                  cursor: isEmpty ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 700
                                }}
                              >
                                <Icon name="refresh" size={14} /> <span className="hide-on-mobile">Oper</span>
                              </button>
                            )}

                            {/* Deduct Mode */}
                            {stockMode === 'deduct' && (
                              <button
                                onClick={() => { setActionModal({ type: 'deduct', ...item }); setActionQty(''); }}
                                disabled={isEmpty}
                                title="Kurasi/Kurangi Stok"
                                style={{
                                  padding: '0.4rem 0.6rem', border: '1.5px solid var(--danger)', borderRadius: '6px',
                                  backgroundColor: isEmpty ? '#f2f2f7' : 'rgba(255, 56, 60, 0.08)',
                                  color: isEmpty ? '#8e8e93' : 'var(--danger)',
                                  cursor: isEmpty ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 700
                                }}
                              >
                                <Icon name="alert-triangle" size={14} /> <span className="hide-on-mobile">Kurasi</span>
                              </button>
                            )}

                            {/* Add Mode */}
                            {stockMode === 'add' && isGudangOrAdmin && (
                              <button
                                onClick={() => { setActionModal({ type: 'add', ...item }); setActionQty(''); }}
                                title="Tambah Stok"
                                style={{
                                  padding: '0.4rem 0.6rem', border: '1.5px solid var(--primary)', borderRadius: '6px',
                                  backgroundColor: 'rgba(9, 108, 70, 0.08)',
                                  color: 'var(--primary)',
                                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 700
                                }}
                              >
                                <Icon name="package-plus" size={14} /> <span className="hide-on-mobile">Tambah</span>
                              </button>
                            )}

                            {/* Display Mode */}
                            {stockMode === 'display' && (
                              <button
                                onClick={() => { setActionModal({ type: 'to_display', ...item }); setActionQty(''); }}
                                disabled={isEmpty || (item.safety_qty ?? 0) <= 0}
                                title={(item.safety_qty ?? 0) <= 0 ? "Safety Stok Kosong" : "Pindah ke Display"}
                                style={{
                                  padding: '0.4rem 0.6rem', border: '1.5px solid #34c759', borderRadius: '6px',
                                  backgroundColor: isEmpty ? '#f2f2f7' : 'rgba(52, 199, 89, 0.08)',
                                  color: isEmpty ? '#8e8e93' : '#34c759',
                                  cursor: isEmpty ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 700
                                }}
                              >
                                <Icon name="arrow-right" size={14} /> <span className="hide-on-mobile">Display</span>
                              </button>
                            )}

                            {stockMode === 'display' && item.item_name === ULTRA_SRC && (
                              <button
                                onClick={() => { setActionModal({ type: 'to_diamond', ...item }); setActionQty(''); }}
                                disabled={(item.safety_qty ?? 0) <= 0}
                                title="Jadikan Diamond Besar (5 porsi/kotak)"
                                style={{
                                  padding: '0.4rem 0.6rem', border: '1.5px solid #ff9500', borderRadius: '6px',
                                  backgroundColor: 'rgba(255, 149, 0, 0.08)', color: '#ff9500',
                                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 700
                                }}
                              >
                                <Icon name="arrow-right" size={14} /> <span className="hide-on-mobile">Jadi Diamond</span>
                              </button>
                            )}

                            {/* Laci Mode */}
                            {stockMode === 'laci' && !item.isVirtual && (
                              <button
                                onClick={() => { setActionModal({ type: 'to_safety', ...item }); setActionQty(''); }}
                                disabled={isEmpty || (item.display_qty ?? 0) <= 0}
                                title={(item.display_qty ?? 0) <= 0 ? "Display Stok Kosong" : "Pindah ke Stok"}
                                style={{
                                  padding: '0.4rem 0.6rem', border: '1.5px solid #af52de', borderRadius: '6px',
                                  backgroundColor: isEmpty ? '#f2f2f7' : 'rgba(175, 82, 222, 0.08)',
                                  color: isEmpty ? '#8e8e93' : '#af52de',
                                  cursor: isEmpty ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 700
                                }}
                              >
                                <Icon name="arrow-left" size={14} /> <span className="hide-on-mobile">Stok</span>
                              </button>
                            )}
                          </div>
                        </>
                      </div>
                    </div>
                  );
                })
              )}
              {/* Tambahkan CSS kecil untuk menyembunyikan tulisan 'Tambah' di HP yang layarnya kecil sekali */}
              <style>{`
                @media (max-width: 380px) {
                  .hide-on-mobile { display: none; }
                }
              `}</style>
            </>
          ) : (
            // Riwayat Stok tab
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {/* Filter Tabs Mini */}
              <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.75rem', overflowX: 'auto', paddingBottom: '0.4rem' }}>
                {[
                  { id: 'all', label: 'Semua', color: 'var(--text-muted)' },
                  { id: 'addition', label: 'Masuk', color: '#34c759' },
                  { id: 'status', label: 'Aktivitas', color: '#0d6fff' },
                  { id: 'deduction', label: 'Keluar', color: 'var(--danger)' },
                  { id: 'transfer', label: 'Operan', color: '#9c33c0' },
                  { id: 'display', label: 'Display', color: '#ff9500' },
                  { id: 'laci', label: 'Stok', color: '#af52de' }
                ].map(f => (
                  <button
                    key={f.id}
                    onClick={() => setLogFilter(f.id)}
                    style={{
                      padding: '0.3rem 0.6rem',
                      borderRadius: '12px',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      border: '1px solid',
                      backgroundColor: logFilter === f.id ? f.color : 'transparent',
                      borderColor: logFilter === f.id ? f.color : 'var(--border-color)',
                      color: logFilter === f.id ? 'white' : 'var(--text-muted)',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {f.label}
                    {f.id === 'addition' && recentAdditions.length > 0 && (
                      <span style={{ marginLeft: '4px', backgroundColor: 'white', color: 'var(--primary)', borderRadius: '50%', padding: '0 4px', fontSize: '0.65rem', fontWeight: 900 }}>
                        {recentAdditions.length}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <div style={{ flex: 1 }}>
                {(() => {
                  const filtered = restockLog.filter(log => {
                    const isDisplayLog = (log.petugas_name || '').toLowerCase().includes('pindah ke display');
                    const isLaciLog = (log.petugas_name || '').toLowerCase().includes('pindah ke laci');
                    if (logFilter === 'status') return log.item_name === 'Status Aktivitas';
                    if (logFilter === 'deduction') return log.qty_added < 0 && log.item_name !== 'Status Aktivitas' && !isDisplayLog && !isLaciLog;
                    if (logFilter === 'addition') return log.qty_added > 0 && log.item_name !== 'Status Aktivitas';
                    if (logFilter === 'transfer') return (log.petugas_name || '').toLowerCase().includes('oper');
                    if (logFilter === 'display') return isDisplayLog;
                    if (logFilter === 'laci') return isLaciLog;
                    return true;
                  });

                  if (filtered.length === 0) {
                    return <p className="text-muted" style={{ textAlign: 'center', padding: '2rem', fontSize: '0.85rem' }}>Tidak ada riwayat untuk kategori ini.</p>;
                  }

                  return filtered.map(log => {
                    const isAddition = log.qty_added > 0;
                    const isStatus = log.item_name === 'Status Aktivitas';
                    const isManualAdd = isManualAddition(log);
                    const isOpening = (log.petugas_name || '').toLowerCase().includes('buka');
                    const isClosing = (log.petugas_name || '').toLowerCase().includes('tutup');
                    const isTransferOut = (log.petugas_name || '').toLowerCase().includes('oper ke');
                    const isDisplay = (log.petugas_name || '').toLowerCase().includes('pindah ke display');
                    const isLaci = (log.petugas_name || '').toLowerCase().includes('pindah ke laci');

                    return (
                      <div key={log.id} style={{
                        borderBottom: '1px solid var(--border-color)',
                        padding: '0.75rem 0.25rem',
                        backgroundColor: isManualAdd
                          ? 'rgba(52, 199, 89,0.05)'
                          : isStatus ? 'rgba(13, 111, 255, 0.02)'
                            : isTransferOut ? 'rgba(13, 111, 255, 0.05)' 
                            : isDisplay ? 'rgba(255, 149, 0, 0.05)' 
                            : isLaci ? 'rgba(175, 82, 222, 0.05)' : 'transparent',
                        borderLeft: isManualAdd ? '3px solid var(--primary)' : isTransferOut ? '3px solid #0d6fff' : isDisplay ? '3px solid #ff9500' : isLaci ? '3px solid #af52de' : '3px solid transparent'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ flex: 1 }}>
                            <p style={{ fontWeight: 700, fontSize: '0.85rem', color: isStatus ? '#0d6fff' : 'inherit' }}>
                              {isStatus ? '' + log.item_name : log.item_name}
                            </p>
                            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                              {formatTime(log.created_at)}
                            </p>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.2rem', flexWrap: 'wrap' }}>
                              {isManualAdd && (
                                <span style={{
                                  backgroundColor: 'rgba(52, 199, 89,0.15)', color: 'var(--primary)',
                                  padding: '0.05rem 0.4rem', borderRadius: '4px',
                                  fontSize: '0.65rem', fontWeight: 800
                                }}>MASUK</span>
                              )}
                              {isTransferOut && (
                                <span style={{
                                  backgroundColor: 'rgba(13, 111, 255, 0.15)', color: '#0d6fff',
                                  padding: '0.05rem 0.4rem', borderRadius: '4px',
                                  fontSize: '0.65rem', fontWeight: 800
                                }}>OPER</span>
                              )}
                              {isDisplay && (
                                <span style={{
                                  backgroundColor: 'rgba(255, 149, 0, 0.15)', color: '#ff9500',
                                  padding: '0.05rem 0.4rem', borderRadius: '4px',
                                  fontSize: '0.65rem', fontWeight: 800
                                }}>DISPLAY</span>
                              )}
                              {isLaci && (
                                <span style={{
                                  backgroundColor: 'rgba(175, 82, 222, 0.15)', color: '#af52de',
                                  padding: '0.05rem 0.4rem', borderRadius: '4px',
                                  fontSize: '0.65rem', fontWeight: 800
                                }}>STOK</span>
                              )}
                              {isOpening && <span style={{ color: '#9a3412', display: 'inline-flex' }}><Icon name="unlock" size={12} /></span>}
                              {isClosing && <span style={{ color: 'var(--danger)', display: 'inline-flex' }}><Icon name="lock" size={12} /></span>}
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                                {log.petugas_name}
                              </span>
                            </div>
                            {!isStatus && (
                              <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                                Stok: {log.qty_before} → <strong style={{ color: isAddition ? 'var(--primary)' : 'var(--danger)' }}>{log.qty_after}</strong>
                              </p>
                            )}
                          </div>
                          {!isStatus && (
                            <span style={{
                              fontWeight: 800,
                              backgroundColor: isAddition ? 'rgba(52, 199, 89,0.1)' : isDisplay ? 'rgba(255, 149, 0, 0.1)' : isLaci ? 'rgba(175, 82, 222, 0.1)' : 'rgba(255, 56, 60,0.1)',
                              color: isAddition ? 'var(--primary)' : isDisplay ? '#ff9500' : isLaci ? '#af52de' : 'var(--danger)',
                              padding: '0.1rem 0.4rem',
                              borderRadius: '4px',
                              fontSize: '0.85rem'
                            }}>
                              {isAddition ? '+' : ''}{log.qty_added}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}
        </div>

        {/* Action Modal (Tambah/Kurasi/Oper) — di-portal ke document.body biar gak ke-clip
            sama overflowY:'auto' punya panel drawer di atas. */}
        {actionModal && createPortal(
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
            <div style={{ backgroundColor: 'var(--panel-bg)', borderRadius: '12px', padding: '1.5rem', width: '100%', maxWidth: '340px', maxHeight: '90vh', overflowY: 'auto' }}>
              <h3 style={{ marginBottom: '0.25rem' }}>
                {actionModal.type === 'add' ? 'Tambah Stok' : actionModal.type === 'deduct' ? 'Kurasi Stok' : actionModal.type === 'to_display' ? 'Pindah ke Display' : actionModal.type === 'to_safety' ? 'Pindah ke Stok' : actionModal.type === 'to_diamond' ? 'Jadikan Diamond Besar' : 'Oper Stok'}
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                <strong>{actionModal.item_name}</strong><br />
                {actionModal.type === 'to_display' || actionModal.type === 'to_diamond' ? (
                  <>
                    Safety Stok saat ini: <strong>{actionModal.safety_qty ?? 0}</strong> unit<br />
                    Total Stok: <strong>{actionModal.current_qty ?? 0}</strong> unit
                  </>
                ) : actionModal.type === 'to_safety' ? (
                  <>
                    Display Stok saat ini: <strong>{actionModal.display_qty ?? 0}</strong> unit<br />
                    Total Stok: <strong>{actionModal.current_qty ?? 0}</strong> unit
                  </>
                ) : (
                  <>Stok saat ini: <strong>{actionModal.current_qty ?? 0}</strong> unit</>
                )}
              </p>
              <form onSubmit={handleActionSubmit}>
                {actionModal.type === 'transfer' && (
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>
                      Cabang Tujuan
                    </label>
                    <select
                      value={transferDest}
                      onChange={e => setTransferDest(e.target.value)}
                      required
                      style={{ width: '100%', padding: '0.75rem', border: '2px solid var(--border-color)', borderRadius: '8px', fontSize: '0.95rem', fontWeight: 600, backgroundColor: 'var(--bg-color)', color: 'var(--text-color)' }}
                    >
                      <option value="" disabled>Pilih cabang tujuan...</option>
                      {outlets.map(o => (
                        <option key={o.name} value={o.name}>{o.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>
                  Jumlah yang {actionModal.type === 'add' ? 'ditambahkan' : actionModal.type === 'deduct' ? 'dikurangi' : actionModal.type === 'to_display' ? 'dipindah ke display' : actionModal.type === 'to_diamond' ? 'dijadikan Diamond Besar' : 'dioper'}
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  autoFocus
                  style={{ width: '100%', padding: '0.75rem', border: '2px solid var(--border-color)', borderRadius: '8px', fontSize: '1.2rem', textAlign: 'center', fontWeight: 700, marginBottom: '0.5rem', backgroundColor: 'var(--bg-color)', color: 'var(--text-color)' }}
                  placeholder="0  (boleh 0.5 / 1/2 / 2 1/4)"
                  value={actionQty}
                  onChange={e => setActionQty(e.target.value)}
                />
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center', margin: '0 0 0.8rem' }}>Boleh pecahan: <code>0.5</code>, <code>1/2</code>, <code>2 1/4</code></p>
                {(() => {
                  const q = parseQty(actionQty); const qn = isNaN(q) ? 0 : q;
                  const curD = actionModal.display_qty ?? 0, curS = actionModal.safety_qty ?? 0, curT = actionModal.current_qty ?? 0;
                  const box = { fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem', textAlign: 'center', lineHeight: 1.7 };
                  if (actionModal.type === 'to_display') return (
                    <div style={box}>
                      <p style={{ margin: 0 }}>Display setelah dipindah: <strong style={{ color: 'var(--primary)' }}>{formatFraction(curD + qn)} unit</strong></p>
                      <p style={{ margin: 0 }}>Stok Gudang setelah dipindah: <strong style={{ color: 'var(--danger)' }}>{formatFraction(Math.max(0, curS - qn))} unit</strong></p>
                      <p style={{ margin: 0 }}>Total (tidak berubah): <strong>{formatFraction(curT)} unit</strong></p>
                    </div>
                  );
                  if (actionModal.type === 'to_diamond') return (
                    <div style={box}>
                      <p style={{ margin: 0 }}>Stok Gudang {actionModal.item_name} setelah: <strong style={{ color: 'var(--danger)' }}>{formatFraction(Math.max(0, curS - qn))} unit</strong></p>
                      <p style={{ margin: 0 }}>Stok Gudang {DIAMOND} bertambah (5 porsi/kotak): <strong style={{ color: 'var(--primary)' }}>+{formatFraction(qn)} unit</strong></p>
                    </div>
                  );
                  if (actionModal.type === 'to_safety') return (
                    <div style={box}>
                      <p style={{ margin: 0 }}>Display setelah dipindah: <strong style={{ color: 'var(--danger)' }}>{formatFraction(Math.max(0, curD - qn))} unit</strong></p>
                      <p style={{ margin: 0 }}>Stok Gudang setelah dipindah: <strong style={{ color: 'var(--primary)' }}>{formatFraction(curS + qn)} unit</strong></p>
                      <p style={{ margin: 0 }}>Total (tidak berubah): <strong>{formatFraction(curT)} unit</strong></p>
                    </div>
                  );
                  if (actionModal.type === 'add') return (
                    <p style={box}>Setelah ditambah: <strong style={{ color: 'var(--primary)' }}>{formatFraction(curT + qn)} unit</strong></p>
                  );
                  // deduct (kurasi) / transfer (oper): ambil dari Display dulu, sisanya Gudang
                  const fromD = Math.min(qn, curD), fromS = qn - fromD;
                  return (
                    <div style={box}>
                      <p style={{ margin: 0 }}>Display setelah {actionModal.type === 'deduct' ? 'dikurasi' : 'dioper'}: <strong style={{ color: 'var(--danger)' }}>{formatFraction(curD - fromD)} unit</strong>{fromS > 0 && <span> (−{formatFraction(fromD)} dari display)</span>}</p>
                      {fromS > 0 && <p style={{ margin: 0 }}>Stok Gudang setelah: <strong style={{ color: 'var(--danger)' }}>{formatFraction(Math.max(0, curS - fromS))} unit</strong> (−{formatFraction(fromS)})</p>}
                      <p style={{ margin: 0 }}>Total setelah: <strong style={{ color: 'var(--danger)' }}>{formatFraction(Math.max(0, curT - qn))} unit</strong></p>
                    </div>
                  );
                })()}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" onClick={() => setActionModal(null)} style={{ flex: 1, padding: '0.7rem', border: '1px solid var(--border-color)', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--text-color)' }}>Batal</button>
                  <button type="submit" disabled={saving} style={{ flex: 2, padding: '0.7rem', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer', backgroundColor: actionModal.type === 'add' ? 'var(--primary)' : actionModal.type === 'deduct' ? 'var(--danger)' : actionModal.type === 'to_display' ? '#34c759' : '#0d6fff', color: 'white' }}>
                    {saving ? 'Menyimpan...' : 'Simpan'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
      </div>
    </>
  );
}

