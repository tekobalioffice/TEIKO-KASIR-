import React, { useState, useEffect } from 'react';
import Icon from '../components/Icon';
import { supabase } from '../supabase';
import { exportMultipleShiftsToExcel } from '../utils/exportExcel';
import { useAuth } from '../contexts/AuthContext';

export default function AdminBranches() {
  const { userData } = useAuth();
  const isAdmin = (userData?.role === 'admin' || userData?.role === 'owner');
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setModalOpen] = useState(false);
  const [newBranch, setNewBranch] = useState({ name: '', address: '' });
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  
  // Deletion Safety States
  const [delModalOpen, setDelModalOpen] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [branchReports, setBranchReports] = useState([]);
  const [checkingData, setCheckingData] = useState(false);

  useEffect(() => {
    fetchBranches();
  }, []);

  const fetchBranches = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.from('outlets').select('*');
      if (error) throw error;
      setBranches(data || []);
    } catch (error) {
      console.error('Error fetching branches:', error);
      alert(`Gagal mengambil data cabang:\n${error.message || JSON.stringify(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAddBranch = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      
      let error;
      if (editingId) {
        // Update existing
        const { error: updateErr } = await supabase.from('outlets').update({
          name: newBranch.name,
          address: newBranch.address
        }).eq('id', editingId);
        error = updateErr;
      } else {
        // Insert new
        const { error: insertErr } = await supabase.from('outlets').insert([{
          name: newBranch.name,
          address: newBranch.address
        }]);
        error = insertErr;
      }

      if (error) throw error;
      
      await fetchBranches();
      
      setModalOpen(false);
      setEditingId(null);
      setNewBranch({ name: '', address: '' });
    } catch (error) {
       console.error('Error saving branch:', error);
       alert(`Gagal menyimpan cabang:\n${error.message || JSON.stringify(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (branch) => {
    setNewBranch({ name: branch.name, address: branch.address || '' });
    setEditingId(branch.id);
    setDelModalOpen(false);
    setModalOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (branch) => {
    setSelectedBranch(branch);
    setModalOpen(false);
    setDelModalOpen(true);
    setCheckingData(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    try {
      // Check for existing reports
      const { data } = await supabase.from('sales_reports').select('*').eq('branch_name', branch.name);
      setBranchReports(data || []);
    } catch (err) {
      console.error("Error checking reports:", err);
    } finally {
      setCheckingData(false);
    }
  };

  const confirmDelete = async () => {
    if (!selectedBranch) return;
    setSaving(true);
    try {
      // 1. Delete associated inventory and all historical forms/reports
      await supabase.from('branch_inventory').delete().eq('branch_name', selectedBranch.name);
      await supabase.from('sales_reports').delete().eq('branch_name', selectedBranch.name);
      await supabase.from('stock_restock_log').delete().eq('branch_name', selectedBranch.name);
      await supabase.from('stock_distributions').delete().eq('to_branch', selectedBranch.name);
      
      // Hapus data operan yang menggantung (baik sebagai pengirim maupun penerima)
      await supabase.from('pending_stock_actions').delete().or(`source_branch.eq.${selectedBranch.name},target_branch.eq.${selectedBranch.name}`);
      
      // Hapus akun staff yang bertugas di cabang ini
      await supabase.from('users').delete().eq('branch', selectedBranch.name);
      
      // 2. Delete the branch itself
      const { error } = await supabase.from('outlets').delete().eq('id', selectedBranch.id);

      if (error) throw error;

      // Bersihkan localStorage draft agar tidak muncul sebagai sisa inputan lama
      // jika branch baru dibuat dengan nama yang sama
      ['1', '2', '3'].forEach(s => localStorage.removeItem(`pos_draft_${selectedBranch.name}_shift${s}`));
      localStorage.removeItem(`admin_inventory_draft_${selectedBranch.name}`);

      await fetchBranches();
      setDelModalOpen(false);
      setSelectedBranch(null);
    } catch (error) {
      console.error('Error deleting branch:', error);
      alert('Gagal menghapus cabang. Pastikan tidak ada data laporan yang masih tertaut jika DB memiliki constraint.');
    } finally {
      setSaving(false);
    }
  };

  const handleBackup = () => {
    if (branchReports.length === 0) return;
    exportMultipleShiftsToExcel(branchReports);
  };



  return (
    <div className="animate-fade-in">
      <div className="page-title flex justify-between items-center">
        <div>
          <h1 className="text-primary mb-1">Kelola Cabang Fisik</h1>
          <p className="text-muted">Manajemen 10+ cabang outlet Teiko.</p>
        </div>
        {isAdmin && (
          <button onClick={() => {
              setEditingId(null);
              setNewBranch({ name: '', address: '' });
              setDelModalOpen(false);
              setModalOpen(true);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }} className="btn-primary">
            <Icon name="plus" size={18} /> Tambah Cabang Baru
          </button>
        )}
      </div>

      {isModalOpen && (
        <div className="glass-panel mb-6 animate-fade-in" style={{ border: '2px solid var(--primary)', padding: '1.5rem' }}>
          <h2 className="mb-4 text-primary">{editingId ? 'Edit Cabang' : 'Tambah Cabang Outlet'}</h2>
          <form onSubmit={handleAddBranch} className="flex-col gap-4">
            <div>
              <label className="text-muted" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Nama Cabang</label>
              <input type="text" className="input-field" required value={newBranch.name} onChange={e => setNewBranch({...newBranch, name: e.target.value})} placeholder="Cabang Seturan" />
            </div>
            <div>
              <label className="text-muted" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Alamat Lengkap</label>
              <textarea className="input-field" required value={newBranch.address} onChange={e => setNewBranch({...newBranch, address: e.target.value})} placeholder="Jl. Seturan Raya No..." style={{ minHeight: '80px', resize: 'vertical' }}></textarea>
            </div>
            
            <div className="flex justify-between mt-4">
              <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Batal</button>
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? 'Menyimpan...' : (editingId ? 'Update Cabang' : 'Simpan Cabang')}
              </button>
            </div>
          </form>
        </div>
      )}

      {delModalOpen && (
        <div className="glass-panel mb-6 animate-fade-in" style={{ border: '2px solid var(--danger)', padding: '1.5rem' }}>
          <h2 className="mb-4 text-danger" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Icon name="alert-circle" color="var(--danger)" /> Konfirmasi Hapus Cabang
          </h2>
          
          <p className="mb-4">
            Apakah Anda yakin ingin menghapus cabang <strong>{selectedBranch?.name}</strong>? Tindakan ini tidak dapat dibatalkan.
          </p>

          {checkingData ? (
            <p className="text-muted mb-6 italic">Memeriksa data transaksi terkait...</p>
          ) : branchReports.length > 0 ? (
            <div style={{ backgroundColor: 'rgba(255, 149, 0,0.1)', border: '1px solid #ff9500', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem' }}>
              <p style={{ fontWeight: 700, color: '#9a3412', marginBottom: '0.5rem', fontSize: '0.9rem' }}>DATA TRANSAKSI DITEMUKAN!</p>
              <p style={{ fontSize: '0.85rem', marginBottom: '1rem', color: '#9a3412' }}>
                Terdapat <strong>{branchReports.length} laporan penjualan</strong> terkait cabang ini. Admin <strong>sangat disarankan</strong> mndownload backup sebelum menghapus.
              </p>
              <button 
                onClick={handleBackup}
                className="btn-secondary" 
                style={{ width: '100%', backgroundColor: 'white', display: 'flex', justifyContent: 'center', gap: '0.5rem', fontWeight: 600 }}
              >
                <Icon name="download" size={16} /> Download Backup (.xlsx)
              </button>
            </div>
          ) : (
            <p className="text-success mb-6" style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Icon name="check-circle" size={14} /> Tidak ada data laporan penjualan yang tertaut pada cabang ini.
            </p>
          )}

          <div className="flex justify-between">
            <button onClick={() => setDelModalOpen(false)} className="btn-secondary">Batal</button>
            <button 
              onClick={confirmDelete} 
              disabled={saving || checkingData} 
              className="btn-danger"
            >
              {saving ? 'Menghapus...' : 'Ya, Hapus Permanen'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-muted text-center py-8">Memuat data cabang...</p>
      ) : branches.length === 0 ? (
        <p className="text-muted text-center py-8">Belum ada cabang terdaftar.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.5rem' }}>
          {branches.map(branch => (
            <div key={branch.id} className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div style={{ backgroundColor: 'rgba(9, 108, 70, 0.1)', color: 'var(--primary)', padding: '0.75rem', borderRadius: '12px' }}>
                    <Icon name="store" size={24} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{branch.name}</h3>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2 text-muted mb-4" style={{ fontSize: '0.9rem' }}>
                <Icon name="map-pin" size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                <p>{branch.address}</p>
              </div>

              <div style={{ marginTop: 'auto', borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: '1rem', display: 'flex', justifyItems: 'center', justifyContent: 'space-between', alignItems: 'center' }}>

                 {isAdmin && (
                   <div className="flex gap-2 justify-end">
                     <button onClick={() => handleEdit(branch)} className="btn-secondary" style={{ padding: '0.4rem', borderColor: 'transparent' }} title="Edit"><Icon name="edit" size={16} /></button>
                      <button onClick={() => handleDelete(branch)} className="btn-danger" style={{ padding: '0.4rem' }} title="Hapus"><Icon name="trash" size={16} /></button>
                   </div>
                 )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
