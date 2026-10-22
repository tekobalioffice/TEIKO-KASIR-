import React, { useState } from 'react';
import { Outlet, NavLink as Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/Icon';

export default function GudangLayout() {
  const { logout, userData } = useAuth();
  const navigate = useNavigate();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const navLinkStyle = { justifyContent: 'flex-start', border: 'none' };

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);
  const closeSidebar = () => setIsSidebarOpen(false);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error("Failed to log out", error);
    }
  };

  return (
    <div className="flex" style={{ minHeight: '100vh', backgroundColor: 'var(--bg-dark)' }}>
      {/* Mobile Top Header */}
      <div className="mobile-header items-center justify-between glass-panel" style={{ 
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 900, 
        padding: '1rem', borderRadius: 0, borderBottom: '1px solid var(--border-color)' 
      }}>
        <img src="/logo.png" alt="TEIKO" style={{ height: '32px', objectFit: 'contain' }} />
        <button onClick={toggleSidebar} style={{ background: 'none', border: 'none', color: 'var(--text-main)' }}>
          <Icon name="menu" size={24} />
        </button>
      </div>

      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && <div className="sidebar-overlay" onClick={closeSidebar}></div>}

      {/* Sidebar */}
      <aside className={`glass-panel admin-sidebar ${isSidebarOpen ? 'open' : ''}`} style={{ 
        width: '260px', borderRadius: '0', display: 'flex', flexDirection: 'column', 
        borderRight: '1px solid var(--border-color)', backgroundColor: 'var(--panel-bg)'
      }}>
        <div className="flex justify-between items-center" style={{ padding: '2rem 1.5rem', borderBottom: '1px solid var(--border-color)' }}>
          <div>
            <img src="/logo.png" alt="TEIKO" style={{ height: '45px', objectFit: 'contain', marginBottom: '0.25rem' }} />
            <p className="text-muted" style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>Gudang Pusat</p>
          </div>
          <button className="mobile-header" onClick={closeSidebar} style={{ background: 'none', border: 'none', color: 'var(--text-main)' }}>
            <Icon name="close" size={20} />
          </button>
        </div>
        
        <nav style={{ flex: 1, padding: '1.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto' }}>
          <p className="text-muted" style={{ fontSize: '0.75rem', padding: '0 0.5rem', fontWeight: 600, textTransform: 'uppercase' }}>Monitoring</p>

          <Link to="/gudang/inventory" onClick={closeSidebar} className="btn-secondary" style={navLinkStyle}>
            <Icon name="package" size={18} /> Kelola Stok Pusat
          </Link>

          <Link to="/gudang/cek-pengiriman" onClick={closeSidebar} className="btn-secondary" style={navLinkStyle}>
            <Icon name="truck" size={18} /> Cek Pengiriman
          </Link>

          <Link to="/gudang/koreksi" onClick={closeSidebar} className="btn-secondary" style={navLinkStyle}>
            <Icon name="clipboard-check" size={18} /> Penyesuaian Stok
          </Link>

          <Link to="/gudang/koreksi-laporan" onClick={closeSidebar} className="btn-secondary" style={navLinkStyle}>
            <Icon name="clipboard-check" size={18} /> Koreksi Laporan
          </Link>

          <Link to="/gudang/monitoring-stok" onClick={closeSidebar} className="btn-secondary" style={navLinkStyle}>
            <Icon name="package-search" size={18} /> Leaderboard Penjualan
          </Link>

          <Link to="/gudang/purchasing" onClick={closeSidebar} className="btn-secondary" style={navLinkStyle}>
            <Icon name="cart" size={18} /> Purchasing
          </Link>

          <Link to="/gudang/riwayat-stok" onClick={closeSidebar} className="btn-secondary" style={navLinkStyle}>
            <Icon name="clipboard-check" size={18} /> Riwayat Aktivitas Stok
          </Link>


          {(userData?.role === 'admin' || userData?.role === 'owner') && (
             <Link to="/admin" onClick={closeSidebar} className="btn-secondary mt-4" style={{ justifyContent: 'flex-start', border: '1px dashed var(--primary)', color: 'var(--primary)', backgroundColor: 'rgba(52, 199, 89,0.05)' }}>
               <Icon name="arrow-left" size={18} /> Kembali ke Admin
             </Link>
          )}
        </nav>

        <div style={{ padding: '1.5rem', borderTop: '1px solid var(--border-color)' }}>
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.9rem', fontWeight: 600 }}>{userData?.name || 'Staf Gudang'}</p>
            <p className="text-muted" style={{ fontSize: '0.8rem' }}>{(userData?.role === 'admin' || userData?.role === 'owner') ? 'Administrator' : 'Warehouse Staff'}</p>
          </div>
          <button onClick={handleLogout} className="btn-secondary" style={{ width: '100%', borderColor: 'rgba(255, 56, 60, 0.5)', color: 'var(--danger)' }}>
            <Icon name="logout" size={16} /> Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content" style={{ flex: 1, padding: '2rem', overflowY: 'auto' }}>
        <Outlet />
      </main>
    </div>
  );
}
