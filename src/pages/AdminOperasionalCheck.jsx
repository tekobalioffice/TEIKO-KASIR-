import React, { useState, useEffect } from 'react';
import Icon from '../components/Icon';
import { supabase } from '../supabase';
import { useLocalStorageBranch } from '../hooks/useLocalStorageBranch';
import { useLocalStorageDate } from '../hooks/useLocalStorageDate';

export default function AdminOperasionalCheck() {
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useLocalStorageBranch('');
  const [stockReports, setStockReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dynamicStockItems, setDynamicStockItems] = useState([]);
  const [selectedDate, setSelectedDate] = useLocalStorageDate('adminOperasionalCheck_date', new Date().toISOString().split('T')[0]);

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    try {
      // 1. Fetch both products and operational_items
      const [opRes, prodRes] = await Promise.all([
        supabase.from('operational_items').select('*'),
        supabase.from('products').select('*')
      ]);

      let combined = [];
      if (prodRes.data) {
        combined = [...combined, ...prodRes.data.map(p => ({ ...p, category: p.category || 'Minuman' }))];
      }
      if (opRes.data) {
        combined = [...combined, ...opRes.data.map(o => ({ ...o, category: 'Bahan' }))];
      }

      // Sort and group
      combined.sort((a, b) => (a.display_order || 999) - (b.display_order || 999));
      
      const grouped = {};
      combined.forEach(item => {
        if (!grouped[item.name]) grouped[item.name] = [];
        grouped[item.name].push(item);
      });
      
      let flatList = [];
      Object.entries(grouped).forEach(([name, variants]) => {
         const sortedVariants = variants.sort((a,b) => {
           const ord = {'Ori':1, 'Premi':2, 'Standar':3};
           return (ord[a.variant]||99) - (ord[b.variant]||99);
         });
         flatList.push(...sortedVariants);
      });
      
      setDynamicStockItems(flatList);

      // 2. Fetch branches
      const { data: bData, error } = await supabase.from('outlets').select('name');
      if (error) throw error;
      setBranches(bData || []);
      if (bData && bData.length > 0) {
        const savedBranch = localStorage.getItem('lastSelectedBranch');
        const branchToUse = (savedBranch && bData.some(b => b.name === savedBranch)) ? savedBranch : bData[0].name;
        setSelectedBranch(branchToUse);
        fetchStockForBranch(branchToUse, selectedDate);
      } else {
        setLoading(false);
      }
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  const fetchStockForBranch = async (branchName, date) => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('sales_reports')
        .select('*')
        .eq('branch_name', branchName)
        .eq('date', date || selectedDate)
        .order('shift', { ascending: true });

      if (error) throw error;
      setStockReports(data || []);
    } catch (err) {
      console.error(err);
      setStockReports([]);
    } finally {
      setLoading(false);
    }
  };

  const handleBranchChange = (e) => {
    setSelectedBranch(e.target.value);
    fetchStockForBranch(e.target.value, selectedDate);
  };

  const handleDateChange = (e) => {
    setSelectedDate(e.target.value);
    fetchStockForBranch(selectedBranch, e.target.value);
  };

  // Helper: get stock data for an item from stock array in a report
  const getStockData = (report, item) => {
    // 1. First, check if there's anything in report.stocks (for backward compatibility)
    if (report.stocks && report.stocks.length > 0) {
      const found = report.stocks.find(s => {
         if (item.category === 'Bahan') return s.name === item.name;
         return s.name === item.name && s.variant === item.variant;
      });
      if (found) {
        return {
          awal: found.awal !== undefined ? found.awal : '-',
          masuk: found.masuk !== undefined ? found.masuk : '-',
          sisa: found.sisa !== undefined ? found.sisa : '-',
          used: found.used !== undefined ? found.used : found.qty !== undefined ? found.qty : '-',
          gudang: '-'
        };
      }
    }

    // 2. Otherwise, extract from report.details
    if (!report.details) return { awal: '-', masuk: '-', sisa: '-', used: '-', gudang: '-' };
    
    const invSnapshot = report.details.find(d => d._is_inventory_snapshot);
    const inventoryMap = invSnapshot ? (invSnapshot.inventory_map || {}) : {};
    
    const detailItem = report.details.find(d => {
       if (d._is_meta || d._is_inventory_snapshot) return false;
       if (item.category === 'Bahan') return d.name === item.name;
       return d.name === item.name && d.variant === item.variant;
    });

    if (!detailItem) return { awal: '-', masuk: '-', sisa: '-', used: '-', gudang: '-' };

    const stockKey = item.variant && item.variant !== 'Standar' ? `${item.name} (${item.variant})` : item.name;
    // Awal = stok display awal shift (display_awal). Fallback ke snapshot total lama cuma
    // buat laporan pra-fix / item Bahan yang ga punya display_awal.
    const awal = detailItem.display_awal ?? inventoryMap[stockKey] ?? inventoryMap[item.name] ?? '-';

    let sisa = detailItem.sisa_input !== undefined && detailItem.sisa_input !== '' ? detailItem.sisa_input : '-';

    let used = '-';
    if (item.category === 'Bahan') {
      if (awal !== '-' && sisa !== '-') {
        used = (parseFloat(awal) + parseFloat(detailItem.tambah ?? 0)) - parseFloat(sisa);
      }
    } else {
      used = detailItem.terjual_fisik ?? detailItem.qty ?? '-';
    }

    // Masuk = arus masuk BERSIH ke display shift ini (pindah dari gudang + kiriman - kurasi),
    // direkonsiliasi biar baris SELALU balance: Awal + Masuk - Terpakai = Sisa. Nilai `tambah`
    // mentah dari laporan bisa 0 walau ada pergerakan (window scan log ke-truncate) — jangan
    // tampilkan selisih tak terjelaskan.
    let masuk;
    const nA = parseFloat(awal), nS = parseFloat(sisa), nU = parseFloat(used);
    if (detailItem.masuk_net !== undefined && detailItem.masuk_net !== null) {
      masuk = detailItem.masuk_net; // laporan baru: sudah direkonsiliasi saat simpan
    } else if (Number.isFinite(nA) && Number.isFinite(nS) && Number.isFinite(nU)) {
      masuk = Math.round((nS - nA + nU) * 1000) / 1000;
    } else {
      masuk = detailItem.tambah ?? 0;
    }

    return {
      awal,
      masuk: masuk === 0 ? 0 : (masuk || '-'),
      sisa,
      used,
      gudang: detailItem.safety_remaining ?? '-'
    };
  };

  return (
    <div className="animate-fade-in">
      <div className="page-title flex justify-between items-center">
        <div>
          <h1 className="text-primary mb-1">Input Form Stok Barang Checking</h1>
          <p className="text-muted">Pantau hasil input form stok barang tiap cabang (seperti laporan Excel tanpa perlu download).</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => fetchStockForBranch(selectedBranch)} className="btn-primary">
            <Icon name="refresh" size={16} /> Refresh
          </button>
        </div>
      </div>

      {/* Filters: Branch & Date */}
      <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem', display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: '1', minWidth: '250px' }}>
          <Icon name="store" size={20} className="text-muted" />
          <div style={{ width: '100%' }}>
            <label className="text-muted" style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', textTransform: 'uppercase' }}>Filter Cabang</label>
            <select
              className="input-field"
              style={{ width: '100%', backgroundColor: 'rgba(255,255,255,0.8)' }}
              value={selectedBranch}
              onChange={handleBranchChange}
            >
              {branches.length === 0 && <option value="">Buat cabang di menu Cabang dulu</option>}
              {branches.map(b => (
                <option key={b.name} value={b.name}>{b.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: '1', minWidth: '200px' }}>
          <div style={{ width: '100%' }}>
            <label className="text-muted" style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', textTransform: 'uppercase' }}>Filter Tanggal</label>
            <input 
              type="date" 
              className="input-field" 
              style={{ width: '100%', backgroundColor: 'rgba(255,255,255,0.8)' }}
              value={selectedDate}
              onChange={handleDateChange}
            />
          </div>
        </div>
      </div>

      {/* Reports List */}
      <div className="space-y-6">
        {loading ? (
          <div className="glass-panel text-center py-12">
            <Icon name="refresh" className="animate-spin text-primary mx-auto mb-4" size={32} />
            <p className="text-muted">Memuat data laporan...</p>
          </div>
        ) : stockReports.length === 0 ? (
          <p className="text-muted text-center py-8">Tidak ada data laporan untuk kriteria ini.</p>
        ) : stockReports.map((report) => (
          <div key={report.id} className="glass-panel shadow-sm" style={{ padding: '1.5rem', marginBottom: '1.5rem', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                  <h3 style={{ fontSize: '1.1rem', color: 'var(--primary)', fontWeight: 800 }}>{new Date(report.date).toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</h3>
                  <span style={{ backgroundColor: 'var(--primary)', color: 'white', padding: '0.2rem 0.6rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 900, textTransform: 'uppercase' }}>Shift {report.shift}</span>
                </div>
                <p className="text-muted" style={{ fontSize: '0.85rem' }}>Oleh: <span style={{ fontWeight: 700, color: 'var(--text-dark)' }}>{report.staff_name}</span></p>
              </div>
              <div style={{ textAlign: 'right' }}>
                 <p className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 700 }}>ID Laporan</p>
                 <p style={{ fontWeight: 700, fontSize: '0.8rem' }}>#{report.id}</p>
              </div>
            </div>

            <div className="table-responsive" style={{ marginTop: '1rem', border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
              <table className="data-table" style={{ margin: 0, minWidth: '600px', width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ backgroundColor: 'rgba(0,0,0,0.03)' }}>
                  <tr>
                    <th style={{ width: '50px', textAlign: 'center', padding: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>No</th>
                    <th style={{ padding: '0.75rem', borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>Nama Item</th>
                    <th style={{ textAlign: 'center', padding: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>Awal</th>
                    <th style={{ textAlign: 'center', padding: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>Masuk</th>
                    <th style={{ textAlign: 'center', padding: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>Sisa Display</th>
                    <th style={{ textAlign: 'center', padding: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>Terpakai</th>
                    <th style={{ textAlign: 'center', padding: '0.75rem', borderBottom: '1px solid var(--border-color)' }} title="Sisa stok di Gudang/Laci (safety) akhir shift">Gudang</th>
                  </tr>
                </thead>
                <tbody>
                  {dynamicStockItems.map((item, idx) => {
                    const { awal, masuk, sisa, used, gudang } = getStockData(report, item);
                    const orderNumber = item.display_order || 999;
                    const displayName = item.category === 'Bahan' ? item.name : `${item.name} ${item.variant && item.variant !== 'Standar' ? `(${item.variant})` : ''}`;
                    const isBahan = item.category === 'Bahan';
                    const isTopping = item.category === 'Topping';

                    return (
                      <tr key={idx} style={{ backgroundColor: isBahan ? 'rgba(13, 111, 255,0.02)' : 'white', borderBottom: '1px solid var(--border-color)' }}>
                        <td className="text-muted" style={{ textAlign: 'center', padding: '0.75rem' }}>
                          {orderNumber <= 100 ? orderNumber : '-'}
                        </td>
                        <td style={{ fontWeight: 600, padding: '0.75rem' }}>
                          {displayName} 
                          {isBahan && <span style={{ marginLeft: '0.5rem', fontSize: '0.65rem', backgroundColor: 'rgba(13, 111, 255,0.1)', color: '#0d6fff', padding: '0.1rem 0.3rem', borderRadius: '4px' }}>SUPPORT</span>}
                          {isTopping && <span style={{ marginLeft: '0.5rem', fontSize: '0.65rem', backgroundColor: 'rgba(255, 45, 85,0.1)', color: '#ff2d55', padding: '0.1rem 0.3rem', borderRadius: '4px' }}>TOPPING</span>}
                        </td>
                        <td style={{ textAlign: 'center', padding: '0.75rem' }}>{awal}</td>
                        <td style={{ textAlign: 'center', padding: '0.75rem' }}>{masuk}</td>
                        <td style={{ textAlign: 'center', fontWeight: 800, color: 'var(--text-dark)', padding: '0.75rem' }}>{sisa}</td>
                        <td style={{ textAlign: 'center', fontWeight: 800, color: used > 0 ? 'var(--danger)' : 'var(--text-muted)', padding: '0.75rem' }}>{used}</td>
                        <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--text-muted)', padding: '0.75rem' }}>{gudang}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const thStyle = {
  padding: '0.75rem',
  textAlign: 'left',
  fontWeight: 700,
  border: '1px solid rgba(255,255,255,0.1)'
};

const tdStyle = {
  padding: '0.75rem',
  textAlign: 'left',
  border: '1px solid var(--border-color)'
};
