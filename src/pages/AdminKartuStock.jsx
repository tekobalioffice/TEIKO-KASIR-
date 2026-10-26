import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import Icon from '../components/Icon';
import { sumStockUsage } from '../utils/stockUtils';

// Penjualan Kasir yang BELUM dipotong dari stok: stok baru dipotong saat Tutup Shift, jadi
// order dari shift yang belum punya laporan (sales_reports) masih "menggantung".
// Hasil: { item_name: qty } — stok menu sendiri + cup + bahan resep (stockUsageOf).
async function fetchKasirPending(branchName, invItems) {
  const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const [{ data: orders }, { data: reports }, { data: products }] = await Promise.all([
    supabase.from('orders').select('report_date, shift, order_items(product_id, qty)')
      .eq('branch_name', branchName).gte('report_date', since).is('voided_at', null),
    supabase.from('sales_reports').select('date, shift').eq('branch_name', branchName).gte('date', since),
    supabase.from('products').select('id, name, variant, category, is_unlimited, is_non_base'),
  ]);
  const closed = new Set((reports || []).map(r => `${r.date}|${r.shift}`));
  const byId = Object.fromEntries((products || []).map(p => [p.id, p]));
  const lines = (orders || [])
    .filter(o => !closed.has(`${o.report_date}|${o.shift}`)) // shift tertutup = sudah dipotong
    .flatMap(o => (o.order_items || []).map(it => ({ product: byId[it.product_id], qty: it.qty || 0 })));
  return sumStockUsage(lines, invItems.map(i => i.item_name));
}

const EXCEL_ORDER = [
  "Gula 1", "Gula 2", "Premium Tea 1", "Premium 2", "Paper Cup", "Cup (Flat)", "Milo", "Beng-Beng", "GD Capucinno",
  "Extra Joss Susu", "NS Jeruk", "NS Jeruk Nipis", "NS Lemon", "NS Leci", "Dancow Cokelat", "Dancow Putih",
  "Madu Hutan", "Es Coklat", "Ice Roast", "Black Tea", "Gula Milk Tea", "Thai Tea", "Green Thai Tea", "Matcha Oat Latte",
  "Diamond BC", "Diamond Besar", "Ultra Milk Besar", "OatMilk", "Belgian Choco", "Strawberry", "Melon",
  "Avocado", "Green Tea Latte", "Choco Oreo", "Taro", "Ice Americano", "Espresso (Hot)", "Kopi Bali", "Teh Serai", "Teh Jahe", "Coffee Cream",
  "Brown Sugar", "Salted Caramel", "Hazelnut", "Bubble Besar", "Bubble Kecil", "Coffee Jelly", "Rainbow Jelly", "Leci Jelly", "Cao Jelly", "Pudding Coklat",
  "Pudding Vanilla", "Susu Kental Manis", "Gula Cair", "Krim Cair", "Sedotan Kecil", "Sedotan Besar",
  "Sedotan Topping", "Tutup Manual", "Kresek", "Tisu Kering", "Tisu Basah", "Sealer", "Form Penjualan",
  "Form Stok", "QCP", "Kertas Thermal", "Teh Matcha Latte"
];

// Fallbacks for DB naming differences
const ALIAS_MAP = {
  "Dancow coklat": "Dancow Cokelat",
  "Dancow putih": "Dancow Putih",
  "Teh Madu Hutan": "Madu Hutan",
  "Tehspresso Ori": "Ice Roast",
  "Tehspresso Premi": "Ice Roast"
};

export default function AdminKartuStock() {
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [kasirSold, setKasirSold] = useState({}); // item_name -> terjual Kasir, belum dipotong

  useEffect(() => {
    fetchBranches();
  }, []);

  const fetchBranches = async () => {
    setLoading(true);
    const { data: branchData } = await supabase.from('outlets').select('name');
    if (branchData && branchData.length > 0) {
      setBranches(branchData);
      setSelectedBranch(branchData[0].name);
      await fetchInventory(branchData[0].name);
    } else {
      setLoading(false);
    }
  };

  const fetchInventory = async (branchName) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('branch_inventory')
      .select('*')
      .eq('branch_name', branchName);
      
    if (error) {
      console.error(error);
      setLoading(false);
      return;
    }

    const items = data || [];
    setKasirSold(await fetchKasirPending(branchName, items).catch(e => { console.error(e); return {}; }));
    
    // Process and sort items based on EXCEL_ORDER
    const processedItems = items.map(item => {
      let mappedName = ALIAS_MAP[item.item_name] || item.item_name;
      let orderIndex = EXCEL_ORDER.findIndex(name => name.toLowerCase() === mappedName.toLowerCase());
      
      // Attempt exact matching first, if not found, it stays -1
      return {
        ...item,
        mappedName: item.item_name,
        orderIndex: orderIndex !== -1 ? orderIndex : 999
      };
    });

    processedItems.sort((a, b) => {
      if (a.orderIndex !== b.orderIndex) {
        return a.orderIndex - b.orderIndex;
      }
      return a.mappedName.localeCompare(b.mappedName);
    });

    setInventory(processedItems);
    setLoading(false);
  };

  const handleBranchChange = (e) => {
    setSelectedBranch(e.target.value);
    fetchInventory(e.target.value);
  };

  const parseQty = (val) => {
    if (val === undefined || val === null || val === '') return '—';
    return val;
  };

  return (
    <div className="animate-fade-in">
      <div className="page-title flex justify-between items-center">
        <div>
          <h1 className="text-primary mb-1">Kartu Stock Keseluruhan</h1>
          <p className="text-muted">Stok = stok tercatat (Display + Gudang). Terjual = penjualan Kasir shift yang belum ditutup (stok baru dipotong saat Tutup Shift). Sisa = Stok − Terjual.</p>
        </div>
      </div>

      <div className="flex justify-between items-center mb-4" style={{ gap: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flex: 1, backgroundColor: 'var(--panel-bg)', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
          <Icon name="store" size={20} className="text-muted" />
          <select className="input-field" style={{ maxWidth: '180px', marginBottom: 0 }} value={selectedBranch} onChange={handleBranchChange}>
            {branches.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
          </select>
          <button onClick={() => fetchInventory(selectedBranch)} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer' }}>
            <Icon name="refresh" size={18} />
          </button>
          
          <div style={{ width: '1px', height: '24px', backgroundColor: 'var(--border-color)', margin: '0 0.5rem' }}></div>
          
          <Icon name="search" size={18} className="text-muted" />
          <input 
            type="text" 
            style={{ marginBottom: 0, border: 'none', background: 'transparent', padding: '0', outline: 'none', boxShadow: 'none', flex: 1, fontSize: '0.95rem' }} 
            placeholder="Cari item..." 
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="glass-panel table-responsive" style={{ overflowX: 'auto', overflowY: 'hidden' }}>
        <table className="data-table" style={{ marginTop: 0, minWidth: '800px' }}>
          <thead style={{ backgroundColor: 'rgba(0,0,0,0.03)' }}>
            <tr>
              <th style={{ width: '50px', textAlign: 'center' }}>No</th>
              <th>Nama Item</th>
              <th style={{ textAlign: 'center' }}>Stok</th>
              <th style={{ textAlign: 'center' }}>Terjual (Kasir)</th>
              <th style={{ textAlign: 'center' }}>Sisa</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center text-muted py-8">Memuat data kartu stock...</td></tr>
            ) : inventory.length === 0 ? (
                <tr><td colSpan={5} className="text-center text-muted py-8">Belum ada item di cabang ini.</td></tr>
            ) : inventory.filter(item => item.item_name.toLowerCase().includes(searchTerm.toLowerCase())).map((item, idx) => {
              const qty = item.current_qty;
              const isNotSet = qty === null || qty === '';
              const terjual = kasirSold[item.item_name] || 0;
              const sisa = (Number(qty) || 0) - terjual;
              const num = { textAlign: 'center', fontSize: '1.1rem', fontWeight: 700, fontFamily: 'monospace' };
              
              return (
                <tr key={item.id || idx}>
                  <td className="text-muted" style={{ textAlign: 'center' }}>{idx + 1}</td>
                  <td style={{ fontWeight: 600 }}>{item.item_name}</td>
                  <td style={{ textAlign: 'center', fontSize: '1.1rem', fontWeight: 700, fontFamily: 'monospace', color: isNotSet ? 'var(--text-muted)' : 'inherit' }}>
                    {parseQty(qty)}
                  </td>
                  <td style={{ ...num, color: terjual ? '#ff9500' : 'var(--text-muted)' }}>{terjual ? `−${+terjual.toFixed(2)}` : '—'}</td>
                  <td style={{ ...num, color: sisa < 0 ? 'var(--danger)' : 'inherit' }}>{isNotSet && !terjual ? '—' : +sisa.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
