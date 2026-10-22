import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import { supabase } from '../supabase';
import AdminStock from './AdminStock';

export default function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [statsData, setStatsData] = useState({
    revenue: 0,
    branches: 0,
    staff: 0,
    cups: 0
  });
  const [recentSales, setRecentSales] = useState([]);
  const [dailyStatus, setDailyStatus] = useState([]);
  const [todayRevenue, setTodayRevenue] = useState(0);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);

      // 1. Get total active branches
      const { count: branchesCount } = await supabase.from('outlets').select('*', { count: 'exact', head: true });

      // 2. Get total branch staff
      const { count: staffCount } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'branch');

      // 3. Get total products (as a proxy for menu size or cups if we don't have detailed cup tracking yet)
      const { count: productCount } = await supabase.from('products').select('*', { count: 'exact', head: true });

      // Update basic stats first so they show up even if sales query fails
      setStatsData(prev => ({
        ...prev,
        branches: branchesCount || 0,
        staff: staffCount || 0,
        cups: productCount || 0
      }));

      // 4. Get today's sales reports (using 'date' column which is more reliable)
      const todayString = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];

      const salesRes = await supabase.from('sales_reports')
        .select('*')
        .eq('date', todayString)
        .order('id', { ascending: false });

      // Buang laporan simulasi / stress test biar dashboard cuma nunjukin cabang beneran.
      const salesData = (salesRes.data || []).filter(r => !/simulasi|tester/i.test(r.staff_name || ''));

      if (salesRes.error) {
        console.warn("Sales reports query failed:", salesRes.error);
      }

      const { data: allBranches } = await supabase.from('outlets').select('name');

      if (salesData) {
        const total = salesData.reduce((sum, report) => sum + (report.cash_akhir || 0), 0);
        setTodayRevenue(total);

        // Update the stats overview with fetched counts and revenue
        setStatsData({
          revenue: total, // Using today's total as summary for now
          branches: branchesCount || 0,
          staff: staffCount || 0,
          cups: productCount || 0
        });

        const formattedSales = salesData.map(sale => {
          // Setoran = angka setoran aktual (di meta), fallback omzet lalu cash_akhir.
          const meta = (sale.details || []).find(d => d._is_meta && !d._is_preclose_snapshot);
          const setor = meta?.setoran_aktual ?? sale.total_revenue ?? sale.cash_akhir ?? 0;
          return {
            id: sale.id,
            branch: sale.branch_name,
            shift: sale.shift,
            staff: sale.staff_name,
            totalRp: setor,
            // Baris di sales_reports = shift SUDAH ditutup (shift jalan belum punya baris).
            status: 'CLOSED',
            time: 'Selesai'
          };
        });
        setRecentSales(formattedSales);

        // Map branches to status
        if (allBranches) {
          const statusMap = allBranches.map(b => {
            const bSales = salesData.filter(s => s.branch_name === b.name);
            return {
              name: b.name,
              shift1: bSales.find(s => s.shift === '1'),
              shift2: bSales.find(s => s.shift === '2')
            };
          });
          setDailyStatus(statusMap);
        }
      }
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  const stats = [
    { label: 'Total Revenue (All Time)', value: `Rp ${statsData.revenue.toLocaleString('id-ID')}`, icon: <Icon name="trending-up" size={24} />, color: 'var(--primary)' },
    { label: 'Total Branches', value: `${statsData.branches}`, icon: <Icon name="store" size={24} />, color: 'var(--success)' },
    { label: 'Total Staff', value: `${statsData.staff}`, icon: <Icon name="users" size={24} />, color: '#0d6fff' },
    { label: 'Menu Items', value: `${statsData.cups}`, icon: <Icon name="coffee" size={24} />, color: '#af52de' },
  ];

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="mb-1">Dashboard Overview</h1>
        <p className="text-muted">Welcome back, Admin. Here is today's summary.</p>
      </div>

      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        {stats.map((stat, idx) => (
          <div key={idx} className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <div style={{ backgroundColor: `${stat.color}20`, color: stat.color, padding: '1rem', borderRadius: '12px' }}>
              {stat.icon}
            </div>
            <div>
              <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '0.25rem' }}>{stat.label}</p>
              <h3 style={{ fontSize: '1.5rem', fontWeight: 700 }}>{stat.value}</h3>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '2rem' }}>

        {/* Daily Status Monitoring */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1.2rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            Monitoring Laporan Harian
            <span style={{ fontSize: '0.75rem', fontWeight: 600, backgroundColor: '#1d1d1f', color: 'white', padding: '0.2rem 0.6rem', borderRadius: '999px' }}>Hari Ini</span>
          </h2>

          <div className="table-responsive">
            <table className="data-table" style={{ marginTop: 0 }}>
              <thead>
                <tr>
                  <th>Cabang</th>
                  <th className="text-center">Shift 1</th>
                  <th className="text-center">Shift 2</th>
                  <th className="text-right">Total Hari Ini</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="4" className="text-center py-4">Memuat status...</td></tr>
                ) : dailyStatus.map(b => {
                  const s1Status = b.shift1 ? (b.shift1.cash_akhir !== null ? 'CLOSED' : 'OPEN') : 'EMPTY';
                  const s2Status = b.shift2 ? (b.shift2.cash_akhir !== null ? 'CLOSED' : 'OPEN') : 'EMPTY';
                  const total = (b.shift1?.cash_akhir || 0) + (b.shift2?.cash_akhir || 0);

                  const getBadge = (status) => {
                    if (status === 'CLOSED') return <span style={{ backgroundColor: 'rgba(52, 199, 89,0.1)', color: 'var(--primary)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700 }}>CLOSED</span>;
                    if (status === 'OPEN') return <span style={{ backgroundColor: 'rgba(255, 204, 0,0.15)', color: '#9a3412', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700 }}>OPEN</span>;
                    return <span style={{ color: '#a1a1a6', fontSize: '0.75rem' }}>Belum Buka</span>;
                  };

                  return (
                    <tr key={b.name}>
                      <td style={{ fontWeight: 600 }}>{b.name}</td>
                      <td className="text-center">{getBadge(s1Status)}</td>
                      <td className="text-center">{getBadge(s2Status)}</td>
                      <td className="text-right" style={{ fontWeight: 700 }}>Rp {total.toLocaleString('id-ID')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Shift Reports */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1.2rem', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between' }}>
            Aktivitas Terbaru
            <Link to="/admin/riwayat-penjualan" style={{ fontSize: '0.85rem', fontWeight: 400, color: 'var(--primary)', cursor: 'pointer', textDecoration: 'none' }}>
              Lihat Riwayat
            </Link>
          </h2>

          <table className="data-table" style={{ marginTop: 0 }}>
            <thead>
              <tr>
                <th>Waktu</th>
                <th>Cabang</th>
                <th>Shift</th>
                <th className="text-right">Setor</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="4" className="text-center py-4">Memuat data...</td></tr>
              ) : recentSales.length === 0 ? (
                <tr><td colSpan="4" className="text-center py-4 text-muted">Belum ada aktivitas hari ini.</td></tr>
              ) : recentSales.map(sale => (
                <tr key={sale.id}>
                  <td className="text-muted" style={{ fontSize: '0.8rem' }}>{sale.time}</td>
                  <td style={{ fontWeight: 500 }}>{sale.branch}</td>
                  <td>
                    {sale.shift} {sale.status === 'OPEN' && <span style={{ marginLeft: '0.4rem', color: '#9a3412', fontWeight: 800 }}>●</span>}
                  </td>
                  <td className="text-right" style={{ fontWeight: 600, color: sale.status === 'CLOSED' ? 'var(--success)' : 'var(--text-muted)' }}>
                    {sale.status === 'CLOSED' ? `Rp ${sale.totalRp.toLocaleString('id-ID')}` : 'OPEN'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Leaderboard Section */}
      <div style={{ marginTop: '2.5rem' }}>
        <AdminStock />
      </div>
    </div>
  );
}
