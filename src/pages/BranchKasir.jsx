import React, { useState, useEffect, useMemo } from 'react';
import { useOutletContext, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/Icon';
import { supabase } from '../supabase';
import Receipt from '../components/Receipt';
import { formatFraction, isPremiVariant, sumStockUsage } from '../utils/stockUtils';

// Kasir TIDAK motong branch_inventory. Tiap order dicatat dengan report_date + shift sesi
// Input Penjualan yang aktif; BranchPOS membaca order_items itu sebagai "Terjual" otomatis
// per item, lalu Tutup Shift yang motong stok sekali (live - terjual). Dulu Kasir motong
// display_qty langsung -> Awal di form opname ikut turun -> Terjual (Awal - Sisa) jadi 0,
// jualan Kasir hilang dari laporan shift.
//
// Batas jual = stok display, sama dengan form Input Penjualan:
//   display_qty + tambah_qty − yang sudah dipakai lewat Kasir shift ini − keranjang.
// "Dipakai" per baris stok (stockUsageOf di stockUtils): stok menu itu sendiri + 1 cup
// (Cup (Flat) Ori/Premi, Paper Cup buat Hot Series) + bahan resep (Gula Milk Tea, Black Tea,
// Diamond, Ultra). Belum ada baris stok = 0 = tidak bisa dijual.
//
// Menu rasa di Kasir = rasa + minuman dasar: Milky Series (Strawberry, Melon, Avocado, Taro) &
// Choco Oreo -> Full Cream varian yang sama; Hazelnut, Brown Sugar, Salted Caramel -> Coffee Cream.
// Harga digabung di kartu & struk, tapi order_items tetap 2 baris (rasa & dasar) supaya laporan
// Input Penjualan menghitungnya persis seperti sekarang. Green Tea Latte & Madu Hutan dijual sendiri.

// Stok display cabang + pemakaian Kasir shift ini, per nama item stok.
async function fetchStockState(branch, sess, products) {
  const [{ data: inv }, { data: sold }] = await Promise.all([
    supabase.from('branch_inventory').select('item_name, display_qty, tambah_qty').eq('branch_name', branch),
    supabase.from('order_items').select('product_id, qty, orders!inner(branch_name, report_date, shift)')
      .eq('orders.branch_name', branch).eq('orders.report_date', sess.date).eq('orders.shift', String(sess.shift))
      .is('orders.voided_at', null),
  ]);
  const invMap = {};
  (inv || []).forEach(r => { invMap[r.item_name] = (Number(r.display_qty) || 0) + (Number(r.tambah_qty) || 0); });
  const usedMap = sumStockUsage(
    (sold || []).map(r => ({ product: products.find(x => x.id === r.product_id), qty: r.qty || 0 })),
    Object.keys(invMap),
  );
  return { invMap, usedMap };
}

// Minuman dasar untuk menu rasa (Kasir saja). Full Cream ikut varian rasa (Ori/Premi);
// Coffee Cream cuma satu (Standar).
const COFFEE_CREAM_FLAVORS = ['Hazelnut', 'Brown Sugar', 'Salted Caramel'];
const baseNameOf = (p) => {
  if (!p) return null;
  if (COFFEE_CREAM_FLAVORS.includes(p.name)) return 'Coffee Cream';
  if ((p.category === 'Milky Series' || p.name === 'Choco Oreo') && p.name !== 'Full Cream') return 'Full Cream';
  return null;
};
const baseOf = (p, products) => {
  const name = baseNameOf(p);
  if (name === 'Full Cream') return products.find(b => b.name === name && isPremiVariant(b) === isPremiVariant(p)) || null;
  if (name) return products.find(b => b.name === name || (name === 'Coffee Cream' && b.name === 'Coffe Cream')) || null;
  return null;
};

const EPS = 1e-9;
const PAY_LABEL = { cash: 'Tunai', qris: 'QRIS', gojek: 'Gojek', grab: 'Grab' };

function VariantBadge({ product }) {
  const v = product?.variant;
  if (!['Ori', 'Premi'].includes(v)) return null;
  const premi = v === 'Premi';
  return (
    <span style={{
      marginLeft: '0.3rem', padding: '0.05rem 0.35rem', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 800,
      background: premi ? 'rgba(13,111,255,0.15)' : 'rgba(255,204,0,0.25)', color: premi ? '#0d6fff' : '#c2410c',
    }}>{v}</span>
  );
}

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
  const [activeSession, setActiveSession] = useState(getActiveSession());
  // Cabang Kasir = cabang shift yang dibuka di Input Penjualan. Dulu dari localStorage
  // 'lastSelectedBranch', yang cuma ditulis kalau dropdown cabang diganti manual — cabang
  // yang terpilih otomatis (akun staf / pilihan terakhir) bikin Kasir mentok "Belum Ada Shift".
  const selectedBranch = activeSession?.branch || '';

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
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState([]); // [{product_id, base_id, name, variant, price, base_price, qty}]
  const [channel, setChannel] = useState('offline');
  const [saving, setSaving] = useState(false);
  const [lastOrder, setLastOrder] = useState(null); // struk transaksi terakhir, tampil di kolom kanan
  const [paid, setPaid] = useState(''); // uang dari customer (Offline/tunai)
  const [payMethod, setPayMethod] = useState('cash'); // Offline: 'cash' | 'qris'
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]); // order shift ini, terbaru dulu
  const loadHistory = async () => {
    const sess = getActiveSession();
    if (!sess?.branch) return;
    const { data } = await supabase.from('orders').select('*, order_items(product_name, variant, qty, price)')
      .eq('branch_name', sess.branch).eq('report_date', sess.date).eq('shift', String(sess.shift))
      .order('created_at', { ascending: false });
    setHistory(data || []);
  };
  // Batalkan transaksi (salah input / customer batal). Tidak dihapus — ditandai batal + alasan,
  // dan cuma selama shift-nya belum ditutup (sesudah tutup, stok & laporan sudah final -> Koreksi Laporan).
  const voidOrder = async (o) => {
    const { data: closedRep } = await supabase.from('sales_reports').select('id')
      .eq('branch_name', o.branch_name).eq('date', o.report_date).eq('shift', String(o.shift)).limit(1);
    if (closedRep?.length) { alert('Shift transaksi ini sudah ditutup — tidak bisa dibatalkan dari Kasir. Pakai Koreksi Laporan (admin).'); return; }
    const reason = (window.prompt(`Batalkan transaksi ${String(o.id).slice(0, 8).toUpperCase()} (Rp ${(o.total || 0).toLocaleString('id-ID')})?\nTulis alasannya:`) || '').trim();
    if (!reason) return;
    const { error } = await supabase.from('orders')
      .update({ voided_at: new Date().toISOString(), void_reason: reason, voided_by: userData?.name || 'Kasir' }).eq('id', o.id);
    if (error) { alert(`Gagal membatalkan:\n${error.message}`); return; }
    loadHistory();
    refreshStock();
  };
  // Baris Rp 0 = minuman dasar menu rasa (Full Cream di balik Strawberry) — tidak ditampilkan ke kasir.
  const visibleItems = (o) => (o.order_items || []).filter(it => it.price > 0)
    .map(it => ({ name: it.product_name, variant: it.variant, qty: it.qty, price: it.price }));
  const [stock, setStock] = useState({ invMap: {}, usedMap: {} });

  const refreshStock = async (prods = products) => {
    const sess = getActiveSession();
    if (!sess?.branch || !prods.length) return null;
    const next = await fetchStockState(sess.branch, sess, prods);
    setStock(next);
    return next;
  };
  useEffect(() => {
    if (!products.length || !selectedBranch) return;
    refreshStock();
    const onFocus = () => { if (!document.hidden) refreshStock(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [products, selectedBranch, activeSession?.shift, activeSession?.date]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = (id) => products.find(x => x.id === id);
  // Porsi yang keluar untuk 1 menu: menu itu + basis susu (kalau menu rasa).
  const portionsOf = (p) => [p, baseOf(p, products)].filter(Boolean);
  const itemNames = Object.keys(stock.invMap);
  const cartUsage = (items = cart) => sumStockUsage(items.flatMap(it => [
    { product: byId(it.product_id), qty: it.qty },
    it.base_id ? { product: byId(it.base_id), qty: it.qty } : null,
  ].filter(Boolean)), itemNames);
  const availItem = (item, st = stock) => Math.max(0, (st.invMap[item] ?? 0) - (st.usedMap[item] || 0));
  // Berapa porsi menu ini yang masih bisa ditambah + bahan yang membatasi.
  const limitFor = (p) => {
    const need = sumStockUsage(portionsOf(p).map(x => ({ product: x, qty: 1 })), itemNames);
    const inCart = cartUsage();
    let left = Infinity, by = null;
    Object.entries(need).forEach(([item, q]) => {
      const n = Math.floor((availItem(item) - (inCart[item] || 0)) / q + EPS);
      if (n < left) { left = n; by = item; }
    });
    return { left, by };
  };
  const leftFor = (p) => limitFor(p).left;
  const habisLabel = (p) => `${limitFor(p).by || 'Stok'} habis`;

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: prodData }, { data: priceData }] = await Promise.all([
        supabase.from('products').select('*').order('category').order('display_order', { ascending: true, nullsFirst: false }).order('name'),
        supabase.from('product_channel_prices').select('*'),
      ]);
      // Bahan (cup, gula, dll) bukan barang jual — cuma dipakai di opname.
      setProducts((prodData || []).filter(p => p.category !== 'Bahan'));
      const priceMap = {};
      (priceData || []).forEach(p => { priceMap[`${p.product_id}:${p.channel}`] = p.price; });
      setChannelPrices(priceMap);
      const firstCat = (prodData || []).find(p => p.category !== 'Bahan')?.category;
      if (firstCat) setActiveCategory(firstCat);
      setLoading(false);
    })();
  }, []);

  // Produk tanpa kategori (null/kosong di Data Master) dulu hilang total — tidak nongol
  // di tab mana pun. Sekarang dikumpulkan di tab "Lainnya" biar tetap kejual.
  const categoryOf = (p) => p.category || 'Lainnya';
  const categories = useMemo(() => [...new Set(products.map(categoryOf))], [products]);
  const visibleProducts = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return products.filter(p => categoryOf(p) === activeCategory);
    return products.filter(p => {
      const hay = `${p.name} ${p.variant || ''} ${p.category || ''}`.toLowerCase();
      return words.every(w => hay.includes(w));
    });
  }, [products, activeCategory, search]);

  const priceFor = (product, ch = channel) => {
    if (!product) return 0;
    if (ch !== 'offline') {
      const override = channelPrices[`${product.id}:${ch}`];
      if (override != null) return override;
    }
    return Number(product.price) || 0;
  };
  const menuPrice = (p) => priceFor(p) + priceFor(baseOf(p, products));

  // Transaksi Baru: tutup struk + ambil ulang stok dari server (bisa berubah dari device lain,
  // pindah stok, atau kiriman ACC) supaya angka "Stok: N" di kartu tidak basi.
  const startNewTransaction = () => {
    setLastOrder(null);
    refreshStock();
  };

  const addToCart = (product) => {
    if (lastOrder) startNewTransaction(); // klik menu sesudah bayar = mulai transaksi baru
    if (leftFor(product) < 1) { alert(`${habisLabel(product)} — ${product.name} tidak bisa ditambah.\nTambah stok ke display dulu lewat tombol Stok.`); return; }
    const price = priceFor(product);
    const base = baseOf(product, products);
    setCart(prev => {
      const idx = prev.findIndex(it => it.product_id === product.id && it.price === price);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, {
        product_id: product.id, base_id: base?.id || null, name: product.name, variant: product.variant,
        price, base_price: priceFor(base), qty: 1,
      }];
    });
  };

  const changeQty = (i, delta) => {
    const p = byId(cart[i]?.product_id);
    if (delta > 0 && p && leftFor(p) < delta) { alert(`${habisLabel(p)} untuk keranjang ini.`); return; }
    setCart(prev => prev.map((it, idx) => idx === i ? { ...it, qty: Math.max(1, it.qty + delta) } : it));
  };
  const removeFromCart = (i) => setCart(prev => prev.filter((_, idx) => idx !== i));

  const lineUnit = (it) => it.price + (it.base_price || 0);
  const total = cart.reduce((sum, it) => sum + lineUnit(it) * it.qty, 0);
  // Tunai = cuma Offline + bayar cash. QRIS / Gojek / Grab tidak masuk laci -> tanpa kembalian,
  // dan otomatis jadi baris "non-tunai" di Pengeluaran Input Penjualan (setoran = tunai saja).
  const isCash = channel === 'offline' && payMethod === 'cash';
  const paymentMethod = channel === 'offline' ? payMethod : channel;
  const paidNum = parseInt(String(paid).replace(/\D/g, ''), 10) || 0;
  const change = paidNum - total;

  // Ganti channel setelah keranjang terisi -> harga tiap item ikut channel baru (kalau ada override).
  const handleChannelChange = (nextChannel) => {
    setChannel(nextChannel);
    setCart(prev => prev.map(it => (byId(it.product_id)
      ? { ...it, price: priceFor(byId(it.product_id), nextChannel), base_price: priceFor(byId(it.base_id), nextChannel) }
      : it)));
  };

  const handleCheckout = async () => {
    if (!cart.length || saving) return;
    if (!selectedBranch) { alert('Pilih cabang dulu (buka halaman Opname sekali untuk set cabang).'); return; }
    const sess = getActiveSession();
    if (!sess || sess.branch !== selectedBranch) { setActiveSession(sess); alert('Shift sudah ditutup / ganti cabang. Buka shift lagi di Input Penjualan.'); return; }
    setSaving(true);
    let orderId = null;
    try {
      // Shift ini sudah ditutup dari device lain? Order ke shift tertutup tidak masuk laporan
      // mana pun & tidak pernah motong stok — tolak, suruh buka shift berikutnya.
      const { data: closedRep } = await supabase.from('sales_reports').select('id')
        .eq('branch_name', sess.branch).eq('date', sess.date).eq('shift', String(sess.shift)).limit(1);
      if (closedRep?.length) {
        localStorage.removeItem('pos_active_session');
        setActiveSession(null);
        alert(`Shift ${sess.shift} tanggal ${sess.date} di ${sess.branch} SUDAH DITUTUP.\nTransaksi tidak disimpan. Buka shift berikutnya di Input Penjualan dulu.`);
        return;
      }
      // Cek ulang stok terbaru (bisa berubah dari device lain / Tutup Shift / pindah stok).
      const fresh = await refreshStock();
      if (!fresh) throw new Error('Gagal cek stok display.');
      const kurang = Object.entries(cartUsage())
        .filter(([item, need]) => need > availItem(item, fresh) + EPS)
        .map(([item, need]) => `- ${item}: butuh ${formatFraction(need)}, stok display ${formatFraction(availItem(item, fresh))}`);
      if (isCash && paidNum < total) {
        alert(`Uang customer kurang Rp ${(total - paidNum).toLocaleString('id-ID')}.`);
        return;
      }
      if (kurang.length) {
        alert(`Stok display tidak cukup:\n${kurang.join('\n')}\n\nKurangi jumlah atau tambah stok display dulu.`);
        return;
      }

      const { data: order, error: orderErr } = await supabase.from('orders').insert([{
        branch_name: selectedBranch,
        channel,
        total,
        staff_name: userData?.name || 'Kasir',
        shift: String(sess.shift),
        report_date: sess.date,
        paid_amount: isCash ? paidNum : total,
        payment_method: paymentMethod,
      }]).select().single();
      if (orderErr) throw orderErr;
      orderId = order.id;

      // Menu rasa = 2 baris (rasa + dasar) biar laporan menghitung keduanya seperti biasa.
      // Baris rasa bawa harga gabungan, baris dasar Rp 0 (penanda "isi di belakang layar") —
      // total order tetap benar; omzet laporan shift dihitung dari harga master, bukan dari sini.
      const items = cart.flatMap(it => {
        const base = byId(it.base_id);
        return [
          { order_id: order.id, product_id: it.product_id, product_name: it.name, qty: it.qty, price: lineUnit(it), variant: it.variant || null },
          base && { order_id: order.id, product_id: base.id, product_name: base.name, qty: it.qty, price: 0, variant: base.variant || null },
        ].filter(Boolean);
      });
      const { error: itemsErr } = await supabase.from('order_items').insert(items);
      if (itemsErr) throw itemsErr;

      // Struk: menu rasa tampil 1 baris "Strawberry + Full Cream" dengan harga gabungan.
      setLastOrder({ ...order, items: cart.map(it => ({ ...it, price: lineUnit(it) })) });
      loadHistory();
      setCart([]);
      setPaid('');
      setPayMethod('cash');
      refreshStock(); // stok di kartu langsung ikut transaksi barusan
    } catch (e) {
      console.error(e);
      // Order tanpa item = total nyasar di laporan. Tandai batal (staf tidak boleh hapus).
      if (orderId) await supabase.from('orders').update({ voided_at: new Date().toISOString(), void_reason: 'Gagal simpan item (otomatis)', voided_by: 'Sistem' }).eq('id', orderId);
      alert(`Gagal simpan transaksi:\n${e.message || JSON.stringify(e)}`);
    } finally {
      setSaving(false);
    }
  };

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
    <>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '1100px', margin: '0 auto 0.75rem' }}>
      <div style={{ fontWeight: 800 }}>Kasir — {selectedBranch} · Shift {activeSession.shift}</div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
      <button type="button" className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        onClick={() => { if (!showHistory) loadHistory(); setShowHistory(v => !v); }}>
        <Icon name="file" size={15} /> {showHistory ? 'Tutup Riwayat' : 'Riwayat Transaksi'}
      </button>
      <Link to={inputPenjualanPath} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none' }}>
        <Icon name="arrow-left" size={15} /> Kembali ke Input Penjualan
      </Link>
      </div>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 320px', gap: '1rem', maxWidth: '1100px', margin: '0 auto' }}>
      {/* Kategori */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {categories.map(cat => (
          <button key={cat} onClick={() => { setActiveCategory(cat); setSearch(''); }} style={{
            textAlign: 'left', padding: '0.6rem 0.8rem', borderRadius: '8px', border: 'none',
            cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem',
            background: cat === activeCategory ? 'var(--primary)' : 'transparent',
            color: cat === activeCategory ? '#fff' : 'var(--text-main)',
          }}>{cat}</button>
        ))}
      </div>

      {/* Grid produk */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: '0.7rem', top: '50%', transform: 'translateY(-50%)', display: 'flex', color: 'var(--text-muted)' }}>
          <Icon name="search" size={16} />
        </span>
        <input type="search" className="input-field" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Cari menu… (mis. teh premi)" style={{ width: '100%', paddingLeft: '2.2rem' }} />
      </div>
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
              <div style={{ fontSize: '0.8rem', fontWeight: 700, lineHeight: 1.2 }}>{p.name}<VariantBadge product={p} /></div>
              <div style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 700 }}>
                Rp {menuPrice(p).toLocaleString('id-ID')}
              </div>
              {Number.isFinite(leftFor(p)) && (
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: leftFor(p) < 1 ? 'var(--danger)' : 'var(--text-muted)' }}>
                  {leftFor(p) < 1 ? habisLabel(p) : `Stok: ${formatFraction(leftFor(p))}`}
                </div>
              )}
            </button>
          );
        })}
        {!visibleProducts.length && <div className="text-muted" style={{ fontSize: '0.85rem' }}>{search.trim() ? `Tidak ada menu "${search.trim()}".` : 'Belum ada produk di kategori ini.'}</div>}
      </div>
      </div>

      {/* Kanan: riwayat shift ini, struk transaksi terakhir, atau keranjang */}
      {showHistory ? (
      <div className="glass-panel" style={{ border: '1px solid var(--border-color)', borderRadius: '12px', padding: '0.9rem', position: 'sticky', top: '1rem', maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, marginBottom: '0.5rem' }}>
          <span>Riwayat Shift {activeSession.shift}</span>
          <span>{history.filter(o => !o.voided_at).length} trx · Rp {history.filter(o => !o.voided_at).reduce((s, o) => s + (o.total || 0), 0).toLocaleString('id-ID')}</span>
        </div>
        {!history.length && <div className="text-muted" style={{ fontSize: '0.8rem' }}>Belum ada transaksi di shift ini.</div>}
        {history.map(o => (
          <div key={o.id} style={{ borderTop: '1px dashed var(--border-color)', padding: '0.5rem 0', fontSize: '0.78rem', opacity: o.voided_at ? 0.55 : 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
              <span>{new Date(o.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} · {String(o.id).slice(0, 8).toUpperCase()}</span>
              <span style={{ textDecoration: o.voided_at ? 'line-through' : 'none' }}>Rp {(o.total || 0).toLocaleString('id-ID')}</span>
            </div>
            {o.voided_at && <div style={{ color: 'var(--danger)', fontWeight: 700 }}>DIBATALKAN — {o.void_reason} ({o.voided_by})</div>}
            <div className="text-muted">{PAY_LABEL[o.payment_method] || ''} · {visibleItems(o).map(it => `${it.qty}× ${it.name}${it.variant && it.variant !== 'Standar' ? ' ' + it.variant : ''}`).join(', ')}</div>
            <button type="button" onClick={() => { setLastOrder({ ...o, items: visibleItems(o), _reprint: true }); setShowHistory(false); }}
              style={{ marginTop: '0.25rem', padding: '0.15rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'transparent', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700 }}>
              Lihat / Cetak Struk
            </button>
            {!o.voided_at && (
              <button type="button" onClick={() => voidOrder(o)}
                style={{ marginTop: '0.25rem', marginLeft: '0.3rem', padding: '0.15rem 0.5rem', borderRadius: '6px', border: '1px solid var(--danger)', background: 'transparent', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700 }}>
                Batalkan
              </button>
            )}
          </div>
        ))}
      </div>
      ) : lastOrder ? (
      <div className="glass-panel" style={{ border: '1px solid var(--border-color)', borderRadius: '12px', padding: '0.9rem', position: 'sticky', top: '1rem', height: 'fit-content' }}>
        <div style={{ fontWeight: 800, marginBottom: '0.5rem', color: 'var(--primary)' }}>{lastOrder._reprint ? 'Struk (cetak ulang)' : 'Pembayaran berhasil'}</div>
        <Receipt order={lastOrder} branchName={selectedBranch} onDone={startNewTransaction} />
      </div>
      ) : (
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
                <div style={{ fontWeight: 700 }}>{it.name}<VariantBadge product={byId(it.product_id)} /></div>
                <div className="text-muted">Rp {lineUnit(it).toLocaleString('id-ID')}</div>
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

        {channel === 'offline' && (
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {[['cash', 'Tunai'], ['qris', 'QRIS']].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setPayMethod(id)} style={{
                flex: 1, padding: '0.45rem', borderRadius: '6px', border: '1px solid var(--border-color)', cursor: 'pointer',
                fontSize: '0.8rem', fontWeight: 800,
                background: payMethod === id ? 'var(--primary)' : 'transparent', color: payMethod === id ? '#fff' : 'var(--text-main)',
              }}>{label}</button>
            ))}
          </div>
        )}
        {channel === 'offline' && payMethod === 'qris' && (
          <div className="text-muted" style={{ fontSize: '0.75rem' }}>
            Pastikan QRIS sudah masuk sebelum klik Bayar. Tercatat non-tunai (tidak masuk setoran laci).
          </div>
        )}

        {isCash && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label className="text-muted" style={{ fontSize: '0.8rem', fontWeight: 700 }}>Uang dari Customer</label>
            <input type="text" inputMode="numeric" className="input-field" placeholder="0"
              value={paidNum ? paidNum.toLocaleString('id-ID') : ''}
              onChange={e => setPaid(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCheckout(); }}
              style={{ fontSize: '1rem', fontWeight: 800, textAlign: 'right' }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
              {[["Uang Pas","total"],["10rb",10000],["20rb",20000],["50rb",50000],["100rb",100000]].map(([label, v]) => (
                <button key={label} type="button" onClick={() => setPaid(String(v === 'total' ? total : v))} style={{
                  flex: '1 0 auto', padding: '0.3rem 0.4rem', borderRadius: '6px', border: '1px solid var(--border-color)',
                  background: 'transparent', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700,
                }}>{label}</button>
              ))}
            </div>
            <div style={{
              display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '0.95rem',
              color: !paidNum ? 'var(--text-muted)' : change < 0 ? 'var(--danger)' : 'var(--primary)',
            }}>
              <span>{paidNum && change < 0 ? 'Kurang' : 'Kembalian'}</span>
              <span>Rp {(paidNum ? Math.abs(change) : 0).toLocaleString('id-ID')}</span>
            </div>
          </div>
        )}

        {(() => { const ok = cart.length && (!isCash || paidNum >= total); return (
        <button onClick={handleCheckout} disabled={!ok || saving} style={{
          padding: '0.7rem', borderRadius: '8px', border: 'none', background: 'var(--primary)',
          color: '#fff', fontWeight: 800, cursor: ok ? 'pointer' : 'not-allowed',
          opacity: ok ? 1 : 0.5,
        }}>{saving ? 'Menyimpan…' : 'Bayar'}</button>
        ); })()}
      </div>
      )}
    </div>
    </>
  );
}
