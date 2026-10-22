import { supabase } from '../supabase';
import { exportShiftToExcel } from './exportExcel';
import { getStockKey } from './stockUtils';

/**
 * Unduh ulang Excel laporan shift yang sudah ditutup (Laporan + Kartu Stok), persis
 * seperti tombol unduh di Riwayat Penjualan. Dipakai juga setelah koreksi laporan
 * (mis. Pindah Tambah kiriman ke Shift 2) biar form terbaru langsung keunduh.
 * salesRecord: daftar laporan yang sudah di-load (opsional, buat cari Shift 1).
 */
export const downloadShiftReport = async (record, salesRecord = []) => {
  try {
    // 1. Fetch all necessary master data from Supabase
    const { data: allProducts, error: errProd } = await supabase.from('products').select('*').order('category').order('display_order', { ascending: true, nullsFirst: false }).order('name');
    if (errProd) throw errProd;

    const { data: opItems, error: errOp } = await supabase.from('operational_items').select('*');
    if (errOp) throw errOp;

    // 2. Build Inventory Map — Prioritaskan snapshot dari laporan tersimpan
    const snapshotEntry = (record.details || []).find(d => d._is_inventory_snapshot);
    let fullInventoryMap = {};

    if (snapshotEntry && snapshotEntry.inventory_map) {
      // Gunakan snapshot inventory yang direkam saat shift di-akhiri
      fullInventoryMap = { ...snapshotEntry.inventory_map };
    } else {
      // Fallback: laporan lama yang belum punya snapshot → ambil data live
      const { data: invData, error: errInv } = await supabase.from('branch_inventory').select('*').eq('branch_name', record.branch_name);
      if (errInv) throw errInv;
      (invData || []).forEach(row => {
        fullInventoryMap[row.item_name] = row.current_qty;
      });
    }

    // 2.5 Tambal display_awal yang ilang (laporan lama, kena bug reload sebelum fix).
    // Cuma aman dipakai kalau laporan ini masih laporan TERBARU cabang itu — belum ada
    // shift/laporan lain sesudahnya yang nulis ulang display_qty. Kalau udah ada shift
    // berikutnya yang closed, display_qty sekarang udah bukan representasi shift ini lagi.
    const { count: newerCount } = await supabase.from('sales_reports')
      .select('id', { count: 'exact', head: true })
      .eq('branch_name', record.branch_name)
      .gt('id', record.id);
    const isFreshestReport = (newerCount || 0) === 0;

    let liveDisplayMap = {};
    if (isFreshestReport) {
      const { data: liveInv } = await supabase.from('branch_inventory').select('item_name, display_qty').eq('branch_name', record.branch_name);
      (liveInv || []).forEach(row => { liveDisplayMap[row.item_name] = row.display_qty; });
    }

    // 3. Map details to easily find sold items
    const detailsMap = {};
    const actualDetails = (record.details || []).filter(d => !d._is_meta && !d._is_inventory_snapshot);
    actualDetails.forEach(d => {
      const key = d.variant && d.variant !== 'Standar' ? `${d.name} ${d.variant}` : d.name;
      detailsMap[key] = { ...d, processed: false };
    });

    // 3.5 Ambil shift1Report & data log (stock_restock_log) agar sinkron 100% dengan hasil Tutup Shift di cabang
    let shift1Report = null;
    if (String(record.shift) === '2') {
      shift1Report = salesRecord.find(r => r.branch_name === record.branch_name && r.date === record.date && String(r.shift) === '1');
      if (!shift1Report) {
        const { data: s1Rep } = await supabase.from('sales_reports').select('*').eq('branch_name', record.branch_name).eq('date', record.date).eq('shift', '1').order('id', { ascending: false }).limit(1);
        if (s1Rep && s1Rep[0]) shift1Report = s1Rep[0];
      }
    }

    const startOfDay = new Date(`${record.date}T00:00:00`).toISOString();
    const endOfDay = new Date(`${record.date}T23:59:59`).toISOString();
    const { data: rawShiftLogs } = await supabase
      .from('stock_restock_log')
      .select('item_name, qty_added, created_at, petugas_name')
      .eq('branch_name', record.branch_name)
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay)
      .not('petugas_name', 'ilike', '%Auto-Deduct%');

    const { data: closeLogs } = await supabase.from('stock_restock_log').select('created_at')
      .eq('branch_name', record.branch_name).eq('item_name', 'Status Aktivitas')
      .ilike('petugas_name', '%Tutup Shift%').order('created_at', { ascending: false }).limit(1);
    const lastRepTime = (closeLogs && closeLogs.length > 0) ? new Date(closeLogs[0].created_at).getTime() : 0;

    const repTime = record.created_at ? new Date(record.created_at).getTime() : Infinity;
    const s1Time = shift1Report && shift1Report.created_at ? new Date(shift1Report.created_at).getTime() : 0;

    const shiftLogs = (rawShiftLogs || []).filter(log => {
      const t = new Date(log.created_at).getTime();
      if (String(record.shift) === '1') {
        return t > lastRepTime && t <= repTime;
      } else if (String(record.shift) === '2') {
        const afterTime = s1Time > 0 ? s1Time : lastRepTime;
        return t > afterTime && t <= repTime;
      }
      return true;
    });

    // Re-export laporan lama: filter shiftLogs di atas dibatasi "setelah Tutup Shift terakhir",
    // jadi log Pindah ke Display dari hari itu ke-skip. Rekonstruksi dari details.pindah_display
    // yang tersimpan di laporan biar hijau tetap muncul di Kartu Stok.
    const hasPindahLog = shiftLogs.some(l => (l.petugas_name || '').includes('(Pindah ke Display)') || (l.petugas_name || '').includes('[PERBAIKI]'));
    if (!hasPindahLog) {
      (record.details || []).forEach(d => {
        if (d._is_meta || d._is_inventory_snapshot || d._is_preclose_snapshot) return;
        const pd = Number(d.pindah_display) || 0;
        if (pd > 0) {
          const k = d.variant && d.variant !== 'Standar' ? `${d.name} ${d.variant}` : d.name;
          shiftLogs.push({ item_name: k, qty_added: -pd, created_at: `${record.date}T06:00:00Z`, petugas_name: 'Sistem (Pindah ke Display)' });
        }
      });
    }

    const realTambahMap = {};
    const realTambahSafetyMap = {};
    const allItemsForLog = [
      ...(allProducts || []),
      ...(opItems || []),
      ...actualDetails
    ];

    allItemsForLog.forEach(prod => {
      const key = prod.variant && prod.variant !== 'Standar' ? `${prod.name} ${prod.variant}` : prod.name;
      const stockKey = getStockKey(prod);

      let displayAdded = 0;
      let safetyAdded = 0;

      if (shiftLogs) {
        shiftLogs.forEach(log => {
          if (log.item_name === stockKey || log.item_name === key) {
            const pet = log.petugas_name || '';
            if (pet.includes('(Set Manual)')) return;
            const isGudangTag = pet.includes('[GUDANG]');
            const isDisplayTag = pet.includes('[DISPLAY]');
            const isLegacyAdmin = !isDisplayTag && !isGudangTag && (pet.toLowerCase().includes('admin') || pet.toLowerCase().includes('mode restock') || pet.toLowerCase().includes('restock ops'));
            const isAdminRestock = isGudangTag || isLegacyAdmin;
            
            // Pindah ke Display / Laci JANGAN dimasukkan ke realTambahMap (kolom "Tambah").
            // Pindah dilacak terpisah lewat pindah_display (kolom Tambah HIJAU di Kartu Stok).
            // Kalau dihitung dua kali di sini -> Awal/Tambah "kegeser" (mis. Cup Flat 65->165).
            if (log.qty_added < 0 && (pet.includes('(Pindah ke Display)') || pet.includes('(Pindah ke Laci)'))) {
              // skip
            } else if (log.qty_added > 0) {
              if (isAdminRestock || pet.includes('Operan dari') || pet.includes('Terima')) {
                safetyAdded += log.qty_added;
              } else if (isDisplayTag) {
                // HANYA yang bertag [DISPLAY] (kiriman ke display / Penambahan Display) yang
                // masuk kolom "Tambah". Seeding Cabang / (Koreksi) [AWAL] / Set Manual dsb =
                // stok pembuka atau koreksi, BUKAN tambahan shift ini — jangan dihitung
                // (dulu bikin Tutup Manual dll nongol "+100" di Tambah).
                displayAdded += log.qty_added;
              }
            }
          }
        });
      }
      
      realTambahMap[key] = displayAdded;
      realTambahSafetyMap[key] = safetyAdded;
      realTambahMap[prod.name] = displayAdded;
      realTambahSafetyMap[prod.name] = safetyAdded;
    });

    // 4. Merge with master products to show ALL items exactly as recorded when shift closed
    const fullProducts = (allProducts || []).filter(p => p.category !== 'Bahan').map(p => {
      const variant = p.variant || 'Standar';
      const key = variant !== 'Standar' ? `${p.name} ${variant}` : p.name;
      const soldDetail = detailsMap[key];
      if (soldDetail) soldDetail.processed = true;
      
      return {
        ...p,
        ...(soldDetail || {}),
        name: p.name,
        variant: variant,
        category: p.category,
        display_order: p.display_order,
        qty: soldDetail ? (soldDetail.qty !== undefined && soldDetail.qty !== '' ? soldDetail.qty : (soldDetail.name?.toLowerCase().includes('bubble') ? (soldDetail.porsi_terpakai || 0) : 0)) : 0,
        price: soldDetail ? (soldDetail.price || p.price) : p.price,
        terjual_pure: soldDetail ? (soldDetail.terjual_pure !== undefined ? soldDetail.terjual_pure : (soldDetail.qty || 0)) : 0,
        terjual_fisik: soldDetail ? (soldDetail.terjual_fisik !== undefined ? soldDetail.terjual_fisik : (soldDetail.total_fisik || 0)) : 0,
        sisa_input: soldDetail ? (soldDetail.sisa_input !== undefined ? soldDetail.sisa_input : (soldDetail.sisa !== undefined ? soldDetail.sisa : null)) : null,
        tambah: (realTambahMap[key] !== undefined && realTambahMap[key] !== 0) ? realTambahMap[key] : (soldDetail ? (soldDetail.tambah !== undefined ? soldDetail.tambah : (soldDetail.added_qty || 0)) : 0),
        display_awal: soldDetail?.display_awal ?? (isFreshestReport ? liveDisplayMap[getStockKey(p)] : undefined),
        tambah_safety: (realTambahSafetyMap[key] !== undefined && realTambahSafetyMap[key] !== 0) ? realTambahSafetyMap[key] : (soldDetail ? (soldDetail.tambah_safety || 0) : 0),
        safety_remaining: soldDetail ? soldDetail.safety_remaining : undefined,
        safety_qty: soldDetail ? (soldDetail.safety_qty || 0) : 0,
        porsi_terpakai: soldDetail ? (soldDetail.porsi_terpakai || 0) : 0,
        porsi_rusak: soldDetail ? (soldDetail.porsi_rusak || 0) : 0,
        porsi_sisa: soldDetail ? (soldDetail.porsi_sisa || 0) : 0
      };
    });

    // Inject operational_items as 'Bahan' FSO
    (opItems || []).forEach(op => {
       const d = detailsMap[op.name];
       if (d) d.processed = true;
       fullProducts.push({
          ...op,
          ...(d || {}),
          name: op.name,
          variant: 'Standar',
          category: 'Bahan',
          display_order: op.display_order,
          price: 0,
          qty: d ? (d.sisa_input !== undefined ? d.sisa_input : (d.sisa || 0)) : 0, 
          sisa_input: d ? (d.sisa_input !== undefined ? d.sisa_input : (d.sisa !== undefined ? d.sisa : null)) : null,
          tambah: (realTambahMap[op.name] !== undefined && realTambahMap[op.name] !== 0) ? realTambahMap[op.name] : (d ? (d.tambah !== undefined ? d.tambah : (d.added_qty || 0)) : 0),
          terjual_fisik: d ? (d.terjual_fisik !== undefined ? d.terjual_fisik : (d.total_fisik || 0)) : 0,
          terjual_pure: d ? (d.terjual_pure !== undefined ? d.terjual_pure : (d.qty || 0)) : 0,
          display_awal: d?.display_awal ?? (isFreshestReport ? liveDisplayMap[getStockKey(op)] : undefined),
          tambah_safety: (realTambahSafetyMap[op.name] !== undefined && realTambahSafetyMap[op.name] !== 0) ? realTambahSafetyMap[op.name] : (d ? (d.tambah_safety || 0) : 0),
          safety_remaining: d ? d.safety_remaining : undefined,
          safety_qty: d ? (d.safety_qty || 0) : 0,
          porsi_terpakai: d ? (d.porsi_terpakai || 0) : 0,
          porsi_rusak: d ? (d.porsi_rusak || 0) : 0,
          porsi_sisa: d ? (d.porsi_sisa || 0) : 0
       });
    });

    // Add any sold items that were deleted from master products
    actualDetails.forEach(d => {
      const key = d.variant && d.variant !== 'Standar' ? `${d.name} ${d.variant}` : d.name;
      if (detailsMap[key] && !detailsMap[key].processed) {
        fullProducts.push({
          ...d,
          name: d.name,
          variant: d.variant || 'Standar',
          price: d.price || 0,
          qty: d.qty !== undefined && d.qty !== '' ? d.qty : (d.name?.toLowerCase().includes('bubble') ? (d.porsi_terpakai || 0) : 0),
          category: d.category || 'Lainnya',
          terjual_pure: d.terjual_pure !== undefined ? d.terjual_pure : (d.qty || 0),
          terjual_fisik: d.terjual_fisik !== undefined ? d.terjual_fisik : (d.total_fisik || 0),
          sisa_input: d.sisa_input !== undefined ? d.sisa_input : (d.sisa !== undefined ? d.sisa : null),
          tambah: (realTambahMap[key] !== undefined && realTambahMap[key] !== 0) ? realTambahMap[key] : (d.tambah !== undefined ? d.tambah : (d.added_qty || 0)),
          display_awal: d.display_awal ?? (isFreshestReport ? liveDisplayMap[getStockKey(d)] : undefined),
          tambah_safety: (realTambahSafetyMap[key] !== undefined && realTambahSafetyMap[key] !== 0) ? realTambahSafetyMap[key] : (d.tambah_safety || 0),
          safety_remaining: d.safety_remaining,
          safety_qty: d.safety_qty || 0,
          porsi_terpakai: d.porsi_terpakai || 0,
          porsi_rusak: d.porsi_rusak || 0,
          porsi_sisa: d.porsi_sisa || 0
        });
      }
    });

    // 5. Reconstruct full Operational Items
    const opMap = {};
    (record.stocks || []).forEach(s => { 
      opMap[s.name] = { ...s, processed: false }; 
    });

    const fullStocks = (opItems || []).map(op => {
      const usedData = opMap[op.name];
      if (usedData) usedData.processed = true;
      const usedQty = usedData ? (parseFloat(usedData.used !== undefined ? usedData.used : usedData.qty) || 0) : 0;
      return {
        name: op.name,
        used: usedQty,
        qty: usedQty, // backward compatibility
        sisa: fullInventoryMap[op.name] || 0,
        tambah: (realTambahMap[op.name] !== undefined && realTambahMap[op.name] !== 0) ? realTambahMap[op.name] : (usedData ? (usedData.tambah || 0) : 0),
        tambah_safety: (realTambahSafetyMap[op.name] !== undefined && realTambahSafetyMap[op.name] !== 0) ? realTambahSafetyMap[op.name] : (usedData ? (usedData.tambah_safety || 0) : 0)
      };
    });

    // Add any used items that were deleted from master
    (record.stocks || []).forEach(s => {
      if (opMap[s.name] && !opMap[s.name].processed) {
        const usedQty = parseFloat(s.used !== undefined ? s.used : s.qty) || 0;
        fullStocks.push({
          name: s.name,
          used: usedQty,
          qty: usedQty,
          sisa: fullInventoryMap[s.name] || 0,
          tambah: (realTambahMap[s.name] !== undefined && realTambahMap[s.name] !== 0) ? realTambahMap[s.name] : (s.tambah || 0),
          tambah_safety: (realTambahSafetyMap[s.name] !== undefined && realTambahSafetyMap[s.name] !== 0) ? realTambahSafetyMap[s.name] : (s.tambah_safety || 0)
        });
      }
    });

    const metaDetail = (record.details || []).find(d => d._is_meta);
    const sAktual = metaDetail ? metaDetail.setoran_aktual : record.setoran_aktual;
    const sSelisih = metaDetail ? metaDetail.selisih : record.selisih;
    const sNote = metaDetail ? metaDetail.note : record.note;

    // 7. Export
    exportShiftToExcel({
      shift: record.shift,
      staffName: record.staff_name,
      cashAwal: record.cash_awal,
      date: record.date,
      products: fullProducts,
      expenses: record.expenses || [],
      stocks: fullStocks,
      inventoryMap: fullInventoryMap,
      shift1Report,
      setoranAktual: sAktual,
      selisih: sSelisih,
      note: sNote || '',
      skipKartuStok: false,
      shiftLogs: shiftLogs || []
    }, record.branch_name);
  } catch (error) {
    alert('Gagal mengunduh detail laporan: ' + error.message);
  }
};
