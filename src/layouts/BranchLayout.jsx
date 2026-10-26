import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/Icon';
import BranchStockDrawer from '../components/BranchStockDrawer';
import { supabase } from '../supabase';

export default function BranchLayout() {
  const { logout, userData } = useAuth();
  const navigate = useNavigate();
  const [stockOpen, setStockOpen] = useState(false);
  const [currentBranch, setCurrentBranch] = useState(localStorage.getItem('selectedBranch') || '');
  const [isFsoOpen, setIsFsoOpen] = useState(false);
  const [livePorsiSisa, setLivePorsiSisa] = useState(null);
  const [porsiTransfers, setPorsiTransfers] = useState({});
  const [liveSafetyStock, setLiveSafetyStock] = useState({});
  const [stockRefreshKey, setStockRefreshKey] = useState(0);

  const handlePorsiTransfer = (itemName, qty) => {
    setPorsiTransfers(prev => ({...prev, [itemName]: (prev[itemName]||0) + qty}));
  };

  useEffect(() => {
    if (currentBranch) {
      // Periksa status FSO (allow_inventory_edit) untuk cabang ini
      const checkFso = async () => {
        const { data } = await supabase.from('outlets').select('allow_inventory_edit').eq('name', currentBranch).single();
        if (data) setIsFsoOpen(data.allow_inventory_edit);
      };
      checkFso();
    }
  }, [currentBranch]);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error("Failed to log out", error);
    }
  };

  return (
    <div style={{ backgroundColor: 'var(--bg-dark)', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top Navbar */}
      <header className="glass-panel flex-wrap" style={{
        borderRadius: '0', padding: '0.75rem 1rem',
        display: 'flex', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center',
        borderBottom: '1px solid var(--border-color)', position: 'sticky', top: 0, zIndex: 100
      }}>
        <div className="flex items-center gap-4">
          <img src="/logo.png" alt="TEIKO" style={{ height: '28px', objectFit: 'contain' }} />
          <span className="text-muted">|</span>
          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{currentBranch || '—'}</span>
          <span className="text-muted">|</span>
          <nav style={{ display: 'flex', gap: '0.3rem' }}>
            <NavLink to="/branch/pos" style={({ isActive }) => ({
              padding: '0.35rem 0.75rem', borderRadius: '6px', fontWeight: 700, fontSize: '0.8rem',
              textDecoration: 'none', color: isActive ? '#fff' : 'var(--text-main)',
              background: isActive ? 'var(--primary)' : 'transparent',
            })}>Opname</NavLink>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {/* Kasir — di kiri Stok. Halaman Kasir sendiri yang cek shift sudah dibuka di Input Penjualan. */}
          <NavLink to="/branch/kasir" style={({ isActive }) => ({
            display: 'flex', alignItems: 'center', gap: '0.4rem',
            padding: '0.5rem 0.9rem', border: '1.5px solid var(--primary)', borderRadius: '8px',
            backgroundColor: isActive ? 'var(--primary)' : 'rgba(52, 199, 89,0.08)',
            color: isActive ? '#fff' : 'var(--primary)', fontWeight: 700, fontSize: '0.85rem', textDecoration: 'none',
          })} title="Buka UI Kasir">
            <Icon name="cart" size={16} />
            <span>Kasir</span>
          </NavLink>

          {/* Stock Button */}
          <button
            onClick={() => setStockOpen(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              padding: '0.5rem 0.9rem', border: '1.5px solid var(--primary)',
              borderRadius: '8px', backgroundColor: 'rgba(52, 199, 89,0.08)',
              color: 'var(--primary)', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer'
            }}
            title="Lihat & Tambah Stok"
          >
            <Icon name="package" size={16} />
            <span>Stok</span>
          </button>

          <button onClick={handleLogout} className="btn-secondary" style={{ padding: '0.5rem 0.75rem', borderColor: 'rgba(255, 56, 60, 0.5)', color: 'var(--danger)', fontSize: '0.85rem' }}>
            <Icon name="logout" size={15} /> Keluar
          </button>
        </div>
      </header>

      <BranchStockDrawer
        isOpen={stockOpen}
        onClose={() => setStockOpen(false)}
        branchName={currentBranch}
        petugasName={userData?.name || 'Kasir'}
        allowEdit={
          (['admin', 'administrator', 'owner'].includes(userData?.role?.toLowerCase())) || 
          isFsoOpen
        }
        livePorsiSisa={livePorsiSisa}
        onPorsiTransfer={handlePorsiTransfer}
        liveSafetyStock={liveSafetyStock}
        onStockChange={() => setStockRefreshKey(k => k + 1)}
      />

      {/* Main Content */}
      <main style={{ flex: 1, padding: '1rem', maxWidth: '1150px', margin: '0 auto', width: '100%' }}>
        <Outlet context={{ setCurrentBranch, setLivePorsiSisa, porsiTransfers, setPorsiTransfers, setLiveSafetyStock, stockRefreshKey }} />
      </main>
    </div>
  );
}
