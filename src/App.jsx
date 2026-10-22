import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Icon from './components/Icon';

// ── Global Error Boundary ──────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('App ErrorBoundary caught:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: '#0f1a14', padding: '2rem', gap: '1rem'
        }}>
          <div style={{
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255, 56, 60,0.3)',
            borderRadius: '16px', padding: '2rem 2.5rem', maxWidth: '560px', width: '100%',
            textAlign: 'center'
          }}>
            <div style={{ marginBottom: '0.75rem', color: '#ff383c' }}><Icon name="alert-triangle" size={40} /></div>
            <h2 style={{ color: '#ff383c', fontWeight: 800, marginBottom: '0.5rem' }}>Terjadi Kesalahan Aplikasi</h2>
            <p style={{ color: '#8e8e93', fontSize: '0.88rem', marginBottom: '1.25rem' }}>
              {this.state.error?.message || 'Error tidak diketahui'}
            </p>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              style={{
                backgroundColor: '#34c759', color: 'white', border: 'none',
                borderRadius: '8px', padding: '0.6rem 1.5rem', fontWeight: 700,
                cursor: 'pointer', fontSize: '0.9rem'
              }}
            >
              Muat Ulang Halaman
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Layouts
import AdminLayout from './layouts/AdminLayout';
import BranchLayout from './layouts/BranchLayout';
import GudangLayout from './layouts/GudangLayout';

// Pages
import Login from './pages/Login';
import BranchPOS from './pages/BranchPOS';
import BranchKasir from './pages/BranchKasir';
import AdminDashboard from './pages/AdminDashboard';
import AdminStaff from './pages/AdminStaff';
import AdminProducts from './pages/AdminProducts';
import AdminBranches from './pages/AdminBranches';
import AdminPOS from './pages/AdminPOS';
import AdminStock from './pages/AdminStock';
import AdminOperasional from './pages/AdminOperasional';
import AdminOperasionalCheck from './pages/AdminOperasionalCheck';
import AdminKartuStock from './pages/AdminKartuStock';
import AdminPurchasing from './pages/AdminPurchasing';
import AdminInventory from './pages/AdminInventory';
import AdminCekPengiriman from './pages/AdminCekPengiriman';
import AdminStockHistory from './pages/AdminStockHistory';
import AdminKoreksi from './pages/AdminKoreksi';
import AdminKoreksiLaporan from './pages/AdminKoreksiLaporan';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';

// Branch Pages
// Real component imported above

// Route Guards
const ProtectedRoute = ({ children, requiredRole }) => {
  const { currentUser, userData, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ 
        height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'var(--bg-dark)', gap: '1.5rem'
      }}>
        <div className="glass-panel animate-pulse" style={{ padding: '2rem', borderRadius: '24px' }}>
          <div style={{ 
            width: '40px', height: '40px', border: '4px solid rgba(52, 199, 89,0.1)', 
            borderTop: '4px solid var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' 
          }}></div>
        </div>
        <p className="text-primary font-black uppercase tracking-widest text-xs animate-pulse">Menyiapkan Workspace...</p>
        <style>{`
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  if (!currentUser) return <Navigate to="/login" />;
  
  if (requiredRole && userData?.role !== requiredRole && userData?.role !== 'admin' && userData?.role !== 'owner') {
     return <Navigate to="/" />;
  }

  return children;
};

// Home Redirect logic
const HomeRedirect = () => {
  const { currentUser, userData, loading } = useAuth();

  if (loading) return null; // Let ProtectedRoute or parent handle loading
  if (!currentUser) return <Navigate to="/login" replace />;

  if (userData?.role === 'admin' || userData?.role === 'owner') return <Navigate to="/admin" replace />;
  if (userData?.role === 'branch') return <Navigate to="/branch/pos" replace />;
  if (userData?.role === 'gudang') return <Navigate to="/gudang" replace />;

  return <Navigate to="/login" replace />;
};

export default function App() {
  return (
    <ErrorBoundary>
      <Router>
        <Routes>
          {/* Public */}
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Admin Routes */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute requiredRole="admin">
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<AdminDashboard />} />
            <Route path="pos" element={<BranchPOS />} />
            <Route path="kasir" element={<BranchKasir />} />
            <Route path="riwayat-penjualan" element={<AdminPOS />} />
            <Route path="products" element={<AdminProducts />} />
            <Route path="stock" element={<AdminStock />} />
            <Route path="koreksi" element={<AdminKoreksi />} />
            <Route path="koreksi-laporan" element={<AdminKoreksiLaporan />} />
            <Route path="operasional-check" element={<AdminOperasionalCheck />} />
            <Route path="branches" element={<AdminBranches />} />
            <Route path="staff" element={<AdminStaff />} />
            <Route path="operasional" element={<AdminOperasional />} />
            <Route path="kartu-stock" element={<AdminKartuStock />} />
            <Route path="inventory" element={<AdminInventory />} />
            <Route path="cek-pengiriman" element={<AdminCekPengiriman />} />
            <Route path="riwayat-stok" element={<AdminStockHistory />} />
          </Route>

          {/* Branch Routes */}
          <Route
            path="/branch"
            element={
              <ProtectedRoute requiredRole="branch">
                <BranchLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="pos" />} />
            <Route path="pos" element={<BranchPOS />} />
            <Route path="kasir" element={<BranchKasir />} />
          </Route>

          {/* Gudang Routes */}
          <Route
            path="/gudang"
            element={
              <ProtectedRoute requiredRole="gudang">
                <GudangLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="inventory" />} />
            <Route path="inventory" element={<AdminInventory />} />
            <Route path="cek-pengiriman" element={<AdminCekPengiriman />} />
            <Route path="koreksi" element={<AdminKoreksi />} />
            <Route path="koreksi-laporan" element={<AdminKoreksiLaporan />} />
            <Route path="monitoring-stok" element={<AdminStock />} />
            <Route path="purchasing" element={<AdminPurchasing />} />
            <Route path="riwayat-stok" element={<AdminStockHistory />} />
            <Route path="operasional-check" element={<AdminOperasionalCheck />} />
            <Route path="operasional" element={<AdminOperasional />} />
            <Route path="kartu-stock" element={<AdminKartuStock />} />
          </Route>



          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Router>
    </ErrorBoundary>
  );
}
