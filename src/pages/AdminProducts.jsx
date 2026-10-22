import React, { useState, useEffect } from 'react';
import Icon from '../components/Icon';
import { supabase } from '../supabase';

export default function AdminProducts() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setModalOpen] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: '', category: 'Drink', variant: 'Standar', price: '', image_url: '', is_unlimited: false, is_dual_base: false, is_non_base: false, susu_add_price: 0, display_order: 0, gojek_price: '', grab_price: '' });
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [delModalOpen, setDelModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  
  // Bulk States
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkCategory, setBulkCategory] = useState('');

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.from('products').select('*').order('category').order('display_order', { ascending: true, nullsFirst: false }).order('name');
      if (error) throw error;
      setProducts(data || []);
    } catch (error) {
      console.error('Error fetching products:', error);
      alert(`Gagal mengambil data produk:\n${error.message || JSON.stringify(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAddProduct = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);

      const productData = {
        name: newProduct.name,
        category: newProduct.category,
        variant: newProduct.variant || 'Standar',
        price: parseInt(newProduct.price) || 0,
        image_url: newProduct.image_url || null,
        is_unlimited: newProduct.is_unlimited,
        is_dual_base: newProduct.is_dual_base || false,
        is_non_base: newProduct.is_non_base || false,
        susu_add_price: parseInt(newProduct.susu_add_price) || 0,
        display_order: parseInt(newProduct.display_order) || 0
      };

      let error;
      let productId = editingId;
      if (editingId) {
        const { error: updateErr } = await supabase.from('products').update(productData).eq('id', editingId);
        error = updateErr;
      } else {
        const { data: inserted, error: insertErr } = await supabase.from('products').insert([productData]).select().single();
        error = insertErr;
        productId = inserted?.id;
      }

      if (error) {
        if (error.code === 'PGRST204' || error.message?.includes('image_url')) {
          throw new Error("Kolom 'image_url' belum ada di tabel 'products' database Supabase Anda. Anda harus menambahkannya terlebih dahulu melalui Supabase Dashboard.");
        }
        throw error;
      }

      if (productId) await saveChannelPrices(productId);

      await fetchProducts();
      setModalOpen(false);
      setEditingId(null);
      setNewProduct({ name: '', category: 'Drink', variant: 'Standar', price: '', image_url: '', is_unlimited: false, is_dual_base: false, is_non_base: false, susu_add_price: 0, display_order: 0, gojek_price: '', grab_price: '' });
    } catch (error) {
      console.error('Error adding product:', error);
      alert(`Gagal menyimpan produk:\n${error.message || JSON.stringify(error)}`);
    } finally {
      setSaving(false);
    }
  };

  // Harga khusus Gojek/Grab: kosong = pakai harga normal (hapus baris override-nya).
  const saveChannelPrices = async (productId) => {
    const entries = [
      ['gojek', newProduct.gojek_price],
      ['grab', newProduct.grab_price],
    ];
    for (const [channel, val] of entries) {
      const price = parseInt(val);
      if (val === '' || val == null || !price) {
        await supabase.from('product_channel_prices').delete().eq('product_id', productId).eq('channel', channel);
      } else {
        await supabase.from('product_channel_prices').upsert([{ product_id: productId, channel, price }]);
      }
    }
  };

  const handleImageUpload = async (e) => {
    try {
      if (!e.target.files || e.target.files.length === 0) return;
      const file = e.target.files[0];
      if (file.size > 2 * 1024 * 1024) {
        alert('Ukuran file maksimal 2MB');
        return;
      }
      setUploadingImage(true);

      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(2)}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage.from('products').upload(filePath, file);

      if (uploadError) {
        if (uploadError.message.includes('bucket')) {
           throw new Error("Bucket storage 'products' belum dibuat di Supabase Anda atau belum diset Public. Buat terlebih dahulu di menu Storage.");
        }
        throw uploadError;
      }

      const { data } = supabase.storage.from('products').getPublicUrl(filePath);
      
      setNewProduct({...newProduct, image_url: data.publicUrl});
    } catch (error) {
      alert('Error mengunggah foto:\n' + error.message);
    } finally {
      setUploadingImage(false);
    }
  };

  const handleEdit = async (prod) => {
    const { data: channelPrices } = await supabase.from('product_channel_prices').select('channel, price').eq('product_id', prod.id);
    const gojek = channelPrices?.find(c => c.channel === 'gojek');
    const grab = channelPrices?.find(c => c.channel === 'grab');
    setNewProduct({
      name: prod.name,
      category: prod.category || 'Drink',
      variant: prod.variant || 'Standar',
      price: prod.price || '',
      image_url: prod.image_url || '',
      is_unlimited: prod.is_unlimited || false,
      is_dual_base: prod.is_dual_base || false,
      is_non_base: prod.is_non_base || false,
      susu_add_price: prod.susu_add_price || 0,
      display_order: prod.display_order || 0,
      gojek_price: gojek?.price ?? '',
      grab_price: grab?.price ?? ''
    });
    setEditingId(prod.id);
    setDelModalOpen(false);
    setModalOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = (prod) => {
    setSelectedProduct(prod);
    setModalOpen(false);
    setDelModalOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const confirmDelete = async () => {
    if (!selectedProduct) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.from('products').delete().eq('id', selectedProduct.id).select();
      if (error) throw error;

      if (!data || data.length === 0) {
        throw new Error("Penghapusan diblokir oleh sistem database (Row Level Security). Anda perlu menambahkan policy DELETE di Supabase.");
      }

      await fetchProducts();
      setDelModalOpen(false);
      setSelectedProduct(null);
      alert("Produk berhasil dihapus.");
    } catch (error) {
      console.error('Error deleting:', error);
      alert('Gagal menghapus produk dari database:\n' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === products.length) setSelectedIds([]);
    else setSelectedIds(products.map(p => p.id));
  };

  const handleBulkUpdate = async () => {
    if (selectedIds.length === 0 || !bulkCategory) {
      alert('Pilih produk dan kategori tujuan terlebih dahulu.');
      return;
    }
    
    if (!confirm(`Ganti kategori ${selectedIds.length} produk menjadi "${bulkCategory}"?`)) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('products')
        .update({ category: bulkCategory })
        .in('id', selectedIds);
      
      if (error) throw error;
      
      await fetchProducts();
      setSelectedIds([]);
      setBulkCategory('');
      alert(`${selectedIds.length} produk berhasil diperbarui!`);
    } catch (err) {
      alert('Gagal update massal:\n' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="page-title flex justify-between items-center">
        <div>
          <h1 className="text-primary mb-1">Master Menu & Produk</h1>
          <p className="text-muted">Kelola harga, foto, dan kategori minuman atau topping.</p>
        </div>
        <button onClick={() => {
            setEditingId(null);
            setNewProduct({ name: '', category: 'Drink', variant: 'Standar', price: '', image_url: '', is_unlimited: false, is_dual_base: false, is_non_base: false, susu_add_price: 0, display_order: 0, gojek_price: '', grab_price: '' });
            setDelModalOpen(false);
            setModalOpen(true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }} className="btn-primary">
          <Icon name="plus" size={18} /> Tambah Menu Baru
        </button>
      </div>
      
      {/* Bulk Action Bar */}
      {selectedIds.length > 0 && (
        <div className="glass-panel mb-6 animate-fade-in" style={{ padding: '1.25rem', border: '2px solid var(--primary)', display: 'flex', gap: '1rem', alignItems: 'center', backgroundColor: 'rgba(9, 108, 70, 0.05)', borderRadius: '12px' }}>
          <div style={{ fontWeight: 800, color: 'var(--primary)', fontSize: '1rem', flexShrink: 0 }}>
             {selectedIds.length} Item Terpilih
          </div>
          <div style={{ height: '30px', width: '2px', backgroundColor: 'var(--border-color)' }}></div>
          <span className="text-muted" style={{ fontSize: '0.9rem', fontWeight: 600 }}>Ubah Kategori Ke:</span>
          <select className="input-field" style={{ width: '220px', marginBottom: 0 }} value={bulkCategory} onChange={e => setBulkCategory(e.target.value)}>
            <option value="">-- Pilih Kategori --</option>
            <option value="Drink">Minuman Utama</option>
            <option value="Tea Series">Tea Series</option>
            <option value="Coffee Series">Coffee Series</option>
            <option value="Milky Series">Milky Series</option>
            <option value="Sachet Series">Sachet Series</option>
            <option value="Hot Series">Hot Series</option>
            <option value="Choco Series">Choco Series</option>
            <option value="Topping">Topping / Ekstra</option>
          </select>
          <button onClick={handleBulkUpdate} disabled={saving || !bulkCategory} className="btn-primary" style={{ padding: '0.6rem 1.25rem' }}>
            Terapkan Sekaligus
          </button>
          <button onClick={() => setSelectedIds([])} className="btn-secondary" style={{ padding: '0.6rem 1rem' }}>
            Batal
          </button>
        </div>
      )}

      {isModalOpen && (
        <div className="glass-panel mb-6 animate-fade-in" style={{ border: '2px solid var(--primary)', padding: '1.5rem' }}>
          <h2 className="mb-4 text-primary">{editingId ? 'Edit Menu' : 'Tambah Menu Baru'}</h2>
          <form onSubmit={handleAddProduct} className="flex-col gap-4">
            
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
               <label style={{ width: '100px', height: '100px', backgroundColor: 'rgba(0,0,0,0.03)', border: '2px dashed rgba(0,0,0,0.1)', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: uploadingImage ? 'not-allowed' : 'pointer', position: 'relative', overflow: 'hidden' }}>
                 {uploadingImage ? (
                   <span style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600 }}>Loading...</span>
                 ) : newProduct.image_url ? (
                   <img src={newProduct.image_url} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                 ) : (
                   <>
                     <Icon name="image" size={24} className="text-muted mb-2" />
                     <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Upload Foto</span>
                   </>
                 )}
                 <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} disabled={uploadingImage} />
               </label>
            </div>

            <div>
              <label className="text-muted" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Nama Produk</label>
              <input type="text" className="input-field" required value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} placeholder="Matcha Latte" />
            </div>

            <div>
              <label className="text-muted" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Kategori</label>
              <select className="input-field" value={newProduct.category} onChange={e => setNewProduct({...newProduct, category: e.target.value})}>
                <option value="Drink">Minuman Utama</option>
                <option value="Tea Series">Tea Series</option>
                <option value="Coffee Series">Coffee Series</option>
                <option value="Milky Series">Milky Series</option>
                <option value="Sachet Series">Sachet Series</option>
                <option value="Hot Series">Hot Series</option>
                <option value="Choco Series">Choco Series</option>
                <option value="Topping">Topping / Ekstra</option>
              </select>
            </div>

            <div>
              <label className="text-muted" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Varian Produk</label>
              <select className="input-field" value={newProduct.variant} onChange={e => setNewProduct({...newProduct, variant: e.target.value})}>
                <option value="Standar">Standar (tidak ada varian)</option>
                <option value="Ori">Ori</option>
                <option value="Premi">Premi</option>
                <option value="Sachet Ori">Sachet Ori</option>
                <option value="Sachet Premi">Sachet Premi</option>
              </select>
            </div>

            <div>
              <label className="text-muted" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Harga</label>
              <input type="number" className="input-field" required value={newProduct.price} onChange={e => setNewProduct({...newProduct, price: e.target.value})} placeholder="Rp" />
            </div>

            <div>
              <label className="text-muted" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Harga Khusus Gojek / Grab (opsional)</label>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <input type="number" className="input-field" value={newProduct.gojek_price} onChange={e => setNewProduct({...newProduct, gojek_price: e.target.value})} placeholder="Gojek — kosongkan = harga normal" style={{ marginBottom: 0 }} />
                <input type="number" className="input-field" value={newProduct.grab_price} onChange={e => setNewProduct({...newProduct, grab_price: e.target.value})} placeholder="Grab — kosongkan = harga normal" style={{ marginBottom: 0 }} />
              </div>
            </div>

            <div>
              <label className="text-muted" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Urutan Tampilan (Display Order)</label>
              <input type="number" className="input-field" value={newProduct.display_order} onChange={e => setNewProduct({...newProduct, display_order: e.target.value})} placeholder="0" />
              <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>Angka lebih kecil akan muncul lebih atas.</p>
            </div>

            <div>
              <label className="text-muted" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Base Produk (Untuk Perhitungan Cup)</label>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', paddingRight: '1rem' }}>
                      <input 
                          type="radio" 
                          name="base_type" 
                          checked={!newProduct.is_unlimited && !newProduct.is_dual_base && !newProduct.is_non_base} 
                          onChange={() => setNewProduct({ ...newProduct, is_unlimited: false, is_dual_base: false, is_non_base: false })} 
                      />
                      <span>Teh Base (Default)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', paddingRight: '1rem' }}>
                      <input 
                          type="radio" 
                          name="base_type" 
                          checked={newProduct.is_unlimited && !newProduct.is_dual_base && !newProduct.is_non_base} 
                          onChange={() => setNewProduct({ ...newProduct, is_unlimited: true, is_dual_base: false, is_non_base: false })} 
                      />
                      <span>Susu Base (Memotong Cup Es Teh)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', paddingRight: '1rem' }}>
                      <input 
                          type="radio" 
                          name="base_type" 
                          checked={newProduct.is_dual_base && !newProduct.is_non_base} 
                          onChange={() => setNewProduct({ ...newProduct, is_unlimited: false, is_dual_base: true, is_non_base: false })} 
                      />
                      <span>Dual Base (Teh & Susu)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input 
                          type="radio" 
                          name="base_type" 
                          checked={newProduct.is_non_base} 
                          onChange={() => setNewProduct({ ...newProduct, is_unlimited: false, is_dual_base: false, is_non_base: true })} 
                      />
                      <span>Non Base (Tidak Potong Cup)</span>
                  </label>
              </div>
            </div>

            {newProduct.is_dual_base && (
              <div className="animate-fade-in" style={{ backgroundColor: 'rgba(255, 204, 0,0.1)', padding: '1rem', borderRadius: '8px', border: '1px dashed #ff9500', marginTop: '0.5rem' }}>
                <label className="text-muted" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#9a3412', fontWeight: 600 }}>Penambahan Harga Jika Pelanggan Pakai Susu</label>
                <input type="number" className="input-field" value={newProduct.susu_add_price} onChange={e => setNewProduct({...newProduct, susu_add_price: e.target.value})} placeholder="Rp (misal: 3000)" style={{ marginBottom: 0, borderColor: '#ffd426' }} />
                <p style={{ fontSize: '0.75rem', marginTop: '0.5rem', color: '#9a3412' }}>*Jika pelanggan memakai teh, harganya normal (Sesuai Harga produk di atas). Harga tambahan ini akan ditambahkan otomatis di kasir.</p>
              </div>
            )}
            
            <div className="flex justify-between mt-6">
              <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Batal</button>
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? 'Menyimpan...' : (editingId ? 'Update Menu' : 'Simpan Menu')}
              </button>
            </div>
          </form>
        </div>
      )}

      {delModalOpen && (
        <div className="glass-panel mb-6 animate-fade-in" style={{ border: '2px solid var(--danger)', padding: '1.5rem' }}>
          <h2 className="mb-4 text-danger">Konfirmasi Hapus</h2>
          <p className="text-muted mb-6">
            Apakah Anda yakin ingin menghapus produk <strong>"{selectedProduct?.name}"</strong> secara permanen?
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

      <div className="glass-panel table-responsive" style={{ overflowX: 'auto', overflowY: 'hidden' }}>
        <table className="data-table" style={{ marginTop: 0, minWidth: '680px', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ width: '36px' }}>
                <input type="checkbox" checked={selectedIds.length === products.length && products.length > 0} onChange={toggleSelectAll} />
              </th>
              <th style={{ width: '52px' }}>Foto</th>
              <th>Nama Item</th>
              <th>Kategori</th>
              <th>Varian</th>
              <th>Harga</th>
              <th className="text-center">Urutan</th>
              <th className="text-center">Base Produk</th>
              <th className="text-center">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="9" className="text-center text-muted py-8">Memuat data dari Supabase...</td></tr>
            ) : products.length === 0 ? (
              <tr><td colSpan="9" className="text-center text-muted py-8">Belum ada produk. Silakan tambah baru.</td></tr>
            ) : products.map(prod => (
              <tr key={prod.id} style={selectedIds.includes(prod.id) ? { backgroundColor: 'rgba(13, 111, 255, 0.08)' } : undefined}>
                <td>
                  <input type="checkbox" checked={selectedIds.includes(prod.id)} onChange={() => toggleSelect(prod.id)} />
                </td>
                <td>
                  <div style={{ width: '40px', height: '40px', backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', overflow: 'hidden' }}>
                    {prod.image_url ? (
                      <img src={prod.image_url} alt={prod.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <Icon name="image" size={20} />
                    )}
                  </div>
                </td>
                <td style={{ fontWeight: 600 }}>{prod.name}</td>
                <td>
                  <span style={{
                    backgroundColor: 'var(--fill-subtle)', color: 'var(--text-muted)',
                    padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.82rem', fontWeight: 600
                  }}>
                    {prod.category}
                  </span>
                </td>
                <td>
                  <span style={{
                    backgroundColor: 'var(--fill-subtle)', color: 'var(--text-muted)',
                    padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.82rem', fontWeight: 600
                  }}>
                    {prod.variant || 'Standar'}
                  </span>
                </td>
                <td style={{ fontWeight: 600 }}>Rp {(prod.price || 0).toLocaleString('id-ID')}</td>
                <td className="text-center" style={{ fontWeight: 600, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {prod.display_order || 0}
                </td>
                <td className="text-center">
                    <span style={{ backgroundColor: 'var(--fill-subtle)', color: 'var(--text-muted)', padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600 }}>
                      {prod.is_non_base ? 'Non Base' : prod.is_dual_base ? `Dual Base (+Rp${prod.susu_add_price?.toLocaleString('id-ID')})` : prod.is_unlimited ? 'Susu Base' : 'Teh Base'}
                    </span>
                </td>
                <td className="text-center">
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem' }}>
                    <button onClick={() => handleEdit(prod)} className="btn-secondary" style={{ padding: '0.4rem', borderColor: 'transparent' }} title="Edit"><Icon name="edit" size={16} /></button>
                    <button onClick={() => handleDelete(prod)} className="btn-danger" style={{ padding: '0.4rem' }} title="Hapus"><Icon name="trash" size={16} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
