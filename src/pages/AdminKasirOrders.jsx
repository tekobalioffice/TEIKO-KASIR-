import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import Icon from '../components/Icon';
import Receipt from '../components/Receipt';

const CHANNEL_LABEL = { offline: 'Offline', gojek: 'Gojek', grab: 'Grab' };
const PAY_LABEL = { cash: 'Tunai', qris: 'QRIS', gojek: 'Gojek', grab: 'Grab' };
const rp = (n) => `Rp ${(Number(n) || 0).toLocaleString('id-ID')}`;
const todayLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// Riwayat transaksi Kasir per struk (tabel orders + order_items), per cabang & tanggal laporan.
// Menu rasa (Strawberry dll) tersimpan 2 baris: rasa (harga gabungan) + dasar Rp 0 (Full Cream/Coffee Cream).
export default function AdminKasirOrders() {
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [orders, setOrders] = useState([]);
  const [loadedKey, setLoadedKey] = useState(''); // cabang|tanggal yang datanya sudah termuat
  const [reprint, setReprint] = useState(null);

  useEffect(() => {
    supabase.from('outlets').select('name').order('name').then(({ data }) => {
      setBranches(data || []);
      if (data?.length) setBranch(b => b || data[0].name);
    });
  }, []);

  useEffect(() => {
    if (!branch) return;
    let cancelled = false;
    supabase.from('orders').select('*, order_items(product_name, variant, qty, price)')
      .eq('branch_name', branch).eq('report_date', date).order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) alert(`Gagal ambil transaksi Kasir:\n${error.message}`);
        setOrders(data || []);
        setLoadedKey(`${branch}|${date}`);
      });
    return () => { cancelled = true; };
  }, [branch, date]);

  const loading = loadedKey !== `${branch}|${date}`;
  // Transaksi batal tetap ditampilkan (dicoret) tapi tidak ikut total.
  const valid = orders.filter(o => !o.voided_at);
  const total = valid.reduce((s, o) => s + (o.total || 0), 0);
  const byPay = valid.reduce((m, o) => ({ ...m, [o.payment_method || 'cash']: (m[o.payment_method || 'cash'] || 0) + (o.total || 0) }), {});
  const byShift = valid.reduce((m, o) => ({ ...m, [o.shift || '-']: (m[o.shift || '-'] || 0) + (o.total || 0) }), {});

  if (reprint) {
    return (
      <div style={{ maxWidth: 360, margin: '0 auto' }}>
        <Receipt order={{ ...reprint, items: (reprint.order_items || []).filter(it => it.price > 0).map(it => ({ name: it.product_name, variant: it.variant, qty: it.qty, price: it.price })) }}
          branchName={reprint.branch_name} onDone={() => setReprint(null)} />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="page-title">
        <h1 className="text-primary mb-1">Transaksi Kasir</h1>
        <p className="text-muted">Semua penjualan lewat Kasir per struk. Stok dipotong saat Tutup Shift (lihat Riwayat Stok "Auto-Deduct").</p>
      </div>

      <div className="glass-panel" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <Icon name="store" size={18} className="text-muted" />
        <select className="input-field" style={{ maxWidth: 200, marginBottom: 0 }} value={branch} onChange={e => setBranch(e.target.value)}>
          {branches.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
        </select>
        <input type="date" className="input-field" style={{ maxWidth: 170, marginBottom: 0 }} value={date} onChange={e => setDate(e.target.value)} />
        <div style={{ marginLeft: 'auto', fontWeight: 800 }}>
          {valid.length} transaksi · {rp(total)}{orders.length > valid.length ? ` (${orders.length - valid.length} batal)` : ''}
        </div>
      </div>

      {!!orders.length && (
        <div className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '0.75rem', display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
          {Object.entries(byShift).map(([s, t]) => <span key={s}>Shift {s}: <strong>{rp(t)}</strong></span>)}
          {Object.entries(byPay).map(([c, t]) => <span key={c}>{PAY_LABEL[c] || c}: <strong>{rp(t)}</strong></span>)}
        </div>
      )}

      <div className="glass-panel table-responsive" style={{ overflowX: 'auto' }}>
        <table className="data-table" style={{ marginTop: 0, minWidth: 820 }}>
          <thead>
            <tr>
              <th>Waktu</th><th>No.</th><th>Shift</th><th>Channel</th><th>Kasir</th><th>Item</th>
              <th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Tunai</th><th style={{ textAlign: 'right' }}>Kembalian</th><th />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="text-center text-muted py-8">Memuat…</td></tr>
            ) : !orders.length ? (
              <tr><td colSpan={10} className="text-center text-muted py-8">Belum ada transaksi Kasir di tanggal ini.</td></tr>
            ) : orders.map(o => (
              <tr key={o.id} style={o.voided_at ? { opacity: 0.55, textDecoration: 'line-through' } : undefined} title={o.voided_at ? `Dibatalkan oleh ${o.voided_by}: ${o.void_reason}` : undefined}>
                <td>{new Date(o.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</td>
                <td style={{ fontFamily: 'monospace' }}>{String(o.id).slice(0, 8).toUpperCase()}</td>
                <td>{o.shift || '-'}</td>
                <td>{CHANNEL_LABEL[o.channel] || o.channel}{o.payment_method === 'qris' ? ' · QRIS' : ''}{o.voided_at ? <div style={{ color: 'var(--danger)', fontSize: '0.75rem', textDecoration: 'none' }}>BATAL: {o.void_reason}</div> : null}</td>
                <td>{o.staff_name || '-'}</td>
                <td style={{ fontSize: '0.85rem' }}>
                  {(o.order_items || []).map((it, i) => (
                    // Rp 0 = minuman dasar menu rasa (Full Cream di balik Strawberry, Coffee Cream di balik Hazelnut).
                    <div key={i} className={it.price > 0 ? '' : 'text-muted'} style={it.price > 0 ? undefined : { paddingLeft: '1rem', fontSize: '0.78rem' }}>
                      {it.price > 0 ? '' : '↳ isi: '}{it.qty}× {it.product_name}{it.variant && it.variant !== 'Standar' ? ` ${it.variant}` : ''}
                    </div>
                  ))}
                </td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{rp(o.total)}</td>
                <td style={{ textAlign: 'right' }}>{(o.payment_method || 'cash') === 'cash' && o.channel === 'offline' && o.paid_amount != null ? rp(o.paid_amount) : '-'}</td>
                <td style={{ textAlign: 'right' }}>{(o.payment_method || 'cash') === 'cash' && o.channel === 'offline' && o.paid_amount != null ? rp(Math.max(0, o.paid_amount - o.total)) : '-'}</td>
                <td><button className="btn-secondary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }} onClick={() => setReprint(o)}>Struk</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
