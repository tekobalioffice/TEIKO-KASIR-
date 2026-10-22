import React, { useState } from 'react';
import { Outlet, NavLink as Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/Icon';

export default function AdminLayout() {
  const { logout, userData } = useAuth();
  const navigate = useNavigate();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMasterDataOpen, setIsMasterDataOpen] = useState(false);

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);
  const closeSidebar = () => setIsSidebarOpen(false);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/admin/login');
    } catch (error) {
      console.error("Failed to log out", error);
    }
  };

  const isOwner = userData?.role?.toLowerCase() === 'owner';

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
            <p className="text-muted" style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>Admin Portal</p>
          </div>
          <button className="mobile-header" onClick={closeSidebar} style={{ background: 'none', border: 'none', color: 'var(--text-main)' }}>
            <Icon name="close" size={20} />
          </button>
        </div>
        
        <nav style={{ flex: 1, padding: '1.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto' }}>
          <Link to="/admin" end onClick={closeSidebar} className="btn-secondary" style={{ justifyContent: 'flex-start', border: 'none' }}>
            <Icon name="dashboard" size={18} /> Dashboard
          </Link>
          
          <Link to="/admin/kasir" onClick={closeSidebar} className="btn-secondary" style={{ justifyContent: 'flex-start', border: 'none' }}>
            <Icon name="cart" size={18} /> Kasir
          </Link>

          {!isOwner && (
            <Link to="/admin/pos" onClick={closeSidebar} className="btn-secondary" style={{ justifyContent: 'flex-start', border: 'none' }}>
              <Icon name="file" size={18} /> Input Penjualan
            </Link>
          )}

          <Link to="/admin/riwayat-penjualan" onClick={closeSidebar} className="btn-secondary" style={{ justifyContent: 'flex-start', border: 'none' }}>
            <Icon name="file" size={18} /> Riwayat Penjualan
          </Link>
          
          <Link to="/admin/stock" onClick={closeSidebar} className="btn-secondary" style={{ justifyContent: 'flex-start', border: 'none' }}>
            <Icon name="package-search" size={18} /> Leaderboard Penjualan
          </Link>

          {!isOwner && (
            <div className="flex-col gap-2">
              <div 
                className="btn-secondary" 
                onClick={() => setIsMasterDataOpen(!isMasterDataOpen)}
                style={{ justifyContent: 'space-between', border: 'none', cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Icon name="package" size={18} /> Data Master
                </div>
                {isMasterDataOpen ? <Icon name="chevron-up" size={16} /> : <Icon name="chevron-down" size={16} />}
              </div>
              {isMasterDataOpen && (
                <div style={{ paddingLeft: '1rem', borderLeft: '2px solid var(--border-color)', marginLeft: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.2rem' }}>
                  <Link to="/admin/products" onClick={closeSidebar} className="btn-secondary" style={{ justifyContent: 'flex-start', border: 'none' }}>
                    <Icon name="package" size={18} /> Master Produk
                  </Link>
                  <Link to="/admin/operasional" onClick={closeSidebar} className="btn-secondary" style={{ justifyContent: 'flex-start', border: 'none' }}>
                    <Icon name="wrench" size={18} /> Support Product
                  </Link>
                </div>
              )}
            </div>
          )}

          {!isOwner && (
            <Link to="/admin/branches" onClick={closeSidebar} className="btn-secondary" style={{ justifyContent: 'flex-start', border: 'none' }}>
              <Icon name="store" size={18} /> Kelola Cabang
            </Link>
          )}

          {!isOwner && (
            <Link to="/admin/staff" onClick={closeSidebar} className="btn-secondary" style={{ justifyContent: 'flex-start', border: 'none' }}>
              <Icon name="users" size={18} /> Data Karyawan
            </Link>
          )}

          {!isOwner && (
            <Link to="/admin/operasional-check" onClick={closeSidebar} className="btn-secondary" style={{ justifyContent: 'flex-start', border: 'none' }}>
              <Icon name="clipboard-check" size={18} /> Form Stok Barang Checking
            </Link>
          )}

          {!isOwner && (
            <Link to="/admin/inventory" onClick={closeSidebar} className="btn-secondary" style={{ justifyContent: 'flex-start', border: 'none' }}>
              <Icon name="package" size={18} /> Kelola Stok Pusat
            </Link>
          )}

          {!isOwner && (
            <Link to="/admin/koreksi" onClick={closeSidebar} className="btn-secondary" style={{ justifyContent: 'flex-start', border: 'none' }}>
              <Icon name="clipboard-check" size={18} /> Penyesuaian Stok
            </Link>
          )}

          {!isOwner && (
            <Link to="/admin/koreksi-laporan" onClick={closeSidebar} className="btn-secondary" style={{ justifyContent: 'flex-start', border: 'none' }}>
              <Icon name="clipboard-check" size={18} /> Koreksi Laporan
            </Link>
          )}

          {!isOwner && (
            <Link to="/admin/cek-pengiriman" onClick={closeSidebar} className="btn-secondary" style={{ justifyContent: 'flex-start', border: 'none' }}>
              <Icon name="truck" size={18} /> Cek Pengiriman
            </Link>
          )}

          <Link to="/admin/riwayat-stok" onClick={closeSidebar} className="btn-secondary" style={{ justifyContent: 'flex-start', border: 'none' }}>
            <Icon name="clipboard-check" size={18} /> Riwayat Aktivitas Stok
          </Link>

          <Link to="/admin/pengaturan" onClick={closeSidebar} className="btn-secondary" style={{ justifyContent: 'flex-start', border: 'none' }}>
            <Icon name="settings" size={18} /> Pengaturan
          </Link>
        </nav>

        <div style={{ padding: '1.5rem', borderTop: '1px solid var(--border-color)' }}>
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.9rem', fontWeight: 600 }}>{userData?.name || 'Admin'}</p>
            <p className="text-muted" style={{ fontSize: '0.8rem' }}>Administrator</p>
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
