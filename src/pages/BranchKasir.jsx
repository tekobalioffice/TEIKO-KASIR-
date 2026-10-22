import React, { useState, useEffect, useMemo } from 'react';
import { useOutletContext, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLocalStorageBranch } from '../hooks/useLocalStorageBranch';
import Icon from '../components/Icon';
import { supabase } from '../supabase';
import Receipt from '../components/Receipt';

// Kasir motong branch_inventory langsung saat checkout (channel apa pun — offline,
// Gojek, Grab — jalur sama), pakai kunci nama item yang sama dengan opname
// (nama produk + varian, lihat stockKeyFor). Jadi Kartu Stok selalu balance LIVE,
// bukan cuma ketahuan pas opname akhir shift. Produk yang belum punya baris
// branch_inventory (item campuran bahan, dll) dilewati tanpa error — itu tetap
// jalur manual opname seperti sekarang.
const stockKeyFor = (product) =>
  product.variant && product.variant !== 'Standar' ? `${product.name} ${product.variant}` : product.name;

const CHANNELS = [
  { id: 'offline', label: 'Offline' },
  { id: 'gojek', label: 'Gojek' },
  { id: 'grab', label: 'Grab' },
];

// Kasir butuh shift yang sudah dibuka di Input Penjualan (stok awal sudah diisi) —
// sinyal yang sama persis dipakai BranchPOS.jsx (localStorage.pos_active_session),
// bukan dicek ulang dari awal. Tanpa ini, kasir bisa jual sebelum ada baseline stok
// awal yang jelas, bikin opname akhir shift tidak balance.
function getActiveSession() {
  try { return JSON.parse(localStorage.getItem('pos_active_session') || 'null'); }
  catch { return null; }
}

export default function BranchKasir() {
  const { userData } = useAuth();
  const context = useOutletContext();
  const location = useLocation();
  const [selectedBranch] = useLocalStorageBranch('');
  const [activeSession, setActiveSession] = useState(getActiveSession());

  // localStorage tidak reaktif antar-tab/refresh sendiri — cek ulang tiap kali halaman ini difokus.
  useEffect(() => {
    const check = () => setActiveSession(getActiveSession());
    check();
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, [location.pathname]);

  useEffect(() => { context?.setCurrentBranch?.(selectedBranch); }, [selectedBranch]);

  const [products, setProducts] = useState([]);
  const [channelPrices, setChannelPrices] = useState({}); // `${product_id}:${channel}` -> price
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('');
  const [cart, setCart] = useState([]); // [{product_id, name, variant, price, qty}]
  const [channel, setChannel] = useState('offline');
  const [saving, setSaving] = useState(false);
  const [lastOrder, setLastOrder] = useState(null); // buat tampilan struk setelah bayar

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: prodData }, { data: priceData }] = await Promise.all([
        supabase.from('products').select('*').order('category').order('display_order', { ascending: true, nullsFirst: false }).order('name'),
        supabase.from('product_channel_prices').select('*'),
      ]);
      setProducts(prodData || []);
      const priceMap = {};
      (priceData || []).forEach(p => { priceMap[`${p.product_id}:${p.channel}`] = p.price; });
      setChannelPrices(priceMap);
      const firstCat = (prodData || [])[0]?.category;
      if (firstCat) setActiveCategory(firstCat);
      setLoading(false);
    })();
  }, []);

  // Produk tanpa kategori (null/kosong di Data Master) dulu hilang total — tidak nongol
  // di tab mana pun. Sekarang dikumpulkan di tab "Lainnya" biar tetap kejual.
  const categoryOf = (p) => p.category || 'Lainnya';
  const categories = useMemo(() => [...new Set(products.map(categoryOf))], [products]);
  const visibleProducts = useMemo(() => products.filter(p => categoryOf(p) === activeCategory), [products, activeCategory]);

  const priceFor = (product) => {
    if (channel !== 'offline') {
      const override = channelPrices[`${product.id}:${channel}`];
      if (override != null) return override;
    }
    return product.price || 0;
  };

  const addToCart = (product) => {
    const price = priceFor(product);
    setCart(prev => {
      const idx = prev.findIndex(it => it.product_id === product.id && it.price === price);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { product_id: product.id, name: product.name, variant: product.variant, price, qty: 1 }];
    });
  };

  const changeQty = (i, delta) => {
    setCart(prev => prev.map((it, idx) => idx === i ? { ...it, qty: Math.max(1, it.qty + delta) } : it));
  };
  const removeFromCart = (i) => setCart(prev => prev.filter((_, idx) => idx !== i));

  const total = cart.reduce((sum, it) => sum + it.price * it.qty, 0);

  // Ganti channel setelah keranjang terisi -> harga tiap item ikut channel baru (kalau ada override).
  const handleChannelChange = (nextChannel) => {
    setChannel(nextChannel);
    setCart(prev => prev.map(it => {
      const product = products.find(p => p.id === it.product_id);
      if (!product) return it;
      const override = nextChannel !== 'offline' ? channelPrices[`${product.id}:${nextChannel}`] : null;
      return { ...it, price: override != null ? override : (product.price || 0) };
    }));
  };

  // Potong branch_inventory.display_qty per item terjual (current_qty ikut lewat
  // trigger trg_sync_current_qty). Item tanpa baris branch_inventory dilewati.
  const deductStock = async (items) => {
    for (const it of items) {
      const product = products.find(p => p.id === it.product_id);
      const itemName = product ? stockKeyFor(product) : it.name;

      const { data: inv } = await supabase
        .from('branch_inventory')
        .select('display_qty, safety_qty')
        .eq('branch_name', selectedBranch)
        .eq('item_name', itemName)
        .maybeSingle();
      if (!inv) continue; // tidak dilacak sebagai display stock — biarkan ke opname manual

      const before = inv.display_qty ?? 0;
      const after = Math.max(0, before - it.qty);

      await supabase.from('branch_inventory')
        .update({ display_qty: after })
        .eq('branch_name', selectedBranch)
        .eq('item_name', itemName);

      await supabase.from('stock_restock_log').insert([{
        branch_name: selectedBranch,
        item_name: itemName,
        petugas_name: `${userData?.name || 'Kasir'} (Kasir - ${channel})`,
        qty_added: after - before,
        qty_before: before,
        qty_after: after,
      }]);
    }
  };

  const handleCheckout = async () => {
    if (!cart.length || saving) return;
    if (!selectedBranch) { alert('Pilih cabang dulu (buka halaman Opname sekali untuk set cabang).'); return; }
    setSaving(true);
    try {
      const { data: order, error: orderErr } = await supabase.from('orders').insert([{
        branch_name: selectedBranch,
        channel,
        total,
        staff_name: userData?.name || 'Kasir',
      }]).select().single();
      if (orderErr) throw orderErr;

      const items = cart.map(it => ({
        order_id: order.id,
        product_id: it.product_id,
        product_name: it.name,
        qty: it.qty,
        price: it.price,
        variant: it.variant || null,
      }));
      const { error: itemsErr } = await supabase.from('order_items').insert(items);
      if (itemsErr) throw itemsErr;

      await deductStock(cart);

      setLastOrder({ ...order, items: cart });
      setCart([]);
    } catch (e) {
      console.error(e);
      alert(`Gagal simpan transaksi:\n${e.message || JSON.stringify(e)}`);
    } finally {
      setSaving(false);
    }
  };

  if (lastOrder) {
    return <Receipt order={lastOrder} branchName={selectedBranch} onDone={() => setLastOrder(null)} />;
  }

  const inputPenjualanPath = location.pathname.startsWith('/admin') ? '/admin/pos' : '/branch/pos';
  const shiftOk = activeSession && selectedBranch && activeSession.branch === selectedBranch;

  if (!selectedBranch || !shiftOk) {
    return (
      <div className="glass-panel" style={{ maxWidth: '480px', margin: '3rem auto', padding: '2rem', textAlign: 'center' }}>
        <Icon name="alert-circle" size={32} className="text-muted" />
        <h2 style={{ marginTop: '0.75rem', fontSize: '1.05rem' }}>Belum Ada Shift Aktif</h2>
        <p className="text-muted" style={{ fontSize: '0.85rem', marginTop: '0.4rem' }}>
          Buka shift dulu di Input Penjualan (pilih cabang, isi stok awal) sebelum
          pakai Kasir — biar stok dan laporan tetap balance.
        </p>
        <Link to={inputPenjualanPath} style={{
          display: 'inline-block', marginTop: '1.25rem', padding: '0.6rem 1.4rem', borderRadius: '8px',
          background: 'var(--primary)', color: '#fff', fontWeight: 700, textDecoration: 'none',
        }}>Buka Input Penjualan</Link>
      </div>
    );
  }

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center' }} className="text-muted">Memuat produk…</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 320px', gap: '1rem', maxWidth: '1100px', margin: '0 auto' }}>
      {/* Kategori */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {categories.map(cat => (
          <button key={cat} onClick={() => setActiveCategory(cat)} style={{
            textAlign: 'left', padding: '0.6rem 0.8rem', borderRadius: '8px', border: 'none',
            cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem',
            background: cat === activeCategory ? 'var(--primary)' : 'transparent',
            color: cat === activeCategory ? '#fff' : 'var(--text-main)',
          }}>{cat}</button>
        ))}
      </div>

      {/* Grid produk */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '0.75rem', alignContent: 'start' }}>
        {visibleProducts.map(p => {
          const qtyInCart = cart.filter(it => it.product_id === p.id).reduce((s, it) => s + it.qty, 0);
          return (
            <button key={p.id} onClick={() => addToCart(p)} className="glass-panel" style={{
              position: 'relative', border: `1.5px solid ${qtyInCart ? 'var(--primary)' : 'var(--border-color)'}`,
              borderRadius: '12px', padding: '0.6rem', cursor: 'pointer', textAlign: 'left',
              display: 'flex', flexDirection: 'column', gap: '0.4rem',
            }}>
              {qtyInCart > 0 && (
                <span style={{
                  position: 'absolute', top: '-6px', right: '-6px', background: 'var(--primary)', color: '#fff',
                  borderRadius: '999px', minWidth: '20px', height: '20px', fontSize: '0.7rem', fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
                }}>{qtyInCart}</span>
              )}
              <div style={{
                width: '100%', aspectRatio: '1', borderRadius: '8px', background: 'var(--fill-subtle)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
              }}>
                {p.image_url
                  ? <img src={p.image_url} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <Icon name="package" size={28} />}
              </div>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, lineHeight: 1.2 }}>{p.name}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 700 }}>
                Rp {priceFor(p).toLocaleString('id-ID')}
              </div>
            </button>
          );
        })}
        {!visibleProducts.length && <div className="text-muted" style={{ fontSize: '0.85rem' }}>Belum ada produk di kategori ini.</div>}
      </div>

      {/* Keranjang */}
      <div className="glass-panel" style={{ border: '1px solid var(--border-color)', borderRadius: '12px', padding: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', position: 'sticky', top: '1rem', height: 'fit-content' }}>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {CHANNELS.map(c => (
            <button key={c.id} onClick={() => handleChannelChange(c.id)} style={{
              flex: 1, padding: '0.4rem', borderRadius: '6px', border: '1px solid var(--border-color)',
              cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700,
              background: channel === c.id ? 'var(--accent)' : 'transparent',
              color: channel === c.id ? '#fff' : 'var(--text-main)',
            }}>{c.label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '340px', overflowY: 'auto' }}>
          {!cart.length && <div className="text-muted" style={{ fontSize: '0.8rem' }}>Keranjang kosong — klik produk di kiri.</div>}
          {cart.map((it, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{it.name}</div>
                <div className="text-muted">Rp {it.price.toLocaleString('id-ID')}</div>
              </div>
              <button onClick={() => changeQty(i, -1)} style={{ width: 22, height: 22, borderRadius: 6, border: '1px solid var(--border-color)', background: 'transparent', cursor: 'pointer' }}>-</button>
              <span style={{ minWidth: 18, textAlign: 'center' }}>{it.qty}</span>
              <button onClick={() => changeQty(i, 1)} style={{ width: 22, height: 22, borderRadius: 6, border: '1px solid var(--border-color)', background: 'transparent', cursor: 'pointer' }}>+</button>
              <button onClick={() => removeFromCart(i)} title="Hapus" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--danger)' }}>
                <Icon name="close" size={16} />
              </button>
            </div>
          ))}
        </div>

        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.6rem', display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}>
          <span>Total</span>
          <span>Rp {total.toLocaleString('id-ID')}</span>
        </div>

        <button onClick={handleCheckout} disabled={!cart.length || saving} style={{
          padding: '0.7rem', borderRadius: '8px', border: 'none', background: 'var(--primary)',
          color: '#fff', fontWeight: 800, cursor: cart.length ? 'pointer' : 'not-allowed',
          opacity: cart.length ? 1 : 0.5,
        }}>{saving ? 'Menyimpan…' : 'Bayar & Cetak Struk'}</button>
      </div>
    </div>
  );
}
