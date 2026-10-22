import React, { useState, useEffect, useMemo } from 'react';
import Icon from '../components/Icon';
import { supabase } from '../supabase';
import { format, startOfMonth, endOfMonth } from 'date-fns';

// Tanggal lokal (WIB) — toISOString() geser ke UTC, bikin "Bulan Ini" mulai tgl terakhir bulan lalu.
const ymd = (d) => format(d, 'yyyy-MM-dd');
const presetRange = (period) => {
  const now = new Date();
  if (period === 'Hari Ini') return [ymd(now), ymd(now)];
  if (period === 'Bulan Ini') return [ymd(startOfMonth(now)), ymd(endOfMonth(now))];
  return ['', '']; // Semua Waktu
};

export default function AdminStock() {
  const [reports, setReports] = useState([]);
  const [productsMap, setProductsMap] = useState({});
  const [branches, setBranches] = useState([]);
  const [filterPeriod, setFilterPeriod] = useState('Bulan Ini'); // 'Hari Ini', 'Bulan Ini', 'Semua Waktu', 'Pilih Tanggal'
  const [startDate, setStartDate] = useState(() => presetRange('Bulan Ini')[0]);
  const [endDate, setEndDate] = useState(() => presetRange('Bulan Ini')[1]);
  const [filterBranch, setFilterBranch] = useState('Semua Cabang');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchInitialData();
  }, []);

  useEffect(() => {
    fetchReports();
  }, [startDate, endDate, filterBranch]);

  const handlePeriodChange = (period) => {
    setFilterPeriod(period);
    if (period === 'Pilih Tanggal') return; // pertahankan tanggal yang ada, user tinggal ubah
    const [s, e] = presetRange(period);
    setStartDate(s);
    setEndDate(e);
  };

  const handleDateChange = (setter) => (e) => {
    setter(e.target.value);
    setFilterPeriod('Pilih Tanggal');
  };

  const fetchInitialData = async () => {
    try {
      // 1. Fetch categories
      const { data: pData } = await supabase.from('products').select('name, category');
      const pMap = {};
      if (pData) {
        pData.forEach(p => pMap[p.name] = p.category);
      }
      setProductsMap(pMap);

      // 2. Fetch branches
      const { data: bData } = await supabase.from('outlets').select('name');
      if (bData) {
        setBranches(bData);
      }
    } catch (err) {
      console.error('Error fetching initial data:', err);
    }
  };

  const fetchReports = async () => {
    try {
      setLoading(true);
      const buildQuery = () => {
        let q = supabase.from('sales_reports').select('date, branch_name, total_revenue, details, staff_name').order('id');
        if (filterBranch !== 'Semua Cabang') q = q.eq('branch_name', filterBranch);
        if (startDate) q = q.gte('date', startDate);
        if (endDate) q = q.lte('date', endDate);
        return q;
      };

      // Ambil per halaman 1000 (batas Supabase) — range panjang / Semua Waktu bisa lewat 1000 laporan.
      let data = [];
      for (let from = 0; ; from += 1000) {
        const { data: page, error } = await buildQuery().range(from, from + 999);
        if (error) throw error;
        data = data.concat(page || []);
        if (!page || page.length < 1000) break;
      }
      // Buang laporan simulasi / stress test biar leaderboard cuma cabang beneran.
      setReports((data || []).filter(r => !/simulasi|tester/i.test(r.staff_name || '')));
    } catch (err) {
      console.error('Error fetching reports:', err);
      setReports([]);
    } finally {
      setLoading(false);
    }
  };

  // --- Aggregation Logic ---
  const { topDrinks, topToppings, topBranches, topDrinkPerBranch } = useMemo(() => {
    if (!reports.length) return { topDrinks: [], topToppings: [], topBranches: [], topDrinkPerBranch: {} };

    const drinkStats = {};
    const toppingStats = {};
    const branchStats = {};
    const branchDrinkStats = {}; // { branchName: { drinkName: qty } }

    reports.forEach(r => {
      const bName = r.branch_name;
      branchStats[bName] = (branchStats[bName] || 0) + (r.total_revenue || 0);

      if (!branchDrinkStats[bName]) branchDrinkStats[bName] = {};

      if (r.details) {
        r.details.filter(d => !d._is_meta && !d._is_inventory_snapshot).forEach(d => {
            const qty = parseInt(d.qty) || 0;
            if (qty <= 0) return;

            let itemName = d.name;
            const cat = productsMap[itemName] || 'Unknown';
            
            let isGulaMilkTea = itemName.toLowerCase().includes('gula milk tea');
            let isDrink = false;
            let isTopping = false;
            let finalKey = d.variant && d.variant !== 'Standar' ? `${itemName} (${d.variant})` : itemName;

            if (isGulaMilkTea) {
               isDrink = true;
               if (itemName.toLowerCase().includes('ori')) {
                  finalKey = 'Milk Tea (Ori)';
               } else if (itemName.toLowerCase().includes('premi')) {
                  finalKey = 'Milk Tea (Premi)';
               } else {
                  finalKey = 'Milk Tea';
               }
            } else if (cat === 'Topping') {
               isTopping = true;
            } else if (cat !== 'Unknown' && cat !== 'Bahan') {
               isDrink = true;
            } else {
               return; // Abaikan Bahan lain seperti Gula 1, Cup, Sedotan dll
            }

            if (isTopping) {
              toppingStats[finalKey] = (toppingStats[finalKey] || 0) + qty;
            } else if (isDrink) {
              drinkStats[finalKey] = (drinkStats[finalKey] || 0) + qty;
              branchDrinkStats[bName][finalKey] = (branchDrinkStats[bName][finalKey] || 0) + qty;
            }
          });
      }
    });

    const sortObject = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);

    const sortedDrinks = sortObject(drinkStats).slice(0, 5);
    const sortedToppings = sortObject(toppingStats).slice(0, 5);
    const sortedBranches = sortObject(branchStats).slice(0, 5);

    const bestDrinkPerBranchObj = {};
    Object.keys(branchDrinkStats).forEach(b => {
      const sorted = sortObject(branchDrinkStats[b]);
      if (sorted.length > 0) bestDrinkPerBranchObj[b] = sorted[0];
    });

    return {
      topDrinks: sortedDrinks,
      topToppings: sortedToppings,
      topBranches: sortedBranches,
      topDrinkPerBranch: bestDrinkPerBranchObj
    };
  }, [reports, productsMap]);

  return (
    <div className="animate-fade-in pb-10">
      <div className="page-title flex justify-between items-center">
        <div>
          <h1 className="text-primary mb-1 text-2xl font-black">Leaderboard Penjualan</h1>
          <p className="text-muted text-sm font-medium">Peringkat produk dan outlet paling laris.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="glass-panel" style={{ padding: '1rem 1.5rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', borderRadius: '16px' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flex: '1 1 auto', minWidth: '200px' }}>
          <Icon name="store" size={20} className="text-muted" />
          <select
            className="input-field"
            style={{ width: '100%', marginBottom: 0 }}
            value={filterBranch}
            onChange={(e) => setFilterBranch(e.target.value)}
          >
            <option value="Semua Cabang">Semua Cabang</option>
            {branches.map(b => (
              <option key={b.name} value={b.name}>{b.name}</option>
            ))}
          </select>
        </div>

        <div className="hidden-mobile" style={{ height: '24px', width: '1px', backgroundColor: 'var(--border-color)' }}></div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flex: '1 1 auto' }}>
          <Icon name="calendar" size={20} className="text-muted" />
          <select
            className="input-field"
            style={{ width: '100%', marginBottom: 0 }}
            value={filterPeriod}
            onChange={(e) => handlePeriodChange(e.target.value)}
          >
            <option value="Hari Ini">Hari Ini</option>
            <option value="Bulan Ini">Bulan Ini</option>
            <option value="Semua Waktu">Semua Waktu</option>
            <option value="Pilih Tanggal">Pilih Tanggal</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flex: '1 1 300px' }}>
          <input
            type="date"
            className="input-field"
            style={{ width: '100%', padding: '0.4rem 0.6rem', marginBottom: 0 }}
            value={startDate}
            max={endDate || undefined}
            onChange={handleDateChange(setStartDate)}
          />
          <span className="text-muted" style={{ fontSize: '0.9rem' }}>s/d</span>
          <input
            type="date"
            className="input-field"
            style={{ width: '100%', padding: '0.4rem 0.6rem', marginBottom: 0 }}
            value={endDate}
            min={startDate || undefined}
            onChange={handleDateChange(setEndDate)}
          />
        </div>
      </div>

      {loading ? (
        <p className="text-muted text-center py-8">Memuat Leaderboard...</p>
      ) : reports.length === 0 ? (
        <p className="text-muted text-center py-8">Belum ada data penjualan untuk filter ini.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: '1.75rem' }}>

          {/* Top Minuman */}
          <div className="glass-panel" style={{ padding: '1.5rem', borderRadius: '16px' }}>
            <h3 className="text-primary mb-4 flex items-center gap-2" style={{ fontSize: '1.1rem', fontWeight: 900 }}>
              <Icon name="trophy" size={22} style={{ color: 'var(--lime-ink)' }} />
              Top 5 Minuman Terlaris
            </h3>
            {topDrinks.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {topDrinks.map(([name, qty], idx) => (
                  <RankRow key={idx} rank={idx + 1} title={name} value={`${qty} Cup`} />
                ))}
              </div>
            ) : (
              <p className="text-muted text-sm italic">Belum ada data minuman terjual.</p>
            )}
          </div>

          {/* Top Topping */}
          <div className="glass-panel" style={{ padding: '1.5rem', borderRadius: '16px' }}>
            <h3 className="text-primary mb-4 flex items-center gap-2" style={{ fontSize: '1.1rem', fontWeight: 900 }}>
              <Icon name="star" size={22} style={{ color: 'var(--lime-ink)' }} />
              Top 5 Topping Terlaris
            </h3>
            {topToppings.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {topToppings.map(([name, qty], idx) => (
                  <RankRow key={idx} rank={idx + 1} title={name} value={`${qty} Porsi`} />
                ))}
              </div>
            ) : (
              <p className="text-muted text-sm italic">Belum ada data topping terjual.</p>
            )}
          </div>

          {/* Top Outlet (Only visible if Semua Cabang) */}
          {filterBranch === 'Semua Cabang' && (
            <div className="glass-panel md:col-span-2" style={{ padding: '1.5rem', borderRadius: '16px', gridColumn: '1 / -1' }}>
              <h3 className="text-primary mb-4 flex items-center gap-2" style={{ fontSize: '1.1rem', fontWeight: 900 }}>
                <Icon name="shop-huge" size={22} style={{ color: 'var(--lime-ink)' }} />
                Outlet Paling Laris (Omset Tertinggi)
              </h3>
              {topBranches.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.25rem' }}>
                  {topBranches.map(([branch, revenue], idx) => (
                    <div key={idx} style={{
                      padding: '1.5rem',
                      borderRadius: '12px', 
                      border: '1px solid var(--border-color)',
                      backgroundColor: idx === 0 ? 'rgba(184, 240, 0, 0.15)' : 'transparent',
                      borderColor: idx === 0 ? 'var(--lime-ink)' : 'var(--border-color)',
                      position: 'relative',
                      overflow: 'hidden'
                    }}>
                      {idx === 0 && (
                        <div style={{ position: 'absolute', top: '-10px', right: '-10px', opacity: 0.1 }}>
                          <Icon name="medal" size={80} />
                        </div>
                      )}
                      <div className="flex items-center gap-3 mb-2">
                        <div style={{ 
                          width: '32px', height: '32px', 
                          borderRadius: '50%', 
                          backgroundColor: idx === 0 ? 'var(--lime)' : 'var(--bg-dark)',
                          border: idx === 0 ? 'none' : '1px solid var(--border-color)',
                          color: idx === 0 ? 'var(--lime-ink)' : 'var(--text-muted)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 'bold', fontSize: '14px'
                        }}>
                          #{idx + 1}
                        </div>
                        <h4 style={{ fontWeight: 800, fontSize: '1rem' }}>{branch}</h4>
                      </div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 900, color: 'var(--primary)' }}>
                        Rp {revenue.toLocaleString('id-ID')}
                      </div>
                      
                      {/* Best Selling item per branch */}
                      {topDrinkPerBranch[branch] && (
                        <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <Icon name="flame" size={12} style={{ color: 'var(--lime-ink)' }} />
                          Terlaris: {topDrinkPerBranch[branch][0]} ({topDrinkPerBranch[branch][1]})
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted text-sm italic">Belum ada data omset.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Sub-component for rendering Top 5 list rows
const RankRow = ({ rank, title, value }) => {
  const isTop3 = rank <= 3;
  // Cuma juara #1 yang di-highlight (hijau nyala + hitam) — sisanya netral, sama gaya .page-title.
  const colors = rank === 1
    ? { bg: 'var(--lime)', text: 'var(--lime-ink)', border: 'var(--lime)' }
    : { bg: 'transparent', text: 'var(--text-main)', border: 'var(--border-color)' };

  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      gap: '1rem', padding: '0.85rem 1.1rem', borderRadius: '10px',
      border: `1px solid ${rank === 1 ? 'var(--lime-ink)' : colors.border}`,
      backgroundColor: rank === 1 ? 'rgba(184, 240, 0, 0.15)' : 'transparent'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', minWidth: 0 }}>
        <div style={{ 
          display: 'flex', justifyContent: 'center', alignItems: 'center', 
          borderRadius: '50%', width: '28px', height: '28px', 
          fontSize: '0.75rem', fontWeight: 800,
          backgroundColor: colors.bg,
          color: colors.text,
          border: `1px solid ${colors.border}`
        }}>
          {rank}
        </div>
        <span style={{ fontWeight: isTop3 ? 700 : 500, fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
      </div>
      <div style={{ fontWeight: 800, color: 'var(--primary)', fontSize: '0.9rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
        {value}
      </div>
    </div>
  );
};
