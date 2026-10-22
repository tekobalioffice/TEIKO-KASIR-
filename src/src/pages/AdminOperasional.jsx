import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import Icon from '../components/Icon';
import { format, parseISO } from 'date-fns';
import { id } from 'date-fns/locale';

const parseQty = (val) => {
  if (val === undefined || val === null || val === '') return 0;
  let s = String(val).trim().replace(/,/g, '.');
  
  if (s.includes(' ')) {
    const parts = s.split(' ');
    if (parts.length === 2 && parts[1].includes('/')) {
      const whole = parseFloat(parts[0]) || 0;
      const fracParts = parts[1].split('/');
      if (fracParts.length === 2 && parseFloat(fracParts[1]) !== 0) {
        return whole + (parseFloat(fracParts[0]) / parseFloat(fracParts[1]));
      }
    }
  } else if (s.includes('/')) {
    const parts = s.split('/');
    if (parts.length === 2 && parseFloat(parts[1]) !== 0) {
      return parseFloat(parts[0]) / parseFloat(parts[1]);
    }
  }
  
  const parsed = parseFloat(s);
  return isNaN(parsed) ? NaN : parsed;
};

export default function AdminOperasional() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [delModalOpen, setDelModalOpen] = useState(false);
  const [selectedForDelete, setSelectedForDelete] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [newItem, setNewItem] = useState({ name: '', unit: 'pcs', category: 'Perlengkapan', display_order: 0 });

  // Stock Management States
  const [activeTab, setActiveTab] = useState('master'); // 'master' | 'stock'
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [inventory, setInventory] = useState([]);
  const [isRestockOpen, setRestockOpen] = useState(false);
  const [restock, setRestock] = useState({ item_name: '', qty: '' });
  const [searchTerm, setSearchTerm] = useState('');
  
  const CATEGORIES = ['Perlengkapan', 'Dokumen', 'Kemasan', 'Peralatan', 'Lainnya'];

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    // Fetch Items
    const { data: itemsData, error: itemsErr } = await supabase.from('operational_items').select('*').order('display_order', { ascending: true, nullsFirst: false }).order('name');
    if (!itemsErr) {
        setItems(itemsData || []);
        if (itemsData && itemsData.length > 0) {
            setRestock(r => ({ ...r, item_name: itemsData[0].name }));
        }
    }
    else console.error(itemsErr);

    // Fetch Branches
    const { data: branchData } = await supabase.from('outlets').select('name');
    if (branchData && branchData.length > 0) {
        setBranches(branchData);
        setSelectedBranch(branchData[0].name);
        await fetchInventory(branchData[0].name, itemsData?.map(i => i.name) || []);
    }

    setLoading(false);
  };

  const fetchInventory = async (branchName, itemNamesList) => {
    setLoading(true);
    
    const { data } = await supabase
      .from('branch_inventory')
      .select('*')
      .eq('branch_name', branchName);
      
    const names = itemNamesList || Array.from(new Set([...items.map(i => i.name), ...(data || []).map(r => r.item_name)])).sort();
    
    const map = {};
    (data || []).forEach(row => { map[row.item_name] = row; });

    const merged = names.map(name => ({
      item_name: name,
      current_qty: map[name]?.current_qty ?? null,
      original_qty: map[name]?.current_qty ?? 0,
      id: map[name]?.id ?? null,
    }));

    setInventory(merged);
    setLoading(false);
  };

  const handleBranchChange = (e) => {
    setSelectedBranch(e.target.value);
    fetchInventory(e.target.value);
  };

  const handleQtyChange = (itemName, value) => {
    setInventory(prev => prev.map(i => i.item_name === itemName ? { ...i, current_qty: value } : i));
  };

  // Master Actions
  const handleAdd = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: newItem.name.trim(),
        unit: newItem.unit.trim() || 'pcs',
        category: newItem.category,
        display_order: parseInt(newItem.display_order) || 0
      };

      if (editingItem) {
        const { error } = await supabase.from('operational_items').update(payload).eq('id', editingItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('operational_items').insert([payload]);
        if (error) throw error;
      }

      setModalOpen(false);
      setEditingItem(null);
      setNewItem({ name: '', unit: 'pcs', category: 'Perlengkapan', display_order: 0 });
      await fetchData();
    } catch (err) {
      alert(`Gagal menyimpan: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setNewItem({ 
      name: item.name, 
      unit: item.unit || 'pcs', 
      category: item.category || 'Perlengkapan',
      display_order: item.display_order || 0
    });
    setDelModalOpen(false);
    setModalOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id, name) => {
    setSelectedForDelete({ id, name });
    setModalOpen(false);
    setDelModalOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const confirmDelete = async () => {
    if (!selectedForDelete) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('operational_items').delete().eq('id', selectedForDelete.id);
      if (error) throw error;
      await fetchData();
      setDelModalOpen(false);
    } catch (err) {
      alert(`Gagal menghapus: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Stock Actions
  const handleSaveAllStock = async () => {
    try {
      setSaving(true);
      const toUpsert = inventory
        .filter(i => i.current_qty !== null && i.current_qty !== '')
        .map(i => ({
          branch_name: selectedBranch,
          item_name: i.item_name,
          current_qty: parseQty(i.current_qty) || 0,
          updated_at: new Date().toISOString()
        }));

      const { error } = await supabase.from('branch_inventory').upsert(toUpsert, {
        onConflict: 'branch_name,item_name'
      });

      if (error) throw error;

      // Log every change manually
      const logPromises = inventory
        .filter(i => i.current_qty !== null && i.current_qty !== '' && parseQty(i.current_qty) !== i.original_qty)
        .map(i => {
           const beforeQty = i.original_qty;
           const afterQty = parseQty(i.current_qty) || 0;
           const added = afterQty - beforeQty;
           return supabase.from('stock_restock_log').insert([{
             branch_name: selectedBranch,
             item_name: i.item_name,
             qty_added: added,
             qty_before: beforeQty,
             qty_after: afterQty,
             petugas_name: 'Admin (Update Stok Ops)'
           }]);
        });
      
      await Promise.all(logPromises);

      alert('Stok operasional berhasil disimpan!');
      await fetchInventory(selectedBranch);
    } catch (err) {
      alert(`Gagal menyimpan: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleRestock = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      const qty = parseQty(restock.qty) || 0;
      if (qty <= 0) { alert('Masukkan jumlah restock yang valid!'); return; }

      const { data: current } = await supabase.from('branch_inventory')
        .select('*')
        .eq('branch_name', selectedBranch)
        .eq('item_name', restock.item_name)
        .single();

      const newQty = (current?.current_qty || 0) + qty;

      const { error } = await supabase.from('branch_inventory').upsert({
        branch_name: selectedBranch,
        item_name: restock.item_name,
        current_qty: newQty,
        updated_at: new Date().toISOString()
      }, { onConflict: 'branch_name,item_name' });

      if (error) throw error;

      await supabase.from('stock_restock_log').insert([{
        branch_name: selectedBranch,
        item_name: restock.item_name,
        qty_added: qty,
        qty_before: current?.current_qty || 0,
        qty_after: newQty,
        petugas_name: 'Admin (Restock Ops)'
      }]);

      alert(`Stok ${restock.item_name} berhasil ditambah ${qty} unit. Total sekarang: ${newQty}`);
      setRestockOpen(false);
      setRestock({ item_name: items.length > 0 ? items[0].name : '', qty: '' });
      await fetchInventory(selectedBranch);
    } catch (err) {
      alert(`Gagal restock: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Helper: Get stock from inventory map
  const getStockQty = (itemName) => {
    const item = inventory.find(i => i.item_name === itemName);
    return item ? item.current_qty : null;
  };

  // Group by category for Master
  const grouped = items.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  const formatTime = (ts) => {
    if (!ts) return '';
    try {
      return format(parseISO(ts), 'dd MMMM yyyy, HH:mm', { locale: id });
    } catch (e) {
      const d = new Date(ts);
      return d.toLocaleString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
  };

  const lowStockItems = inventory.filter(i => i.current_qty !== null && i.current_qty !== '' && parseQty(i.current_qty) <= 10);

  return (
    <div className="animate-fade-in">
      <div className="page-title flex justify-between items-center">
        <div>
          <h1 className="text-primary mb-1">Support Product</h1>
          <p className="text-muted">Kelola item operasional (plastik, gas, galon) beserta stok di tiap cabang.</p>
        </div>
      </div>

       <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', borderBottom: '2px solid var(--border-color)', paddingBottom: '0.5rem' }}>
          {[
            ['master', 'Master Support Product'],
            ['stock', 'Stok Per Cabang']
          ].map(([key, label]) => (
            <button 
              key={key}
              onClick={() => setActiveTab(key)} 
              style={{ 
                  background: 'none', border: 'none', padding: '0.5rem 1rem', fontWeight: 700, fontSize: '1rem', cursor: 'pointer',
                  color: activeTab === key ? 'var(--primary)' : 'var(--text-muted)',
                  borderBottom: activeTab === key ? '3px solid var(--primary)' : '3px solid transparent',
                  marginBottom: '-0.6rem'
              }}>
              {label}
            </button>
          ))}
      </div>

      {activeTab === 'master' ? (
          <>
            <div className="flex justify-between items-center mb-4">
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <Icon name="store" size={20} className="text-muted" />
                    <select className="input-field" style={{ maxWidth: '260px', marginBottom: 0 }} value={selectedBranch} onChange={handleBranchChange}>
                        {branches.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
                    </select>
                </div>
                <button onClick={() => {
                  setDelModalOpen(false);
                  setEditingItem(null);
                  setNewItem({ name: '', unit: 'pcs', category: 'Perlengkapan', display_order: 0 });
                  setModalOpen(true);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }} className="btn-primary">
                <Icon name="plus" size={18} /> Tambah Item
                </button>
            </div>

            {/* Add/Edit Item Form */}
            {modalOpen && (
                <div className="glass-panel mb-6 animate-fade-in" style={{ border: '2px solid var(--primary)', padding: '1.5rem' }}>
                <h2 className="mb-4 text-primary">{editingItem ? 'Edit Item Operasional' : 'Tambah Item Operasional'}</h2>
                <p className="text-muted mb-4" style={{ fontSize: '0.88rem' }}>
                    Item yang ditambahkan di sini akan otomatis muncul di menu Stok Per Cabang.
                </p>
                <form onSubmit={handleAdd} className="flex-col gap-4">
                    <div>
                    <label className="text-muted" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.9rem' }}>Nama Item *</label>
                    <input
                        type="text" required className="input-field"
                        placeholder="Contoh: Kertas Thermal, QCP, Plastik 1..."
                        value={newItem.name}
                        onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                    />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div>
                        <label className="text-muted" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.9rem' }}>Satuan</label>
                        <input
                        type="text" className="input-field"
                        placeholder="pcs / lembar / roll"
                        value={newItem.unit}
                        onChange={e => setNewItem({ ...newItem, unit: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="text-muted" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.9rem' }}>Kategori</label>
                        <select className="input-field" value={newItem.category} onChange={e => setNewItem({ ...newItem, category: e.target.value })}>
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                    </div>
                    <div>
                        <label className="text-muted" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.9rem' }}>Urutan Tampilan (Display Order)</label>
                        <input type="number" className="input-field" value={newItem.display_order} onChange={e => setNewItem({ ...newItem, display_order: e.target.value })} placeholder="0" />
                    </div>
                    <div className="flex justify-between mt-6">
                    <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Batal</button>
                    <button type="submit" disabled={saving} className="btn-primary">
                        <Icon name="save" size={16} /> {saving ? 'Menyimpan...' : 'Simpan Item'}
                    </button>
                    </div>
                </form>
                </div>
            )}

            {delModalOpen && (
                <div className="glass-panel mb-6 animate-fade-in" style={{ border: '2px solid var(--danger)', padding: '1.5rem' }}>
                    <h2 className="mb-4 text-danger">Konfirmasi Hapus</h2>
                    <p className="text-muted mb-6">
                    Apakah Anda yakin ingin menghapus <strong>"{selectedForDelete?.name}"</strong> dari master operasional?
                    </p>
                    <div className="flex justify-between">
                    <button onClick={() => setDelModalOpen(false)} className="btn-secondary">Batal</button>
                    <button 
                        onClick={confirmDelete} 
                        disabled={saving} 
                        className="btn-danger"
                    >
                        {saving ? 'Menghapus...' : 'Ya, Hapus'}
                    </button>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
                <p className="text-muted">Memuat data operasional...</p>
                </div>
            ) : items.length === 0 ? (
                <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center' }}>
                <Icon name="wrench" size={40} opacity={0.3} style={{ margin: '0 auto 1rem' }} />
                <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Belum ada item operasional</p>
                <p className="text-muted" style={{ fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                    Tambahkan item seperti Kertas Thermal, Plastik, Form Stok, QCP, dll.
                </p>
                <button onClick={() => setModalOpen(true)} className="btn-primary">
                    <Icon name="plus" size={16} /> Tambah Item Pertama
                </button>
                </div>
            ) : (
                <div className="glass-panel table-responsive" style={{ overflowX: 'auto', overflowY: 'hidden' }}>
                    <table className="data-table" style={{ marginTop: 0, minWidth: '800px' }}>
                    <thead style={{ backgroundColor: 'rgba(0,0,0,0.03)' }}>
                        <tr>
                        <th style={{ width: '50px' }}>No</th>
                        <th>Nama Item</th>
                        <th>Kategori</th>
                        <th>Satuan</th>
                        <th style={{ textAlign: 'center' }}>Stok Saat Ini</th>
                        <th style={{ width: '100px', textAlign: 'center' }}>Aksi</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.sort((a, b) => a.display_order - b.display_order).map((item, idx) => {
                            const qty = getStockQty(item.name);
                            return (
                            <tr key={item.id}>
                                <td style={{ textAlign: 'center', fontWeight: 600, color: 'var(--text-muted)' }}>
                                    {idx + 1}
                                </td>
                                <td style={{ fontWeight: 600 }}>{item.name}</td>
                                <td className="text-muted">{item.category}</td>
                                <td className="text-muted">{item.unit}</td>
                                <td style={{ textAlign: 'center', fontSize: '1.05rem', fontWeight: 700 }}>
                                    {qty !== null ? qty : '—'}
                                </td>
                                <td style={{ textAlign: 'center', display: 'flex', justifyContent: 'center', gap: '0.5rem' }}>
                                <button
                                    onClick={() => handleEdit(item)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', padding: '0.3rem' }}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                </button>
                                <button
                                    onClick={() => handleDelete(item.id, item.name)}
                                    className="btn-danger"
                                    style={{ padding: '0.35rem' }}
                                >
                                    <Icon name="trash" size={16} />
                                </button>
                                </td>
                            </tr>
                            );
                        })}
                    </tbody>
                    </table>
                </div>
            )}


          </>
      ) : activeTab === 'stock' ? (
          <>
            <div className="flex justify-between items-center mb-4" style={{ gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flex: 1, backgroundColor: 'var(--panel-bg)', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <Icon name="store" size={20} className="text-muted" />
                    <select className="input-field" style={{ maxWidth: '180px', marginBottom: 0 }} value={selectedBranch} onChange={handleBranchChange}>
                        {branches.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
                    </select>
                    <button onClick={() => fetchInventory(selectedBranch)} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer' }}>
                        <Icon name="refresh" size={18} />
                    </button>
                    
                    <div style={{ width: '1px', height: '24px', backgroundColor: 'var(--border-color)', margin: '0 0.5rem' }}></div>
                    
                    <Icon name="search" size={18} className="text-muted" />
                    <input 
                        type="text" 
                        style={{ marginBottom: 0, border: 'none', background: 'transparent', padding: '0', outline: 'none', boxShadow: 'none', flex: 1, fontSize: '0.95rem' }} 
                        placeholder="Cari item operasional..." 
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="flex gap-2">
                    <button onClick={() => setRestockOpen(true)} className="btn-secondary">
                        <Icon name="plus" size={18} /> Restock
                    </button>
                    <button onClick={handleSaveAllStock} disabled={saving} className="btn-primary">
                        <Icon name="save" size={18} /> {saving ? 'Menyimpan...' : 'Simpan Stok'}
                    </button>
                </div>
            </div>

            {isRestockOpen && (
                <div className="glass-panel mb-6 animate-fade-in" style={{ border: '2px solid var(--primary)', padding: '1.5rem' }}>
                <h2 className="mb-4 text-primary">Tambah Stok Operasional</h2>
                <form onSubmit={handleRestock} className="flex-col gap-4">
                    <div>
                    <label className="text-muted" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Nama Item</label>
                    <select className="input-field" value={restock.item_name} onChange={e => setRestock({...restock, item_name: e.target.value})}>
                        {items.map(i => <option key={i.name} value={i.name}>{i.name}</option>)}
                    </select>
                    </div>
                    <div>
                    <label className="text-muted" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Jumlah Masuk (Unit)</label>
                    <input type="text" required className="input-field" placeholder="Contoh: 24 atau 1 1/2" value={restock.qty} onChange={e => setRestock({...restock, qty: e.target.value})} />
                    </div>
                    <div className="flex justify-between mt-6">
                    <button type="button" onClick={() => setRestockOpen(false)} className="btn-secondary">Batal</button>
                    <button type="submit" disabled={saving} className="btn-primary">
                        {saving ? 'Menyimpan...' : '+ Tambahkan ke Stok'}
                    </button>
                    </div>
                </form>
                </div>
            )}

            <div className="glass-panel table-responsive" style={{ overflowX: 'auto', overflowY: 'hidden' }}>
                <table className="data-table" style={{ marginTop: 0, minWidth: '800px' }}>
                <thead style={{ backgroundColor: 'rgba(0,0,0,0.03)' }}>
                    <tr>
                    <th>No</th>
                    <th>Nama Item Operasional</th>
                    <th style={{ textAlign: 'center' }}>Stok Saat Ini</th>
                    <th style={{ textAlign: 'center' }}>Status</th>
                    <th style={{ width: '180px' }}>Update Stok Manual</th>
                    </tr>
                </thead>
                <tbody>
                    {loading ? (
                    <tr><td colSpan={5} className="text-center text-muted py-8">Memuat data inventaris...</td></tr>
                    ) : inventory.length === 0 ? (
                        <tr><td colSpan={5} className="text-center text-muted py-8">Belum ada item. Tambahkan di Master Item.</td></tr>
                    ) : inventory.filter(item => item.item_name.toLowerCase().includes(searchTerm.toLowerCase())).map((item, idx) => {
                    const qty = item.current_qty;
                    const parsedQty = parseQty(qty);
                    const isLow = qty !== null && qty !== '' && parsedQty <= 10;
                    const isNotSet = qty === null || qty === '';
                    
                    return (
                        <tr key={item.item_name}>
                        <td className="text-muted" style={{ width: '40px' }}>{idx + 1}</td>
                        <td style={{ fontWeight: 600 }}>{item.item_name}</td>
                        <td style={{ textAlign: 'center', fontSize: '1.1rem', fontWeight: 700, fontFamily: 'monospace', color: isLow ? 'var(--danger)' : isNotSet ? 'var(--text-muted)' : 'inherit' }}>
                            {isNotSet ? '—' : qty}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                            {isNotSet ? (
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Belum diset</span>
                            ) : isLow ? (
                            <span style={{ backgroundColor: 'rgba(255, 56, 60,0.1)', color: 'var(--danger)', padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 700 }}>Menipis</span>
                            ) : (
                            <span style={{ backgroundColor: 'rgba(52, 199, 89,0.1)', color: 'var(--primary)', padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 700 }}>Aman</span>
                            )}
                        </td>
                        <td>
                            <input
                            type="text"
                            className="input-field"
                            style={{ padding: '0.4rem 0.6rem', fontSize: '0.9rem' }}
                            placeholder="Set qty"
                            value={qty ?? ''}
                            onChange={e => handleQtyChange(item.item_name, e.target.value)}
                            />
                        </td>
                        </tr>
                    );
                    })}
                </tbody>
                </table>
            </div>
          </>
      ) : null}

    </div>
  );
}
