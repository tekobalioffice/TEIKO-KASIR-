import React, { useState, useEffect, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLocalStorageBranch } from '../hooks/useLocalStorageBranch';
import Icon from '../components/Icon';
import { supabase } from '../supabase';
import Receipt from '../components/Receipt';

// ponytail: kasir ini catat transaksi & cetak struk, TAPI belum motong branch_inventory.
// Opname blind-POS (BranchPOS.jsx) tetap sumber omzet resmi untuk sekarang — lihat PLAN.md
// "Keputusan yang masih nunggu user". Kalau kasir jadi sumber omzet utama, tambah potong
// stok di handleCheckout + rekonsiliasi vs opname.

const CHANNELS = [
  { id: 'offline', label: 'Offline' },
  { id: 'gojek', label: 'Gojek' },
  { id: 'grab', label: 'Grab' },
];

export default function BranchKasir() {
  const { userData } = useAuth();
  const context = useOutletContext();
  const [selectedBranch] = useLocalStorageBranch('');

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

  const categories = useMemo(() => [...new Set(products.map(p => p.category).filter(Boolean))], [products]);
  const visibleProducts = useMemo(() => products.filter(p => p.category === activeCategory), [products, activeCategory]);

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
        {visibleProducts.map(p => (
          <button key={p.id} onClick={() => addToCart(p)} className="glass-panel" style={{
            border: '1px solid var(--border-color)', borderRadius: '12px', padding: '0.6rem',
            cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '0.4rem',
          }}>
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
        ))}
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
