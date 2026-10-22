import React, { useState, useEffect } from 'react';
import Icon from './Icon';
import { supabase } from '../supabase';

// ponytail: info pembanding manual, BUKAN sumber angka resmi. Omzet resmi tetap dari
// stok (Awal-Sisa x harga normal) seperti sekarang — itu sudah otomatis kebagi benar
// buat QTY (kasir motong branch_inventory). Yang belum otomatis itu RUPIAH kalau unit
// itu kejual pakai harga channel (Gojek/Grab) yang beda dari harga normal. Banner ini
// kasih tahu staf berapa Rupiah riil yang lewat Kasir hari itu, biar bisa dicocokkan
// manual pas nutup shift. Kalau nanti mau full otomatis, lihat PLAN.md.
export default function KasirOmzetBanner({ branchName, date }) {
  const [summary, setSummary] = useState(null); // { total, count }

  useEffect(() => {
    if (!branchName || !date) { setSummary(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('orders')
        .select('total, channel')
        .eq('branch_name', branchName)
        .gte('created_at', `${date}T00:00:00`)
        .lte('created_at', `${date}T23:59:59`);
      if (cancelled) return;
      if (!data || !data.length) { setSummary({ total: 0, count: 0, byChannel: {} }); return; }
      const total = data.reduce((s, o) => s + (o.total || 0), 0);
      const byChannel = {};
      data.forEach(o => { byChannel[o.channel] = (byChannel[o.channel] || 0) + (o.total || 0); });
      setSummary({ total, count: data.length, byChannel });
    })();
    return () => { cancelled = true; };
  }, [branchName, date]);

  if (!summary || !summary.count) return null;

  return (
    <div style={{
      padding: '0.6rem 0.9rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.82rem',
      backgroundColor: 'rgba(13, 111, 255, 0.08)', border: '1px solid rgba(13, 111, 255, 0.3)',
      color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
    }}>
      <Icon name="cart" size={15} />
      <strong>Omzet Kasir hari ini: Rp {summary.total.toLocaleString('id-ID')}</strong>
      <span className="text-muted">({summary.count} transaksi{summary.byChannel && Object.keys(summary.byChannel).length > 1
        ? ' — ' + Object.entries(summary.byChannel).map(([ch, t]) => `${ch}: Rp${t.toLocaleString('id-ID')}`).join(', ')
        : ''})</span>
      <span className="text-muted" style={{ fontSize: '0.75rem' }}>— cocokkan manual kalau ada harga channel beda dari harga normal.</span>
    </div>
  );
}
