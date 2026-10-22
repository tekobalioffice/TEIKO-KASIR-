import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { useAuth } from '../contexts/AuthContext';
import { useLocalStorageBranch } from '../hooks/useLocalStorageBranch';
import Icon from '../components/Icon';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { format, parseISO } from 'date-fns';
import { id } from 'date-fns/locale';
import { parseQty, formatFraction, isAutoCalculatedItem, getStockKey, getPorsiWindowStart } from '../utils/stockUtils';
import { exportSuratJalan } from '../utils/exportExcel';

/**
 * ============================================================================
 * PENJELASAN UMUM KOMPONEN ADMIN INVENTORY (HALAMAN MANAJEMEN STOK)
 * ============================================================================
 * Komponen ini digunakan oleh Admin, Owner, maupun Petugas Gudang untuk:
 * 1. Melihat dan memantau stok barang di setiap cabang/outlet.
 * 2. Melakukan pengaturan stok manual (Mode Set Stok).
 * 3. Melakukan pengiriman barang dari gudang ke outlet (Mode Pengiriman).
 * 4. Melakukan penambahan stok display / restock (Mode Tambah/Restock).
 * 5. Mengubah urutan tampilan barang (Drag & Drop menggunakan library @dnd-kit).
 * 6. Melakukan Oper Barang antar cabang dan Kurasi (pencatatan barang rusak/keluar).
 * ============================================================================
 */

/**
 * Sub-komponen React untuk merender SATU BARIS barang di tabel stok.
 * - Dilengkapi fitur drag-and-drop (menggeser urutan barang) dengan hook `useSortable`.
 * - Menampilkan nama barang, status (Auto/Virtual/Satuan), serta kolom input.
 * - Input menyesuaikan mode aktif: mode 'set_stok' (atur stok langsung) vs mode lain (tambah/kirim stok).
 */
function SortableInventoryRow({ item, idx, qty, addQty, isLow, isNotSet, handleQtyChange, handleAddQtyChange, activeMode, onActionClick, onResetTambah, onResetGudang, isInCart, isAutoCalculated }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.item_name });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : 'auto',
    opacity: isDragging ? 0.8 : 1,
  };

  return (
    <div ref={setNodeRef} className="inv-row" style={{
      ...style,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0.6rem 1rem',
      borderBottom: '1px solid var(--border-color)',
      backgroundColor: isDragging ? 'var(--panel-bg)' : (idx % 2 === 1 ? '#f6f6f8' : 'var(--panel-bg)'),
      boxShadow: isDragging ? 'var(--shadow-pop)' : 'none',
      flexWrap: 'wrap', gap: '0.75rem'
    }}>
      <div className="inv-row-main" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: '200px' }}>
        <button
          {...attributes}
          {...listeners}
          style={{
            background: 'none', border: 'none', cursor: 'grab', padding: '0.2rem',
            color: 'var(--text-muted)', display: 'flex', alignItems: 'center'
          }}
          className="drag-handle"
        >
          <Icon name="grip" size={16} />
        </button>
        <span style={{
          color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600,
          minWidth: '22px', textAlign: 'right', fontVariantNumeric: 'tabular-nums'
        }}>
          {idx + 1}
        </span>
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{item.item_name}</div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.1rem' }}>
            {isAutoCalculated ? (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Stok: <strong style={{ color: 'var(--text-muted)' }}>(Auto-Potong)</strong>
              </span>
            ) : (
              <>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Stok Saat Ini: <strong style={{ color: isLow ? 'var(--danger)' : isNotSet ? 'inherit' : 'var(--primary)' }}>{isNotSet ? '-' : qty}</strong>
                </span>
                {isLow && !isNotSet && (
                  <span style={{ backgroundColor: 'rgba(255, 56, 60,0.1)', color: 'var(--danger)', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 700 }}>Menipis</span>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="inv-row-ctl" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        {activeMode !== 'set_stok' && !isAutoCalculated && !item.isVirtual && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: activeMode === 'restock' ? 'rgba(255, 149, 0,0.08)' : activeMode === 'pengiriman' ? 'var(--ship-soft)' : 'rgba(13, 111, 255,0.06)', padding: '0.25rem 0.5rem', borderRadius: '8px', border: activeMode === 'restock' ? '1px solid rgba(255, 149, 0,0.35)' : activeMode === 'pengiriman' ? '1px solid rgba(48, 176, 199,0.5)' : '1px solid rgba(13, 111, 255,0.25)' }}>
            <span style={{ fontSize: '0.72rem', color: activeMode === 'restock' ? '#c2410c' : activeMode === 'pengiriman' ? 'var(--ship-ink)' : 'var(--accent)', fontWeight: 600 }}>+ {activeMode === 'restock' ? 'Restock' : activeMode === 'pengiriman' ? 'Kirim' : 'Tambah'}:</span>
            <input
              id={`add-input-${idx}`}
              type="text"
              inputMode="decimal"
              className="input-field"
              style={{ padding: '0.4rem', fontSize: '0.95rem', marginBottom: 0, width: '70px', textAlign: 'center', fontWeight: 600, borderColor: activeMode === 'restock' ? 'rgba(255, 149, 0,0.4)' : activeMode === 'pengiriman' ? 'rgba(48, 176, 199,0.6)' : 'rgba(13, 111, 255,0.35)', color: activeMode === 'restock' ? '#c2410c' : activeMode === 'pengiriman' ? 'var(--ship-ink)' : 'var(--accent)' }}
              placeholder={activeMode === 'tambah' ? (formatFraction(item.tambah_qty || 0) || '0') : activeMode === 'restock' ? (formatFraction(item.safety_qty || 0) || '0') : '0'}
              value={addQty ?? ''}
              onChange={e => handleAddQtyChange(item.item_name, e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const nextInput = document.getElementById(`add-input-${idx + 1}`);
                  if (nextInput) {
                    nextInput.focus();
                    nextInput.select();
                  }
                }
              }}
            />
            {activeMode === 'tambah' && (
              <button
                type="button"
                onClick={() => onResetTambah(item)}
                title="Reset Tambah ke 0 (koreksi salah input)"
                style={{
                  background: 'rgba(13, 111, 255,0.1)', color: 'var(--accent)', border: 'none',
                  borderRadius: '6px', padding: '0.35rem', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}
              >
                <Icon name="rotate-ccw" size={14} />
              </button>
            )}
            {activeMode === 'restock' && (
              <button
                type="button"
                onClick={() => onResetGudang(item)}
                title="Reset stok gudang ke 0"
                style={{
                  background: 'rgba(255, 149, 0,0.15)', color: '#c2410c', border: 'none',
                  borderRadius: '6px', padding: '0.35rem', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}
              >
                <Icon name="rotate-ccw" size={14} />
              </button>
            )}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {!isAutoCalculated && !item.isVirtual && !isInCart && (
            <div style={{ display: 'flex', gap: '0.25rem', marginRight: '0.5rem' }}>
              <button
                onClick={() => onActionClick('transfer', item)}
                title="Oper Stok"
                style={{
                  background: 'rgba(13, 111, 255, 0.1)', color: '#0d6fff', border: 'none',
                  borderRadius: '6px', padding: '0.4rem', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}
              >
                <Icon name="refresh" size={14} />
              </button>
              <button
                onClick={() => onActionClick('deduct', item)}
                title="Kurasi / Buang Stok"
                style={{
                  background: 'rgba(255, 56, 60, 0.1)', color: '#ff383c', border: 'none',
                  borderRadius: '6px', padding: '0.4rem', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}
              >
                <Icon name="alert-triangle" size={14} />
              </button>
            </div>
          )}
          {isInCart && (
             <div style={{ marginRight: '0.5rem' }}>
               <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, backgroundColor: 'var(--panel-bg)', padding: '0.2rem 0.4rem', borderRadius: '4px', border: '1px solid var(--border-color)' }}>Di Keranjang</span>
             </div>
          )}
          <span style={{ fontSize: '0.75rem', color: isLow ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 600 }} className="hidden-mobile">Set Stok:</span>
          {isAutoCalculated || item.isVirtual ? (
            <span style={{
              display: 'inline-block', padding: '0.5rem 0.6rem', fontSize: '0.9rem', marginBottom: 0, width: '90px',
              textAlign: 'center', fontWeight: 800, backgroundColor: 'rgba(0,0,0,0.02)', borderRadius: '6px', color: 'var(--text-muted)', border: '2px solid transparent'
            }}>(Auto)</span>
          ) : (
            <input
              id={`stock-input-${idx}`}
              type="text"
              inputMode="decimal"
              className="input-field"
              style={{
                padding: '0.5rem 0.6rem', fontSize: '1rem', marginBottom: 0, width: '84px', textAlign: 'center', fontWeight: 600,
                ...(isLow ? { borderColor: 'var(--danger)', backgroundColor: 'rgba(255,56,60,0.08)', color: 'var(--danger)' } : {})
              }}
              placeholder="-"
              value={qty ?? ''}
              onChange={e => handleQtyChange(item.item_name, e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const nextInput = document.getElementById(`stock-input-${idx + 1}`);
                  if (nextInput) {
                    nextInput.focus();
                    nextInput.select();
                  }
                }
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * ============================================================================
 * KOMPONEN UTAMA: AdminInventory
 * ============================================================================
 * Komponen halaman penuh untuk mengelola persediaan barang (Inventory).
 */
export default function AdminInventory() {
  const { userData } = useAuth(); // Mengambil data pengguna login (nama, role)
  const isGudangRole = userData?.role?.toLowerCase() === 'gudang'; // Cek apakah login sebagai akun Gudang

  // --- STATE MANAJEMEN CABANG & INVENTORY ---
  const [branches, setBranches] = useState([]); // Daftar cabang yang ada di database
  const [selectedBranch, setSelectedBranch] = useLocalStorageBranch(''); // Cabang yang sedang dipilih (disimpan di localStorage)
  const [inventory, setInventory] = useState([]); // Array daftar barang dan stok pada cabang terpilih
  const [loading, setLoading] = useState(true); // Status loading saat mengambil data dari Supabase
  const [saving, setSaving] = useState(false); // Status loading saat menyimpan data ke Supabase
  
  // 'set_stok' (Set Manual) dipensiunkan — penyesuaian stok lewat halaman Penyesuaian Stok.
  // Halaman ini hanya untuk Pengiriman (+ Restock/Tambah khusus admin).
  const [activeMode, setActiveMode] = useState('pengiriman');

  useEffect(() => {
    if (isGudangRole) {
      setActiveMode('pengiriman');
    }
  }, [isGudangRole]);
  const [globalDefaultMode, setGlobalDefaultMode] = useState('stok');
  const [itemDestinations, setItemDestinations] = useState({}); // Tujuan pengiriman barang (Gudang atau Display)
  const [showSettings, setShowSettings] = useState(false); // Modal pengaturan
  const [allItems, setAllItems] = useState([]); // Seluruh master item produk
  const [searchTerm, setSearchTerm] = useState(''); // Kata kunci pencarian barang
  const [activeDataBranch, setActiveDataBranch] = useState('');
  const [baseInventoryItems, setBaseInventoryItems] = useState([]);
  
  // --- STATE UNTUK FITUR OPER BARANG & KURASI (WASTE) ---
  const [actionCart, setActionCart] = useState([]); // Keranjang barang yang akan dioper/dikurasi
  const [actionType, setActionType] = useState(null); // 'transfer' (Oper Barang) | 'deduct' (Kurasi/Barang Keluar) | null
  const [transferDest, setTransferDest] = useState(''); // Cabang tujuan untuk Oper Barang
  const [isSubmittingAction, setIsSubmittingAction] = useState(false); // Status loading modal oper/kurasi

  // --- Auto-Save Draft ---
  useEffect(() => {
    if (selectedBranch && selectedBranch === activeDataBranch && inventory.length > 0 && !loading) {
      const draftKey = `admin_inventory_draft_${selectedBranch}`;
      const hasChanges = inventory.some(i => 
        (i.current_qty !== null && i.current_qty !== '' && parseQty(i.current_qty) !== i.original_qty) ||
        (i.add_qty !== null && i.add_qty !== '')
      );
      if (hasChanges) {
        localStorage.setItem(draftKey, JSON.stringify({ timestamp: Date.now(), items: inventory.map(i => ({ item_name: i.item_name, current_qty: i.current_qty, add_qty: i.add_qty })) }));
      } else {
        localStorage.removeItem(draftKey);
      }
    }
  }, [inventory, selectedBranch, activeDataBranch, loading]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 100, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = inventory.findIndex(i => i.item_name === active.id);
      const newIndex = inventory.findIndex(i => i.item_name === over.id);

      const newInventory = arrayMove(inventory, oldIndex, newIndex);
      setInventory(newInventory);

      // Update DB order
      setSaving(true);
      try {
        const productUpdates = [];
        const operationalUpdates = [];
        
        newInventory.forEach((item, idx) => {
          if (item.product_id) productUpdates.push({ id: item.product_id, display_order: idx + 1 });
          if (item.op_id) operationalUpdates.push({ id: item.op_id, display_order: idx + 1 });
        });

        const promises = [];
        if (productUpdates.length > 0) {
          productUpdates.forEach(u => promises.push(supabase.from('products').update({ display_order: u.display_order }).eq('id', u.id)));
        }
        if (operationalUpdates.length > 0) {
          operationalUpdates.forEach(u => promises.push(supabase.from('operational_items').update({ display_order: u.display_order }).eq('id', u.id)));
        }
        await Promise.all(promises);
      } catch (e) {
        console.error('Failed to update order', e);
      }
      setSaving(false);
    }
  };

  useEffect(() => {
    fetchBranches();
  }, []);

  // Koreksi cepat kalau salah input di mode Tambah (misal salah pilih item/varian) —
  // reset tambah_qty item itu balik ke 0, dicatat sebagai log terpisah (bukan hapus riwayat).
  const handleResetTambah = async (item) => {
    try {
      const dbKey = item.db_item_name ?? item.item_name;
      const { data: row } = await supabase
        .from('branch_inventory')
        .select('tambah_qty')
        .eq('branch_name', selectedBranch)
        .eq('item_name', dbKey)
        .maybeSingle();
      const oldTambah = row?.tambah_qty ?? 0;

      if (oldTambah === 0) {
        alert(`Tambah untuk "${item.item_name}" sudah 0.`);
        return;
      }
      if (!window.confirm(`Reset Tambah "${item.item_name}" dari ${formatFraction(oldTambah)} ke 0?`)) return;

      const actorName = userData?.name ? `${userData.name} (${userData.role || 'admin'})` : 'Admin';

      const { error: upErr } = await supabase.from('branch_inventory')
        .update({ tambah_qty: 0 })
        .eq('branch_name', selectedBranch)
        .eq('item_name', dbKey);
      if (upErr) throw upErr;

      await supabase.from('stock_restock_log').insert([{
        branch_name: selectedBranch,
        item_name: dbKey,
        qty_added: -oldTambah,
        qty_before: oldTambah,
        qty_after: 0,
        petugas_name: `${actorName} (Reset Tambah)`
      }]);

      await fetchInventory(selectedBranch, baseInventoryItems);
      alert(`Tambah "${item.item_name}" berhasil direset ke 0.`);
    } catch (err) {
      alert('Gagal reset Tambah: ' + err.message);
    }
  };

  // Reset stok gudang (safety_qty) item ke 0 — sama pola kayak handleResetTambah.
  // safety_qty bagian dari current_qty (total = display + safety), jadi current_qty ikut turun.
  const handleResetGudang = async (item) => {
    try {
      const dbKey = item.db_item_name ?? item.item_name;
      const { data: row } = await supabase
        .from('branch_inventory')
        .select('safety_qty, current_qty')
        .eq('branch_name', selectedBranch)
        .eq('item_name', dbKey)
        .maybeSingle();
      const oldSafety = row?.safety_qty ?? 0;

      if (oldSafety === 0) {
        alert(`Stok gudang "${item.item_name}" sudah 0.`);
        return;
      }
      if (!window.confirm(`Reset stok gudang "${item.item_name}" dari ${formatFraction(oldSafety)} ke 0?`)) return;

      const actorName = userData?.name ? `${userData.name} (${userData.role || 'admin'})` : 'Admin';

      const { error: upErr } = await supabase.from('branch_inventory')
        .update({ safety_qty: 0, current_qty: Math.max(0, (row?.current_qty ?? 0) - oldSafety) })
        .eq('branch_name', selectedBranch)
        .eq('item_name', dbKey);
      if (upErr) throw upErr;

      await supabase.from('stock_restock_log').insert([{
        branch_name: selectedBranch,
        item_name: dbKey,
        qty_added: -oldSafety,
        qty_before: oldSafety,
        qty_after: 0,
        petugas_name: `${actorName} [GUDANG] (Reset Gudang)`
      }]);

      await fetchInventory(selectedBranch, baseInventoryItems);
      alert(`Stok gudang "${item.item_name}" berhasil direset ke 0.`);
    } catch (err) {
      alert('Gagal reset gudang: ' + err.message);
    }
  };

  const handleActionSubmit = async (e) => {
    e.preventDefault();
    if (!actionType || actionCart.length === 0) return;
    
    if (actionType === 'transfer' && !transferDest) {
      alert("Silakan pilih cabang tujuan operan.");
      return;
    }

    // Validation loop
    for (const item of actionCart) {
      const qty = parseQty(item.qty);
      if (isNaN(qty) || qty <= 0) {
        alert(`Masukkan jumlah yang valid (lebih dari 0) untuk ${item.item_name}.`);
        return;
      }
      const currentInventoryQty = parseQty(item.current_qty) || 0;
      if (qty > currentInventoryQty) {
        alert(`Stok tidak mencukupi untuk ${item.item_name}. Stok saat ini: ${currentInventoryQty}`);
        return;
      }
      // Kurasi cabang biasa cuma boleh motong Display, bukan Gudang/Safety.
      if (actionType === 'deduct' && !item.isVirtual && selectedBranch !== 'Cabang Pusat' && selectedBranch !== 'Gudang') {
        const displayQty = parseQty(item.display_qty) || 0;
        if (qty > displayQty) {
          alert(`Kurasi ${item.item_name} maksimal sebanyak stok Display (${displayQty}). Stok Gudang tidak bisa dikurasi langsung — pindahkan ke Display dulu.`);
          return;
        }
      }
    }

    const isConfirm = window.confirm(
      actionType === 'transfer' 
        ? `Anda yakin ingin mengoper item berikut ke ${transferDest}?\n\n` + actionCart.map(i => `- ${i.qty} ${i.item_name}`).join('\n')
        : `Anda yakin ingin mengkurasi/menghapus item berikut?\n\n` + actionCart.map(i => `- ${i.qty} ${i.item_name}`).join('\n')
    );
    if (!isConfirm) return;

    setIsSubmittingAction(true);
    try {
      const sourceBranch = selectedBranch;
      const targetBranch = actionType === 'transfer' ? transferDest : 'Kurasi/Pembuangan';
      
      const pendingInserts = [];
      const branchInventoryUpdates = [];
      const stockLogInserts = [];
      const uiInventoryUpdates = {};

      for (const item of actionCart) {
        const qty = parseQty(item.qty);
        const currentInventoryQty = parseQty(item.current_qty) || 0;
        const newQty = currentInventoryQty - qty;
        uiInventoryUpdates[item.item_name] = newQty;

        if (sourceBranch === 'Cabang Pusat' || sourceBranch === 'Gudang') {
          if (actionType === 'transfer') {
            pendingInserts.push({
              action_type: 'transfer', 
              item_name: item.item_name,
              qty: qty,
              source_branch: sourceBranch,
              target_branch: targetBranch,
              created_by: userData?.name ? `${userData.name} (${userData.role || 'admin'})` : 'Admin',
              status: 'pending'
            });
            if (!item.isVirtual) branchInventoryUpdates.push(supabase.from('branch_inventory').update({ current_qty: newQty }).eq('branch_name', sourceBranch).eq('item_name', item.item_name));
            stockLogInserts.push({ branch_name: sourceBranch, item_name: item.item_name, qty_added: -qty, qty_before: currentInventoryQty, qty_after: newQty, petugas_name: `Dioper ke ${targetBranch}` });
          } else {
            if (!item.isVirtual) branchInventoryUpdates.push(supabase.from('branch_inventory').update({ current_qty: newQty }).eq('branch_name', sourceBranch).eq('item_name', item.item_name));
            stockLogInserts.push({ branch_name: sourceBranch, item_name: item.item_name, qty_added: -qty, qty_before: currentInventoryQty, qty_after: newQty, petugas_name: `Kurasi/Buang` });
          }
        } else {
          if (actionType === 'transfer') {
            pendingInserts.push({
              action_type: 'transfer_out', 
              item_name: item.item_name,
              qty: qty,
              source_branch: targetBranch,
              target_branch: sourceBranch,
              created_by: userData?.name ? `${userData.name} (${userData.role || 'admin'})` : 'Admin',
              status: 'pending'
            });
          } else {
            // Kurasi motong stok cabang sendiri — langsung eksekusi, gak perlu ACC lagi
            // (dulu numpuk jadi pending_stock_actions nunggu cabang ACC diri sendiri).
            // Potong display_qty juga (bukan cuma current_qty/total) biar "Awal/Sisa" yang
            // staff liat di Form Stok Checking ikut ke-update, gak "gak singkron".
            // qty sudah dibatasi <= display di validasi → current & display turun jumlah sama,
            // safety_qty tidak tersentuh. Log ditulis dalam satuan Display yang benar berkurang.
            const curDisplay = parseQty(item.display_qty) || 0;
            const newDisplayQty = Math.max(0, curDisplay - qty);
            if (!item.isVirtual) branchInventoryUpdates.push(supabase.from('branch_inventory').update({ current_qty: newQty, display_qty: newDisplayQty }).eq('branch_name', sourceBranch).eq('item_name', item.item_name));
            stockLogInserts.push({ branch_name: sourceBranch, item_name: item.item_name, qty_added: -qty, qty_before: curDisplay, qty_after: newDisplayQty, petugas_name: `${userData?.name ? `${userData.name} (${userData.role || 'admin'})` : 'Admin'} (Kurasi/Buang)` });
          }
        }
      }

      const allPromises = [...branchInventoryUpdates];
      if (pendingInserts.length > 0) {
        const { error: pendingError } = await supabase.from('pending_stock_actions').insert(pendingInserts);
        if (pendingError) throw pendingError;
      }
      if (stockLogInserts.length > 0) {
        const { error: logError } = await supabase.from('stock_restock_log').insert(stockLogInserts);
        if (logError) throw logError;
      }
      if (allPromises.length > 0) await Promise.all(allPromises);

      // Kurasi selalu langsung motong stok cabang sendiri (branch manapun) — Oper/Transfer
      // ke cabang lain masih butuh ACC (kecuali dikirim dari Cabang Pusat/Gudang).
      if (actionType !== 'transfer' || sourceBranch === 'Cabang Pusat' || sourceBranch === 'Gudang') {
        setInventory(prev => prev.map(i => {
          if (uiInventoryUpdates[i.item_name] !== undefined) return { ...i, current_qty: uiInventoryUpdates[i.item_name], original_qty: uiInventoryUpdates[i.item_name] };
          return i;
        }));
      }
      if (actionType === 'transfer') {
        if (sourceBranch === 'Cabang Pusat' || sourceBranch === 'Gudang') alert(`Berhasil! Operan ke ${targetBranch} telah dikirim untuk di-ACC oleh cabang tujuan.`);
        else alert(`Berhasil! Permintaan operan ke ${targetBranch} telah dikirim ke ${sourceBranch} untuk di-ACC.`);
      } else {
        alert(`Berhasil membuang/kurasi ${actionCart.length} item.`);
      }

      setActionType(null);
      setActionCart([]);
      setTransferDest('');
    } catch (error) {
      console.error(error);
      alert(`Gagal: ${error.message}`);
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const fetchBranches = async () => {
    const [branchRes, productRes, opRes, settingsRes] = await Promise.all([
      supabase.from('outlets').select('name'),
      supabase.from('products').select('id, name, variant, display_order').order('display_order').order('name'),
      supabase.from('operational_items').select('id, name, display_order').order('display_order').order('name'),
      supabase.from('branch_inventory').select('item_name, current_qty').eq('branch_name', 'SYSTEM_SETTINGS')
    ]);

    const systemSettings = settingsRes.data || [];
    setGlobalDefaultMode('stok');
    setActiveMode('pengiriman');

    const newDests = {};
    systemSettings.forEach(s => {
      if (s.item_name.startsWith('ROUTING_')) {
        const itemName = s.item_name.replace('ROUTING_', '');
        newDests[itemName] = s.current_qty === 1 ? 'tambah' : 'stok';
      }
    });
    setItemDestinations(newDests);

    const itemsMap = new Map();

    (productRes.data || []).forEach(p => {
      const key = p.variant && p.variant !== 'Standar' ? `${p.name} ${p.variant}` : p.name;
      // dbKey: kunci ASLI yang dipakai staff outlet (BranchPOS/BranchStockDrawer) buat baca/tulis
      // branch_inventory — lewat STOCK_KEY_MAP (mis. "Matcha Oat Latte" -> "Matcha"). `key` tetap
      // dipakai buat LABEL tampilan admin, dbKey yang dipakai buat operasi DB biar ga nyasar ke
      // baris item_name yang ga pernah kebaca staff.
      const dbKey = getStockKey(p);
      if (!itemsMap.has(key)) {
        itemsMap.set(key, { key, dbKey, display_order: p.display_order || 999, product_id: p.id, op_id: null });
      }
    });

    (opRes.data || []).forEach(o => {
      if (itemsMap.has(o.name)) {
        const existing = itemsMap.get(o.name);
        existing.op_id = o.id;
      } else {
        itemsMap.set(o.name, { key: o.name, dbKey: getStockKey(o), display_order: o.display_order || 999, product_id: null, op_id: o.id });
      }
    });

    const items = Array.from(itemsMap.values());
    items.sort((a, b) => {
      if (a.display_order !== b.display_order) return a.display_order - b.display_order;
      return a.key.localeCompare(b.key);
    });

    const itemsNames = items.map(i => i.key);
    setAllItems(itemsNames);
    setBaseInventoryItems(items);

    if (branchRes.data && branchRes.data.length > 0) {
      setBranches(branchRes.data);
      // Retrieve the saved branch or use the first branch if none is saved
      const savedBranch = localStorage.getItem('lastSelectedBranch');
      const branchToUse = (savedBranch && branchRes.data.some(b => b.name === savedBranch)) ? savedBranch : branchRes.data[0].name;
      
      setSelectedBranch(branchToUse);
      await fetchInventory(branchToUse, items);
    }
    setLoading(false);
  };

  const fetchInventory = async (branchName, itemList) => {
    setLoading(true);
    const itemsToUse = itemList || baseInventoryItems;

    const { data } = await supabase
      .from('branch_inventory')
      .select('*')
      .eq('branch_name', branchName);

    const map = {};
    (data || []).forEach(row => { map[row.item_name] = row; });

    // "Set Stok" (current_qty/original_qty di state UI ini) itu Awal/Display doang — BUKAN
    // total gabungan Awal+Safety. Fallback ke current_qty (kolom DB lama) cuma buat item lawas
    // yang belum pernah punya display_qty sendiri.
    let merged = itemsToUse.map(item => {
      // Prioritaskan baris di dbKey (kunci yang bener, dipakai staff) — fallback ke key lawas
      // (item_name mentah tanpa remap) buat baca data yang kesimpen sebelum fix ini ada.
      const dbRow = map[item.dbKey ?? item.key] ?? map[item.key];
      const effectiveDisplay = (dbRow?.display_qty !== null && dbRow?.display_qty !== undefined) ? dbRow.display_qty : (dbRow?.current_qty ?? 0);
      return {
        item_name: item.key,
        db_item_name: item.dbKey ?? item.key,
        current_qty: dbRow ? formatFraction(effectiveDisplay) : null,
        original_qty: dbRow ? effectiveDisplay : null,
        display_qty: effectiveDisplay,
        id: dbRow?.id ?? null,
        product_id: item.product_id,
        op_id: item.op_id,
        tambah_qty: dbRow?.tambah_qty ?? 0,
        safety_qty: dbRow?.safety_qty ?? 0,
        add_qty: ''
      };
    });

    // Load Draft jika ada dan masih dalam 8 jam (draft hari yang sama)
    const draftKey = `admin_inventory_draft_${branchName}`;
    const savedDraft = localStorage.getItem(draftKey);
    if (savedDraft) {
      try {
        const draftData = JSON.parse(savedDraft);
        const draftItems = Array.isArray(draftData) ? draftData : draftData.items;
        const draftTimestamp = Array.isArray(draftData) ? 0 : (draftData.timestamp ?? 0);
        if (draftItems && (Date.now() - draftTimestamp < 8 * 60 * 60 * 1000)) {
          merged = merged.map(i => {
            const draftI = draftItems.find(di => di.item_name === i.item_name);
            if (draftI) {
              return {
                ...i,
                current_qty: draftI.current_qty !== undefined ? draftI.current_qty : i.current_qty,
                add_qty: draftI.add_qty !== undefined ? draftI.add_qty : ''
              };
            }
            return i;
          });
        } else {
          localStorage.removeItem(draftKey); // Hapus draft usang
        }
      } catch (err) {
        console.error('Failed to parse draft', err);
        localStorage.removeItem(draftKey);
      }
    }

    // --- Kalkulasi Porsi Bubble Virtual ---
    const { data: lastRep } = await supabase
      .from('sales_reports')
      .select('details')
      .eq('branch_name', branchName)
      // id itu UUID (bukan urut waktu) — urut pakai date lalu shift
      .order('date', { ascending: false })
      .order('shift', { ascending: false })
      .limit(1);

    let basePorsiBesar = 0;
    let basePorsiKecil = 0;

    if (lastRep && lastRep.length > 0) {
      (lastRep[0].details || []).forEach(p => {
        if (p.name === 'Bubble Besar' && p.porsi_sisa !== undefined) basePorsiBesar = p.porsi_sisa;
        if (p.name === 'Bubble Kecil' && p.porsi_sisa !== undefined) basePorsiKecil = p.porsi_sisa;
      });
    }

    // Transfer porsi sesudah laporan basis ditutup
    const lastRepTime = await getPorsiWindowStart(supabase, branchName, lastRep?.[0]);

    let porsiBesarTambah = 0;
    let porsiKecilTambah = 0;

    let queryLogs = supabase
      .from('stock_restock_log')
      .select('item_name, qty_added')
      .eq('branch_name', branchName)
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

    const currentPorsiBesar = Math.max(0, basePorsiBesar + porsiBesarTambah);
    const currentPorsiKecil = Math.max(0, basePorsiKecil + porsiKecilTambah);

    merged.push({
      item_name: 'Porsi Bubble Besar',
      current_qty: currentPorsiBesar,
      original_qty: currentPorsiBesar,
      isVirtual: true,
      id: 'virtual_porsi_besar',
      product_id: null,
      op_id: null,
      add_qty: ''
    });

    merged.push({
      item_name: 'Porsi Bubble Kecil',
      current_qty: currentPorsiKecil,
      original_qty: currentPorsiKecil,
      isVirtual: true,
      id: 'virtual_porsi_kecil',
      product_id: null,
      op_id: null,
      add_qty: ''
    });
    // --------------------------------------

    setInventory(merged);
    setActiveDataBranch(branchName);
    setLoading(false);
  };

  const handleBranchChange = (e) => {
    // Simpan draft cabang lama SEBELUM inventory di-replace fetchInventory.
    // Auto-save effect ke-skip pas ganti cabang (guard selectedBranch === activeDataBranch
    // gagal di window transisi), jadi input yang belum disimpan bisa hilang tanpa ini.
    if (activeDataBranch && inventory.length > 0) {
      const hasChanges = inventory.some(i =>
        (i.current_qty !== null && i.current_qty !== '' && parseQty(i.current_qty) !== i.original_qty) ||
        (i.add_qty !== null && i.add_qty !== '')
      );
      const oldKey = `admin_inventory_draft_${activeDataBranch}`;
      if (hasChanges) {
        localStorage.setItem(oldKey, JSON.stringify({ timestamp: Date.now(), items: inventory.map(i => ({ item_name: i.item_name, current_qty: i.current_qty, add_qty: i.add_qty })) }));
      }
    }
    setSelectedBranch(e.target.value);
    fetchInventory(e.target.value, baseInventoryItems);
  };

  /**
   * Mengubah nilai input kolom Set Stok di dalam state `inventory`.
   * Diubah di memori React (belum disimpan permanen sebelum tombol Simpan diklik).
   */
  const handleQtyChange = (itemName, value) => {
    setInventory(prev => prev.map(i => i.item_name === itemName ? { ...i, current_qty: value } : i));
  };

  /**
   * Mengubah nilai input kolom Tambah / Pengiriman di dalam state `inventory`.
   */
  const handleAddQtyChange = (itemName, value) => {
    setInventory(prev => prev.map(i => i.item_name === itemName ? { ...i, add_qty: value } : i));
  };

  /**
   * ============================================================================
   * FUNGSI SIMPAN SERENTAK / BATCH (handleSaveAll)
   * ============================================================================
   * Logika penting pada sistem persediaan toko:
   * 1. Menyaring barang mana saja yang mengalami perubahan (diubah nilai `current_qty` atau `add_qty`).
   * 2. Menghindari perubahan pada item racikan otomatis (`isAutoCalculatedItem`) dan item virtual (`isVirtual`).
   * 3. Mampu memproses pengisian BANYAK barang secara bersamaan (batch upsert).
   * 4. Jika pengguna mengisi Set Stok DAN Tambah Stok sekaligus, kedua perhitungan digabungkan dengan benar:
   *    - Nilai dasar (baseQty) diambil dari input Set Stok (jika diisi), atau stok lama (jika tidak diubah).
   *    - Ditambah dengan nilai `add_qty` (jika ada pengiriman/penambahan).
   * 5. Setiap perubahan akan dicatat ke tabel riwayat `stock_history` (agar terlacak siapa yang mengubah & kapan).
   */
  const handleSaveAll = async () => {
    try {
      setSaving(true);
      
      // Filter item yang akan disimpan (abaikan item virtual & otomatis)
      const toUpdate = inventory.filter(i => {
        if (i.isVirtual || isAutoCalculatedItem(i.item_name)) return false;
        const hasSetValue = i.current_qty !== null && i.current_qty !== '' && !isNaN(parseQty(i.current_qty));
        const currentChanged = hasSetValue && Math.abs(parseQty(i.current_qty) - (i.original_qty ?? 0)) > 0.0001;
        const addHasValue = (i.add_qty !== null && i.add_qty !== '' && parseQty(i.add_qty) > 0);
        // Mode Restock = SET nilai gudang (opname). Nilai 0 yang diketik eksplisit = reset gudang
        // ke 0, jadi tetap harus lolos filter walau bukan > 0.
        const restockSet = activeMode === 'restock' && i.add_qty !== null && i.add_qty !== '' &&
          !isNaN(parseQty(i.add_qty)) && Math.abs(parseQty(i.add_qty) - (i.safety_qty ?? 0)) > 0.0001;
        // set_stok: DULU nyertain semua item yang "punya nilai" (praktis = SEMUA baris,
        // karena input udah ke-isi dari fetch awal) — akibatnya "Simpan Semua" nimpa balik
        // display_qty/tambah_qty tiap item pakai snapshot BASI dari saat halaman ke-load,
        // walau item itu gak disentuh sama sekali. Kalau ada ACC kiriman/kurasi dari staff
        // lain SELAMA admin buka halaman ini, perubahan itu ke-hapus diam-diam pas Simpan
        // Semua diklik (kejadian nyata: kiriman Kresek 5 unit ilang, Milo Ori kurasi ke-reset).
        // Sekarang cuma baris yang BENERAN diketik ulang admin yang ikut ke-upsert.
        if (activeMode === 'set_stok') return currentChanged;
        return currentChanged || addHasValue || restockSet;
      });

      if (toUpdate.length === 0) {
        alert('Tidak ada perubahan untuk disimpan!');
        setSaving(false);
        return;
      }

      // Ambil semua kolom stok terkini dari DB
      const { data: freshDisplayData } = await supabase
        .from('branch_inventory')
        .select('item_name, current_qty, display_qty, safety_qty, tambah_qty')
        .eq('branch_name', selectedBranch);
      const freshDisplayMap = {};   // display_qty (Awal)
      const freshSafetyMap = {};    // safety_qty (Gudang)
      const freshTambahMap = {};    // tambah_qty (Pindahan)
      (freshDisplayData || []).forEach(row => {
        freshDisplayMap[row.item_name] = row.display_qty ?? 0;
        freshSafetyMap[row.item_name] = row.safety_qty ?? 0;
        freshTambahMap[row.item_name] = row.tambah_qty ?? 0;
      });

      const rawUpsert = []; // Data stok baru yang akan di-upsert ke Supabase
      const logs = []; // Catatan log riwayat aktivitas stok
      const pendingInserts = []; // Kiriman mode Pengiriman — nunggu ACC/Tolak outlet, BUKAN langsung ke branch_inventory
      const actorName = userData?.name ? `${userData.name} (${userData.role || 'admin'})` : 'Admin';

      toUpdate.forEach(i => {
        const realQtyBefore = i.original_qty ?? 0;
        const currentChanged = (i.current_qty !== null && i.current_qty !== '' && Math.abs(parseQty(i.current_qty) - realQtyBefore) > 0.0001);

        // baseQty = nilai "Set Stok" = Awal/Display doang, BUKAN total gabungan Awal+Safety.
        let baseQty = currentChanged ? parseQty(i.current_qty) : realQtyBefore;
        if (isNaN(baseQty)) baseQty = realQtyBefore;

        // Input Tambah disembunyikan di mode 'set_stok' (lihat SortableInventoryRow), tapi
        // value lama di state `add_qty` ga otomatis kehapus pas ganti mode/draft di-restore —
        // jadi tanpa guard ini, sisa Tambah dari mode lain bisa ikut kebawa ke Set Manual.
        let add = activeMode === 'set_stok' ? 0 : (parseQty(i.add_qty) || 0);
        if (add < 0) add = 0;
        // Restock: input non-kosong & angka valid (termasuk 0) = perintah SET gudang.
        const isRestockSet = activeMode === 'restock' && i.add_qty !== null && i.add_qty !== '' && !isNaN(parseQty(i.add_qty));

        // Prioritaskan kunci dbKey (kanonik, dipakai staff outlet) — fallback ke item_name
        // lawas buat baca angka yang kesimpen sebelum item ini ke-remap (mis. "Matcha Oat Latte").
        const dbKey = i.db_item_name ?? i.item_name;
        const oldSafety = freshSafetyMap[dbKey] ?? freshSafetyMap[i.item_name] ?? 0;
        const oldTambah = freshTambahMap[dbKey] ?? freshTambahMap[i.item_name] ?? 0;

        // current_qty = kolom TOTAL (Display+Safety) di DB, dijaga konsisten tiap mode.
        // Default: Display (baseQty) + Safety lama (belum berubah).
        const upsertRow = {
          branch_name: selectedBranch,
          item_name: dbKey,
          current_qty: baseQty + oldSafety,
          updated_at: new Date().toISOString()
        };

        // Tulis ke kolom yang tepat sesuai mode:
        // - set_stok  → display_qty = nilai set, tambah_qty = 0 (reset), safety_qty tidak berubah
        // - tambah    → tambah_qty += add (masuk Awal sebagai Pindahan, display/safety ga berubah)
        // - restock   → safety_qty = add (SET/opname, bukan nambah — staff isi hitungan fisik gudang)
        // - pengiriman → TIDAK nulis branch_inventory langsung. Masuk pending_stock_actions,
        //   nunggu outlet tujuan klik Terima/Tolak di BranchPOS (lihat handleAcceptAction/handleRejectAction).
        const isPengirimanAdd = activeMode === 'pengiriman' && add > 0;
        if (activeMode === 'set_stok') {
          upsertRow.display_qty = baseQty;
          upsertRow.tambah_qty = 0;
          upsertRow.safety_qty = oldSafety;
        } else if (activeMode === 'tambah' && add > 0) {
          upsertRow.tambah_qty = oldTambah + add;
        } else if (isRestockSet) {
          upsertRow.safety_qty = add;
          upsertRow.current_qty = baseQty + add;
        }

        if (isPengirimanAdd) {
          const dest = itemDestinations[i.item_name] === 'tambah' ? 'DISPLAY' : 'GUDANG';
          pendingInserts.push({
            action_type: dest === 'DISPLAY' ? 'pengiriman_display' : 'pengiriman_gudang',
            item_name: dbKey,
            qty: add,
            source_branch: 'Gudang',
            target_branch: selectedBranch,
            created_by: actorName,
            status: 'pending'
          });
        }

        // Kalau item ini CUMA punya add pengiriman (tanpa koreksi Set Manual), jangan upsert
        // branch_inventory sama sekali — nunggu ACC outlet. Kalau ada currentChanged juga,
        // tetap upsert base-nya (Set Manual independen dari kiriman yang di-hold).
        if (!isPengirimanAdd || currentChanged) {
          rawUpsert.push(upsertRow);
        }

        if (currentChanged) {
          logs.push({
            branch_name: selectedBranch,
            item_name: dbKey,
            qty_added: baseQty - realQtyBefore,
            qty_before: realQtyBefore,
            qty_after: baseQty,
            petugas_name: `${actorName} (Set Manual)`
          });
        }

        const restockChanged = isRestockSet && Math.abs(add - oldSafety) > 0.0001;
        if ((add > 0 || restockChanged) && activeMode !== 'pengiriman') {
          let logPetugas = actorName;
          let logQtyAdded = add;
          let logQtyBefore = baseQty;
          let logQtyAfter = baseQty + add;
          if (activeMode === 'tambah') {
             logPetugas = `${actorName} [DISPLAY] (Penambahan Display)`;
             logQtyBefore = oldTambah;
             logQtyAfter = oldTambah + add;
          } else if (activeMode === 'restock') {
             logPetugas = `${actorName} [GUDANG] (Mode Restock)`;
             // Restock = SET nilai gudang, jadi log-nya juga pakai before/after gudang sendiri,
             // bukan before/after current_qty gabungan (itu ranah Set Manual/Display).
             logQtyAdded = add - oldSafety;
             logQtyBefore = oldSafety;
             logQtyAfter = add;
          }

          logs.push({
            branch_name: selectedBranch,
            item_name: dbKey,
            qty_added: logQtyAdded,
            qty_before: logQtyBefore,
            qty_after: logQtyAfter,
            petugas_name: logPetugas
          });
        }
      });

      const seen = new Set();
      const toUpsert = rawUpsert.filter(row => {
        if (seen.has(row.item_name)) return false;
        seen.add(row.item_name);
        return true;
      });

      let error = null;
      if (toUpsert.length > 0) {
        const { error: upsertErr } = await supabase.from('branch_inventory').upsert(toUpsert, {
          onConflict: 'branch_name,item_name'
        });
        error = upsertErr;
      }

      if (error) throw error;

      if (logs.length > 0) {
        await supabase.from('stock_restock_log').insert(logs);
      }

      if (pendingInserts.length > 0) {
        const { error: pendingErr } = await supabase.from('pending_stock_actions').insert(pendingInserts);
        if (pendingErr) throw pendingErr;
      }

      localStorage.removeItem(`admin_inventory_draft_${selectedBranch}`);
      alert(pendingInserts.length > 0
        ? `Kiriman terkirim, menunggu konfirmasi Terima/Tolak dari outlet ${selectedBranch}.`
        : 'Perubahan stok berhasil disimpan!');

      // Mode Pengiriman = kiriman fisik ke outlet — otomatis cetakin Surat Jalan
      // buat ditandatangani (Gudang/Production/Delivery/Team Outlet), samain kayak form kertas.
      if (activeMode === 'pengiriman') {
        const suratJalanItems = toUpdate
          .filter(i => parseQty(i.add_qty) > 0)
          .map(i => ({ name: i.item_name, qty: parseQty(i.add_qty) }));
        if (suratJalanItems.length > 0) {
          // Team Outlet = staff yang lagi login Shift 1 di outlet tujuan sekarang, bukan
          // ditulis manual. Cek log status terakhir — kalau entry terbarunya "Buka Shift 1"
          // (belum ada Tutup Shift 1 sesudahnya), berarti staff itu lagi aktif.
          let teamOutletName = '';
          try {
            const { data: statusLogs } = await supabase
              .from('stock_restock_log')
              .select('petugas_name, created_at')
              .eq('branch_name', selectedBranch)
              .eq('item_name', 'Status Aktivitas')
              .or('petugas_name.ilike.%Buka Input Shift 1%,petugas_name.ilike.%Tutup Shift 1%')
              .order('created_at', { ascending: false })
              .limit(1);
            const latest = statusLogs?.[0];
            if (latest && latest.petugas_name.includes('Buka Input Shift 1')) {
              teamOutletName = latest.petugas_name.replace(/\s*\(.*\)\s*$/, '').trim();
            }
          } catch (e) {
            console.error('Gagal ambil staff shift 1 aktif:', e);
          }
          exportSuratJalan(suratJalanItems, selectedBranch, teamOutletName);
        }
      }

      setActiveMode('pengiriman');
      await fetchInventory(selectedBranch, baseInventoryItems);
    } catch (err) {
      alert(`Gagal menyimpan: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="page-title flex justify-between items-center">
        <div>
          <h1 className="text-primary mb-1">Manajemen Stok Inventaris</h1>
          <p className="text-muted">Atur stok awal &amp; distribusi per cabang.</p>
        </div>
        <button onClick={handleSaveAll} disabled={saving} className="btn-primary" style={{ whiteSpace: 'nowrap' }}>
          <Icon name="save" size={18} /> {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
        </button>
      </div>

      {/* Mode toolbar */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        {/* Desktop: buttons */}
        <div className="mode-desktop" style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => setActiveMode('pengiriman')}
            className="btn-secondary"
            style={{ border: 'none', boxShadow: 'none', background: activeMode === 'pengiriman' ? 'var(--ship)' : 'transparent', color: activeMode === 'pengiriman' ? '#ffffff' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            <Icon name="plus" size={18} /> Mode Pengiriman
          </button>
          {!isGudangRole && (
            <>
              <button
                onClick={() => setActiveMode('restock')}
                className="btn-secondary"
                style={{ border: 'none', boxShadow: 'none', background: activeMode === 'restock' ? 'var(--warning)' : 'transparent', color: activeMode === 'restock' ? 'white' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                <Icon name="plus" size={18} /> Mode Restock (Gudang)
              </button>
              <button
                onClick={() => setActiveMode('tambah')}
                className="btn-secondary"
                style={{ border: 'none', boxShadow: 'none', background: activeMode === 'tambah' ? 'var(--accent)' : 'transparent', color: activeMode === 'tambah' ? 'white' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                <Icon name="plus" size={18} /> Mode Tambah (Display)
              </button>
            </>
          )}
        </div>

        {/* Mobile: dropdown */}
        <select
          className="mode-mobile input-field"
          style={{ marginBottom: 0, flex: 1 }}
          value={activeMode}
          onChange={e => setActiveMode(e.target.value)}
        >
          <option value="pengiriman">Mode Pengiriman</option>
          {!isGudangRole && <option value="restock">Mode Restock (Gudang)</option>}
          {!isGudangRole && <option value="tambah">Mode Tambah (Display)</option>}
        </select>

        {!isGudangRole && (
          <button onClick={() => setShowSettings(true)} className="btn-secondary" style={{ padding: '0.5rem 0.65rem', flexShrink: 0 }} title="Pengaturan Lanjutan">
            <Icon name="settings" size={18} />
          </button>
        )}
      </div>

      {showSettings && (
        <div className="glass-panel mb-6 animate-fade-in" style={{ border: '2px solid var(--primary)', padding: '1.5rem' }}>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-primary" style={{ margin: 0 }}>Pengaturan Lanjutan</h2>
            <button onClick={() => setShowSettings(false)} className="text-muted btn-secondary" style={{ padding: '0.4rem' }}><Icon name="close" size={18} /></button>
          </div>
          <h3 className="text-primary mb-2">Tujuan Mode Pengiriman</h3>
          <p className="text-muted mb-4" style={{ fontSize: '0.85rem' }}>Pilih kemana stok akan dialihkan secara otomatis saat menggunakan <strong>Mode Pengiriman</strong>.</p>
          <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {baseInventoryItems.map(item => (
              <div key={item.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', backgroundColor: 'var(--panel-bg)', borderRadius: '6px' }}>
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{item.key}</span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button 
                    onClick={async () => {
                      setItemDestinations(prev => ({...prev, [item.key]: 'stok'}));
                      await supabase.from('branch_inventory').upsert({ branch_name: 'SYSTEM_SETTINGS', item_name: `ROUTING_${item.key}`, current_qty: 0 }, { onConflict: 'branch_name,item_name' });
                    }}
                    className={`btn-${itemDestinations[item.key] !== 'tambah' ? 'primary' : 'secondary'}`}
                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', borderRadius: '4px' }}>
                    Stok
                  </button>
                  <button 
                    onClick={async () => {
                      setItemDestinations(prev => ({...prev, [item.key]: 'tambah'}));
                      await supabase.from('branch_inventory').upsert({ branch_name: 'SYSTEM_SETTINGS', item_name: `ROUTING_${item.key}`, current_qty: 1 }, { onConflict: 'branch_name,item_name' });
                    }}
                    className={`btn-${itemDestinations[item.key] === 'tambah' ? 'success' : 'secondary'}`}
                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', borderRadius: '4px', background: itemDestinations[item.key] === 'tambah' ? 'var(--success)' : '', color: itemDestinations[item.key] === 'tambah' ? 'white' : '' }}>
                    Display
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Branch Selector & Search Bar */}
      <div className="glass-panel" style={{ padding: '0.5rem', marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0' }}>

        {/* Top bar: Branch & Refresh */}
        <div style={{ padding: '0.75rem 1rem', display: 'flex', gap: '1rem', alignItems: 'center', borderBottom: '1px solid var(--border-color)' }}>
          <Icon name="store" size={20} className="text-muted" />
          <select className="input-field" style={{ maxWidth: '260px', marginBottom: 0 }} value={selectedBranch} onChange={handleBranchChange}>
            {branches.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
          </select>
          <button onClick={() => fetchInventory(selectedBranch)} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer' }}>
            <Icon name="refresh" size={18} />
          </button>
          <span className="text-muted" style={{ fontSize: '0.82rem', marginLeft: 'auto' }}>
            Edit stok → Simpan Semua
          </span>
        </div>

        {/* Search Bar */}
        <div style={{ padding: '0.75rem 1rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <Icon name="search" size={18} className="text-muted" />
          <input
            type="text"
            style={{ marginBottom: 0, border: 'none', background: 'transparent', padding: '0', outline: 'none', boxShadow: 'none', flex: 1, fontSize: '0.95rem' }}
            placeholder="Cari nama menu atau bahan..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Action Inline Form (Moved below search) */}
      {actionType && (
        <div id="action-form-section" className="glass-panel animate-fade-in" style={{ padding: '1.5rem', marginBottom: '1.5rem', border: `2px solid ${actionType === 'transfer' ? '#0d6fff' : '#ff383c'}` }}>
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold flex items-center gap-2" style={{ color: actionType === 'transfer' ? '#0d6fff' : '#ff383c', fontSize: '1.2rem' }}>
              {actionType === 'transfer' ? (
                <><Icon name="refresh" size={24} /> Form Oper Stok Sekaligus</>
              ) : (
                <><Icon name="alert-triangle" size={24} /> Form Kurasi Stok Sekaligus</>
              )}
            </h3>
            <button onClick={() => { setActionType(null); setActionCart([]); }} className="text-muted btn-secondary" style={{ padding: '0.4rem 0.8rem' }}><Icon name="close" size={18} /> Tutup</button>
          </div>
          
          <form onSubmit={handleActionSubmit} className="space-y-4" style={{ display: 'grid', gap: '1.5rem' }}>
            
            {actionCart.length === 0 ? (
              <div className="text-center p-6 text-muted border border-dashed rounded-xl border-gray-300">
                <p>Keranjang kosong. Klik tombol {actionType === 'transfer' ? 'Oper' : 'Kurasi'} pada daftar stok di bawah untuk menambahkan item.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-muted mb-1 text-sm uppercase tracking-widest font-black">Item Terpilih ({actionCart.length})</p>
                {actionCart.map((cartItem, idx) => (
                  <div key={cartItem.item_name} className="py-3 flex flex-wrap justify-between items-center gap-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <div style={{ flex: 1, minWidth: '150px' }}>
                      <p className="font-black" style={{ fontSize: '1.1rem' }}>{cartItem.item_name}</p>
                      <p className="text-xs text-muted">Stok: <strong className="text-primary">{cartItem.current_qty || 0}</strong> | Asal: <strong>{selectedBranch}</strong></p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <input
                        type="text"
                        inputMode="decimal"
                        className="input-field"
                        placeholder="cth: 1/2"
                        required
                        value={cartItem.qty}
                        onChange={e => {
                          const newCart = [...actionCart];
                          newCart[idx].qty = e.target.value;
                          setActionCart(newCart);
                        }}
                        style={{ fontSize: '1rem', padding: '0.5rem', fontWeight: 800, color: 'var(--primary)', width: '100px', marginBottom: 0 }}
                      />
                      <button type="button" onClick={() => setActionCart(prev => prev.filter((_, i) => i !== idx))} className="text-red-500 hover:bg-red-50 p-2 rounded-lg">
                        <Icon name="close" size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {actionType === 'transfer' && (
              <div>
                <label className="font-black text-muted uppercase tracking-widest mb-2 block" style={{ fontSize: '0.8rem' }}>Pilih Cabang Tujuan</label>
                <select 
                  className="input-field" 
                  required 
                  value={transferDest}
                  onChange={e => setTransferDest(e.target.value)}
                  style={{ fontSize: '1.05rem', padding: '0.75rem 1rem' }}
                >
                  <option value="">-- Klik & Pilih Cabang --</option>
                  {branches.filter(b => b.name !== selectedBranch).map(b => (
                    <option key={b.name} value={b.name}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}

            {actionType === 'transfer' ? (
              <div className="text-sm flex gap-3 mt-2" style={{ color: 'var(--text-muted)' }}>
                <Icon name="refresh" size={16} className="mt-0.5 flex-shrink-0 text-blue-500" />
                <p>Stok di <strong>{selectedBranch}</strong> akan terpotong sementara (In Transit) sampai Cabang Tujuan menekan tombol "ACC Terima" di Kasir mereka.</p>
              </div>
            ) : (
              <div className="text-sm flex gap-3 mt-2" style={{ color: 'var(--text-muted)' }}>
                <Icon name="alert-triangle" size={16} className="mt-0.5 flex-shrink-0 text-red-500" />
                {selectedBranch === 'Cabang Pusat' || selectedBranch === 'Gudang' ? (
                  <p>Stok Gudang akan langsung terpotong. Aksi ini tidak dapat dibatalkan.</p>
                ) : (
                  <p>Stok Display <strong>{selectedBranch}</strong> akan langsung terpotong tanpa perlu ACC dari Kasir. Aksi ini tidak dapat dibatalkan.</p>
                )}
              </div>
            )}

            <button type="submit" disabled={isSubmittingAction || actionCart.length === 0} className={`btn-primary w-full ${isSubmittingAction || actionCart.length === 0 ? 'opacity-50' : ''}`} style={{ backgroundColor: actionType === 'transfer' ? '#0d6fff' : '#ff383c', borderColor: actionType === 'transfer' ? '#0d6fff' : '#ff383c', padding: '1rem', fontSize: '1.1rem' }}>
              {isSubmittingAction ? 'Memproses...' : (actionType === 'transfer' ? `Konfirmasi & Kirim ${actionCart.length} Operan` : `Konfirmasi & Kurangi ${actionCart.length} Stok`)}
            </button>
          </form>
        </div>
      )}

      {/* Main Content Area */}
      <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="text-center text-muted py-8">Memuat data inventaris...</div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={inventory.filter(item => item.item_name.toLowerCase().includes(searchTerm.toLowerCase())).map(i => i.item_name)} strategy={verticalListSortingStrategy}>
              {inventory.filter(item => item.item_name.toLowerCase().includes(searchTerm.toLowerCase())).map((item, idx) => {
                const qty = item.current_qty;
                const isLow = qty !== null && qty <= 10;
                const isNotSet = qty === null;
                // find real index in unfiltered list to show correct numbering
                const realIdx = inventory.findIndex(i => i.item_name === item.item_name);
                return (
                  <SortableInventoryRow 
                    key={item.item_name}
                    item={item}
                    idx={realIdx}
                    qty={qty}
                    addQty={item.add_qty}
                    isLow={isLow}
                    isNotSet={isNotSet}
                    activeMode={activeMode}
                    handleQtyChange={handleQtyChange}
                    handleAddQtyChange={handleAddQtyChange}
                    isInCart={actionCart.some(i => i.item_name === item.item_name)}
                    isAutoCalculated={isAutoCalculatedItem(item.item_name)}
                    onActionClick={(type, item) => {
                      setActionType(type);
                      setActionCart(prev => {
                        if (prev.some(i => i.item_name === item.item_name)) return prev;
                        return [...prev, { ...item, qty: '' }];
                      });
                      setTimeout(() => {
                        document.getElementById('action-form-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }, 100);
                    }}
                    onResetTambah={handleResetTambah}
                    onResetGudang={handleResetGudang}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
        )}
      </div>

    </div>
  );
}
