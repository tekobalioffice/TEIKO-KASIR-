import React, { useState, useEffect } from 'react';
import Icon from '../components/Icon';
import { supabase, supabaseAdminAuth } from '../supabase';

export default function AdminStaff() {
  const [staffList, setStaffList] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setModalOpen] = useState(false);
  const [newStaff, setNewStaff] = useState({ name: '', email: '', username: '', password: '', branch: 'Semua Cabang', role: 'branch' });
  const [saving, setSaving] = useState(false);
  const [delModalOpen, setDelModalOpen] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [editingId, setEditingId] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      // Fetch staff profiles
      const { data: usersData, error: usersErr } = await supabase.from('users').select('id, name, branch, role, username, email').neq('role', 'admin');
      if (usersErr) throw usersErr;
      setStaffList(usersData || []);

      // Fetch branches for dropdown
      const { data: branchesData, error: branchesErr } = await supabase.from('outlets').select('name');
      if (branchesErr) throw branchesErr;
      setBranches(branchesData || []);

      if (branchesData && branchesData.length > 0) {
        setNewStaff(prev => ({ ...prev, branch: branchesData[0].name }));
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddStaff = async (e) => {
    e.preventDefault();

    try {
      setSaving(true);

      if (editingId) {
        // Update existing profile (name and branch)
        const { data: profileData, error: profileError } = await supabase
          .from('users')
          .update({
            name: newStaff.name,
            username: newStaff.username.trim() || null,
            branch: ['gudang', 'owner'].includes(newStaff.role) ? 'Pusat' : newStaff.branch,
            role: newStaff.role
          })
          .eq('id', editingId)
          .select('id, name, branch, role, username, email');

        if (profileError) throw profileError;

        setStaffList(staffList.map(s => s.id === editingId ? profileData[0] : s));
        alert("Data karyawan berhasil diperbarui!");
      } else {
        // 1. Create user in Supabase Auth using the secondary client (so admin isn't logged out)
        const { data: authData, error: authError } = await supabaseAdminAuth.auth.signUp({
          email: newStaff.email.trim(),
          password: newStaff.password,
        });

        if (authError) {
          if (authError.message.includes("already registered")) {
            alert("Email ini sudah terdaftar!");
            return;
          }
          throw authError;
        }

        if (!authData.user) {
          throw new Error("Gagal membuat user auth.");
        }

        const { data: profileData, error: profileError } = await supabase.from('users').insert([{
          id: authData.user.id,
          name: newStaff.name,
          username: newStaff.username.trim() || null,
          email: newStaff.email.trim(),
          role: newStaff.role,
          branch: ['gudang', 'owner'].includes(newStaff.role) ? 'Pusat' : newStaff.branch
        }]).select('id, name, branch, role, username, email');

        if (profileError) throw profileError;

        setStaffList([...staffList, profileData[0]]);
        alert("Akun staf berhasil dibuat!");
      }

      setModalOpen(false);
      setEditingId(null);
      setNewStaff({ name: '', email: '', username: '', password: '', branch: 'Semua Cabang', role: 'branch' });

    } catch (error) {
      console.error("Error saving staff:", error);
      alert(`Terjadi kesalahan saat menyimpan:\n${error.message || JSON.stringify(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (staff) => {
    setNewStaff({ name: staff.name, email: staff.email || '', username: staff.username || '', password: '', branch: staff.branch, role: staff.role || 'branch' });
    setEditingId(staff.id);
    setDelModalOpen(false);
    setModalOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = (staff) => {
    setSelectedStaff(staff);
    setModalOpen(false);
    setDelModalOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const confirmDelete = async () => {
    if (!selectedStaff) return;
    try {
      setSaving(true);
      // We delete from public.users to revoke POS access. (Actual Auth deletion requires Server logic)
      const { error } = await supabase.from('users').delete().eq('id', selectedStaff.id);
      if (error) throw error;
      setStaffList(staffList.filter(s => s.id !== selectedStaff.id));
      setDelModalOpen(false);
    } catch (error) {
      console.error("Error deleting staff config:", error);
      alert("Gagal menghapus akses kasir.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="page-title flex justify-between items-center">
        <div>
          <h1 className="text-primary mb-1">Manajemen Karyawan</h1>
          <p className="text-muted">Buat akun baru atau hapus akses karyawan lama dengan cepat.</p>
        </div>
        <button onClick={() => {
          setEditingId(null);
          setNewStaff({ name: '', email: '', username: '', password: '', branch: branches.length > 0 ? branches[0].name : 'Seluruh Cabang', role: 'branch' });
          setDelModalOpen(false);
          setModalOpen(true);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }} className="btn-primary">
          <Icon name="user-plus" size={18} /> Tambah Karyawan Baru
        </button>
      </div>

      {isModalOpen && (
        <div className="glass-panel mb-6 animate-fade-in" style={{ border: '2px solid var(--primary)', padding: '1.5rem' }}>
          <h2 className="mb-4 text-primary">{editingId ? 'Edit Akun Karyawan' : 'Buat Akun Karyawan Baru'}</h2>
          <form onSubmit={handleAddStaff} className="flex-col gap-4">
            <div>
              <label className="text-muted" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Nama Lengkap</label>
              <input type="text" className="input-field" required value={newStaff.name} onChange={e => setNewStaff({ ...newStaff, name: e.target.value })} placeholder="Siti Aminah" />
            </div>
            <div>
              <label className="text-muted" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Username Login (Harus Unik)</label>
              <input type="text" className="input-field" required value={newStaff.username} onChange={e => setNewStaff({ ...newStaff, username: e.target.value.toLowerCase().replace(/\s/g, '_') })} placeholder="bagastya" />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>*Hanya huruf kecil, angka, dan underscore (_). Ini yang dipakai untuk login.</p>
            </div>
            {!editingId && (
              <>
                <div>
                  <label className="text-muted" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Email (Untuk Sistem, Tidak Perlu Aktif)</label>
                  <input type="email" className="input-field" required value={newStaff.email} onChange={e => setNewStaff({ ...newStaff, email: e.target.value })} placeholder="bagastya@teiko.com" autoComplete="off" />
                </div>
                <div>
                  <label className="text-muted" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Password Baru</label>
                  <input type="password" className="input-field" required minLength="6" value={newStaff.password} onChange={e => setNewStaff({ ...newStaff, password: e.target.value })} placeholder="Min 6 karakter" autoComplete="new-password" />
                </div>
              </>
            )}
            <div>
              <label className="text-muted" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Peran Akses</label>
              <select className="input-field" required value={newStaff.role} onChange={e => setNewStaff({ ...newStaff, role: e.target.value })}>
                <option value="branch">Staf Cabang (Kasir)</option>
                <option value="gudang">Gudang</option>
                <option value="owner">Owner</option>
              </select>
            </div>
            {!['gudang', 'owner'].includes(newStaff.role) && (
              <div>
                <label className="text-muted" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Hak Akses Cabang (Khusus Kasir)</label>
                <select className="input-field" required value={newStaff.branch} onChange={e => setNewStaff({ ...newStaff, branch: e.target.value })}>
                  <option value="Seluruh Cabang">Seluruh Cabang (Bebas Pilih)</option>
                  {branches.map(b => (
                    <option key={b.name} value={b.name}>{b.name}</option>
                  ))}
                </select>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>*Jika diset ke cabang tertentu, kasir ini hanya bisa login di cabang tersebut.</p>
              </div>
            )}

            <div className="flex justify-between mt-6">
              <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Batal</button>
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? 'Membuat...' : 'Simpan & Buat Akun'}
              </button>
            </div>
          </form>
        </div>
      )}

      {delModalOpen && (
        <div className="glass-panel mb-6 animate-fade-in" style={{ border: '2px solid var(--danger)', padding: '1.5rem' }}>
          <h2 className="mb-4 text-danger">Konfirmasi Hapus Akses</h2>
          <p className="text-muted mb-6">
            Hapus akses untuk karyawan <strong>{selectedStaff?.name}</strong>? Ini akan membuat mereka tidak bisa login ke sistem lagi.
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

      <div className="glass-panel" style={{ overflow: 'hidden' }}>
        <table className="data-table" style={{ marginTop: 0 }}>
          <thead>
            <tr>
              <th>Nama Karyawan</th>
              <th>Username</th>
              <th>Email</th>
              <th>Peran</th>
              <th>Penempatan Cabang</th>
              <th className="text-center">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="6" className="text-center text-muted py-8">Memuat data dari Supabase...</td></tr>
            ) : staffList.length === 0 ? (
              <tr><td colSpan="6" className="text-center text-muted py-8">Belum ada karyawan yang didaftarkan.</td></tr>
            ) : staffList.map(staff => (
              <tr key={staff.id}>
                <td style={{ fontWeight: 500 }}>{staff.name}</td>
                <td>
                  {staff.username ? (
                    <span style={{ fontFamily: 'monospace', backgroundColor: 'rgba(0,0,0,0.05)', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.85rem' }}>
                      @{staff.username}
                    </span>
                  ) : (
                    <span className="text-muted" style={{ fontSize: '0.8rem' }}>—</span>
                  )}
                </td>
                <td className="text-muted" style={{ fontSize: '0.8rem' }}>{staff.email}</td>
                <td>
                  <span style={{
                    backgroundColor: 'var(--fill-subtle)', color: 'var(--text-muted)',
                    padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em'
                  }}>
                    {staff.role === 'gudang' ? 'Gudang' : staff.role === 'owner' ? 'Owner' : 'Cabang'}
                  </span>
                </td>
                <td>
                  <span style={{
                    backgroundColor: 'var(--fill-subtle)', color: 'var(--text-muted)',
                    padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600
                  }}>
                    {['gudang', 'owner'].includes(staff.role) ? 'Pusat' : staff.branch}
                  </span>
                </td>
                <td className="text-center">
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem' }}>
                    <button onClick={() => handleEdit(staff)} className="btn-secondary" style={{ padding: '0.4rem', borderColor: 'transparent' }} title="Edit"><Icon name="edit" size={16} /></button>
                    <button onClick={() => handleDelete(staff)} className="btn-danger" style={{ padding: '0.4rem' }} title="Hapus Akses"><Icon name="trash" size={16} /></button>
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
