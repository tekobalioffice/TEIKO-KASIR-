import React, { useState, useEffect, useMemo } from 'react';
import Icon from '../components/Icon';
import { supabase } from '../supabase';

const AUTO_ITEMS = ['Es Teh', 'Teh Tarik', 'Full Cream', 'Milk Tea'];

export default function AdminPurchasing() {
  const [loading, setLoading] = useState(true);
  const [raw, setRaw] = useState(null); // { reports, inventory, products, opItems } — hasil fetch mentah
  const [safetyDays, setSafetyDays] = useState(14); // Target stock to hold
  const [thresholdDays, setThresholdDays] = useState(7); // Warn when below this
  const [periodDays, setPeriodDays] = useState(30); // History to check

  const fetchRaw = async () => {
    try {
      setLoading(true);

      // 1. Calculate date range
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - periodDays);
      const startDateStr = startDate.toISOString().split('T')[0];

      // 2. Fetch all reports in period
      const { data: reports, error: errReports } = await supabase
        .from('sales_reports')
        .select('details, stocks, date')
        .gte('date', startDateStr);

      if (errReports) throw errReports;

      // 3. Fetch current inventory (total across branches)
      const { data: inventory, error: errInv } = await supabase
        .from('branch_inventory')
        .select('item_name, current_qty');

      if (errInv) throw errInv;

      // 4. Fetch master lists to ensure we show items with zero usage
      const { data: products } = await supabase.from('products').select('name, variant');
      const { data: opItems } = await supabase.from('operational_items').select('name');

      setRaw({ reports: reports || [], inventory: inventory || [], products: products || [], opItems: opItems || [] });
    } catch (err) {
      console.error('Error fetching purchasing data:', err);
      alert('Gagal memuat rekomendasi pembelian: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Cuma periodDays yang perlu QUERY ULANG ke server (rentang tanggalnya beda). Target
  // Stok & Batas Peringatan murni hitungan lokal dari data yang sama — lihat useMemo `data`
  // di bawah. (Bug lama: ganti Target Stok kelihatan "diem aja" krn dulu SEMUA angka baru
  // kepakai cuma kalau fetchData network dipanggil ulang, & itu cuma nempel ke periodDays.)
  useEffect(() => {
    fetchRaw();
  }, [periodDays]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hitungan murni (tak nyentuh network) — jalan ulang instan tiap Target Stok / Batas
  // Peringatan / data mentah berubah, tak nunggu round-trip Supabase.
  const data = useMemo(() => {
    if (!raw) return [];
    const { reports, inventory, products, opItems } = raw;

    // 5. Aggregate usage
    const usageMap = {};
    products.forEach(p => {
      if (AUTO_ITEMS.includes(p.name)) return;
      const key = p.variant && p.variant !== 'Standar' ? `${p.name} (${p.variant})` : p.name;
      usageMap[key] = { name: p.name, variant: p.variant || 'Standar', type: 'Product', totalUsed: 0 };
    });
    opItems.forEach(o => {
      usageMap[o.name] = { name: o.name, variant: null, type: 'Operational', totalUsed: 0 };
    });

    reports.forEach(report => {
      (report.details || []).forEach(d => {
        if (d._is_meta || d._is_inventory_snapshot) return;
        if (AUTO_ITEMS.includes(d.name)) return;
        if (!d.name) return;
        const key = d.variant && d.variant !== 'Standar' ? `${d.name} (${d.variant})` : d.name;
        if (usageMap[key]) {
          usageMap[key].totalUsed += (parseInt(d.qty) || 0);
        } else {
          usageMap[key] = { name: d.name, variant: d.variant || 'Standar', type: 'Product', totalUsed: parseInt(d.qty) || 0 };
        }
      });
      (report.stocks || []).forEach(s => {
        if (!s.name) return;
        const used = parseFloat(s.used !== undefined ? s.used : s.qty) || 0;
        if (usageMap[s.name]) {
          usageMap[s.name].totalUsed += used;
        } else {
          usageMap[s.name] = { name: s.name, variant: null, type: 'Operational', totalUsed: used };
        }
      });
    });

    // 6. Aggregate current stock
    const stockMap = {};
    inventory.forEach(inv => {
      stockMap[inv.item_name] = (stockMap[inv.item_name] || 0) + (inv.current_qty || 0);
    });

    // 7. Calculate recommendations
    const recommendations = Object.entries(usageMap).map(([key, info]) => {
      const avgDailyUsage = info.totalUsed / periodDays;

      let currentStock = stockMap[key];
      if (currentStock === undefined && info.variant && info.variant !== 'Standar') {
        currentStock = stockMap[`${info.name} ${info.variant}`] || 0;
      }
      currentStock = currentStock || 0;

      const daysRemaining = avgDailyUsage > 0 ? (currentStock / avgDailyUsage) : 999;

      let suggestPurchase = 0;
      if (daysRemaining < thresholdDays) {
        suggestPurchase = Math.ceil((avgDailyUsage * safetyDays) - currentStock);
        if (suggestPurchase < 0) suggestPurchase = 0;
      }

      return { key, ...info, avgDailyUsage, currentStock, daysRemaining, suggestPurchase };
    });

    recommendations.sort((a, b) => {
      if (a.suggestPurchase > 0 && b.suggestPurchase === 0) return -1;
      if (a.suggestPurchase === 0 && b.suggestPurchase > 0) return 1;
      return a.daysRemaining - b.daysRemaining;
    });

    return recommendations;
  }, [raw, periodDays, safetyDays, thresholdDays]);

  const getStatusColor = (days) => {
    if (days < 3) return '#ff383c'; // Red
    if (days < thresholdDays) return '#ff9500'; // Amber
    return '#34c759'; // Green
  };

  return (
    <div className="animate-fade-in pb-10">
      <div className="page-title flex justify-between items-center">
        <div>
          <h1 className="text-primary mb-1 text-2xl font-black">Rekomendasi Pembelian (Purchasing)</h1>
          <p className="text-muted text-sm font-medium">Prediksi kebutuhan stok berdasarkan rata-rata pemakaian {periodDays} hari terakhir.</p>
        </div>
        <button onClick={fetchRaw} className="btn-secondary">
          <Icon name="refresh" size={18} className={loading ? 'animate-spin' : ''} /> Refresh Data
        </button>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem', marginBottom: '3rem' }}>
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <div style={{ backgroundColor: 'rgba(255, 56, 60, 0.1)', color: '#ff383c', padding: '1rem', borderRadius: '12px' }}>
            <Icon name="alert-triangle" size={24} />
          </div>
          <div>
            <p className="text-muted text-xs font-black uppercase tracking-widest">Kritis (Segera Beli)</p>
            <h3 className="text-2xl font-black">{data.filter(d => d.suggestPurchase > 0 && d.daysRemaining < 3).length} Item</h3>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <div style={{ backgroundColor: 'rgba(255, 149, 0, 0.1)', color: '#ff9500', padding: '1rem', borderRadius: '12px' }}>
            <Icon name="cart" size={24} />
          </div>
          <div>
            <p className="text-muted text-xs font-black uppercase tracking-widest">Perlu Restock</p>
            <h3 className="text-2xl font-black">{data.filter(d => d.suggestPurchase > 0).length} Item</h3>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <div style={{ backgroundColor: 'rgba(52, 199, 89, 0.1)', color: '#34c759', padding: '1rem', borderRadius: '12px' }}>
            <Icon name="check-circle" size={24} />
          </div>
          <div>
            <p className="text-muted text-xs font-black uppercase tracking-widest">Stok Aman</p>
            <h3 className="text-2xl font-black">{data.filter(d => d.suggestPurchase === 0).length} Item</h3>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="glass-panel" style={{ padding: '1rem 1.5rem', display: 'flex', gap: '3.5rem', flexWrap: 'wrap', alignItems: 'center', borderRadius: '16px', marginBottom: '2.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Icon name="trending-up" size={18} className="text-primary" />
          <span className="text-xs font-black uppercase text-muted tracking-tight">Analisis Data:</span>
          <select
            value={periodDays}
            onChange={e => setPeriodDays(parseInt(e.target.value))}
            className="input-field"
            style={{ width: 'auto', marginBottom: 0, padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
          >
            <option value={7}>7 Hari Terakhir</option>
            <option value={14}>14 Hari Terakhir</option>
            <option value={30}>30 Hari Terakhir</option>
            <option value={90}>90 Hari Terakhir</option>
          </select>
        </div>

        <div style={{ height: '24px', width: '1px', backgroundColor: 'var(--border-color)' }}></div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Icon name="info" size={18} className="text-primary" />
          <span className="text-xs font-black uppercase text-muted tracking-tight">Target Stok:</span>
          <input
            type="number"
            value={safetyDays}
            onChange={e => setSafetyDays(parseInt(e.target.value))}
            className="input-field"
            style={{ width: '60px', marginBottom: 0, padding: '0.3rem 0.6rem', fontSize: '0.8rem', textAlign: 'center' }}
          />
          <span className="text-xs text-muted">hari</span>
        </div>

        <div style={{ height: '24px', width: '1px', backgroundColor: 'var(--border-color)' }}></div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Icon name="alert-triangle" size={18} className="text-primary" />
          <span className="text-xs font-black uppercase text-muted tracking-tight">Batas Peringatan:</span>
          <input
            type="number"
            value={thresholdDays}
            onChange={e => setThresholdDays(parseInt(e.target.value) || 0)}
            className="input-field"
            style={{ width: '60px', marginBottom: 0, padding: '0.3rem 0.6rem', fontSize: '0.8rem', textAlign: 'center' }}
          />
          <span className="text-xs text-muted">hari</span>
        </div>
      </div>

      {/* Recommendation Table */}
      <div className="glass-panel overflow-hidden border-none shadow-xl mb-12" style={{ padding: 0, borderRadius: '16px' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--primary)', color: 'white' }}>
                <th style={thStyle}>No</th>
                <th style={thStyle}>Nama Item</th>
                <th style={thStyle}>Kategori</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Pemakaian/Hari</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Stok Saat Ini (Total)</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Prediksi Sisa</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Rekomendasi Beli</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '3rem' }}>Memuat analisis data...</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '3rem' }}>Tidak ada data penggunaan ditemukan.</td></tr>
              ) : data.map((item, idx) => (
                <tr key={item.key} style={{
                  borderBottom: '1px solid var(--border-color)',
                  backgroundColor: item.suggestPurchase > 0 ? (item.daysRemaining < 3 ? 'rgba(255, 56, 60, 0.03)' : 'rgba(255, 149, 0, 0.02)') : 'transparent'
                }}>
                  <td style={tdStyle}>{idx + 1}</td>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 800 }}>{item.name}</div>
                    {item.variant && item.variant !== 'Standar' && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--primary)', fontWeight: 600 }}>Varian: {item.variant}</div>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      fontSize: '0.7rem',
                      padding: '0.2rem 0.5rem',
                      borderRadius: '50px',
                      backgroundColor: item.type === 'Product' ? 'rgba(52, 199, 89, 0.1)' : 'rgba(13, 111, 255, 0.1)',
                      color: item.type === 'Product' ? '#096C46' : '#0d6fff',
                      fontWeight: 700
                    }}>
                      {item.type}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700 }}>
                    {item.avgDailyUsage.toFixed(2)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 800 }}>
                    {item.currentStock.toLocaleString('id-ID')}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <div style={{
                      display: 'inline-block',
                      padding: '0.25rem 0.75rem',
                      borderRadius: '6px',
                      backgroundColor: getStatusColor(item.daysRemaining) + '20',
                      color: getStatusColor(item.daysRemaining),
                      fontWeight: 800
                    }}>
                      {item.daysRemaining > 90 ? '> 3 Bulan' : `${Math.floor(item.daysRemaining)} Hari`}
                    </div>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {item.suggestPurchase > 0 ? (
                      <div style={{ color: item.daysRemaining < 3 ? '#ff383c' : '#ff9500', fontWeight: 900, fontSize: '1rem' }}>
                        + {item.suggestPurchase.toLocaleString('id-ID')}
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    {item.suggestPurchase > 0 ? (
                      <div style={{ color: item.daysRemaining < 3 ? '#ff383c' : '#ff9500', display: 'flex', justifyContent: 'center' }}>
                        <Icon name="cart" size={20} />
                      </div>
                    ) : (
                      <div style={{ color: '#34c759', display: 'flex', justifyContent: 'center' }}>
                        <Icon name="check-circle" size={20} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-16 flex gap-4 glass-panel" style={{ padding: '2rem 1.5rem', backgroundColor: 'rgba(13, 111, 255, 0.05)', border: '1px dashed rgba(13, 111, 255, 0.3)' }}>
        <Icon name="bar-chart" className="text-primary" size={24} />
        <div>
          <h4 className="text-sm font-bold text-primary mb-1">Catatan Analisis</h4>
          <p className="text-xs text-muted leading-relaxed">
            Rekomendasi ini dihitung berdasarkan rumus: <code>(Pemakaian Harian × Target Hari) - Stok Saat Ini</code>.
            Stok Saat Ini adalah total keseluruhan fisik barang yang tersebar di seluruh cabang. Pastikan input laporan shift rutin dilakukan untuk akurasi data yang lebih baik.
          </p>
        </div>
      </div>
    </div>
  );
}

const thStyle = {
  padding: '1rem',
  textAlign: 'left',
  fontWeight: 900,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  borderBottom: '2px solid rgba(0,0,0,0.05)'
};

const tdStyle = {
  padding: '1rem',
  textAlign: 'left',
  borderBottom: '1px solid var(--border-color)'
};
