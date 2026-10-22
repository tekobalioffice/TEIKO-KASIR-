import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';

// Struk print-only via window.print(). Tidak pakai library cetak baru.
// Ukuran kertas + teks header/footer diambil dari app_settings (Pengaturan di sidebar admin) —
// default 58mm kalau tabel/pengaturan belum ada, biar tidak error di clone yang belum jalanin
// supabase/migrations_settings.sql.
const CHANNEL_LABEL = { offline: 'Offline', gojek: 'Gojek', grab: 'Grab' };
const DEFAULT_SETTINGS = { receipt_width_mm: 58, receipt_header_text: 'TEIKO', receipt_footer_text: 'Terima kasih' };

export default function Receipt({ order, branchName, onDone }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('app_settings').select('*').maybeSingle();
      if (data) setSettings(data);
    })();
  }, []);

  const items = order.items || [];
  const total = order.total ?? items.reduce((s, it) => s + it.price * it.qty, 0);
  const waktu = new Date(order.created_at || Date.now()).toLocaleString('id-ID', {
    dateStyle: 'medium', timeStyle: 'short',
  });
  const width = `${settings.receipt_width_mm || 58}mm`;

  return (
    <div>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #struk, #struk * { visibility: visible; }
          #struk { position: absolute; top: 0; left: 0; width: ${width}; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div id="struk" style={{
        width, margin: '0 auto', padding: '0.5rem', fontFamily: 'monospace',
        fontSize: '0.72rem', color: '#000', background: '#fff',
      }}>
        <div style={{ textAlign: 'center', fontWeight: 700, fontSize: '0.85rem' }}>{settings.receipt_header_text || 'TEIKO'}</div>
        <div style={{ textAlign: 'center' }}>{branchName || '-'}</div>
        <div style={{ textAlign: 'center' }}>{waktu}</div>
        <div style={{ textAlign: 'center' }}>{CHANNEL_LABEL[order.channel] || order.channel}</div>
        <hr style={{ border: 'none', borderTop: '1px dashed #000', margin: '0.4rem 0' }} />

        {items.map((it, i) => (
          <div key={i} style={{ marginBottom: '0.2rem' }}>
            <div>{it.name}{it.variant && it.variant !== 'Standar' ? ` (${it.variant})` : ''}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{it.qty} x {it.price.toLocaleString('id-ID')}</span>
              <span>{(it.qty * it.price).toLocaleString('id-ID')}</span>
            </div>
          </div>
        ))}

        <hr style={{ border: 'none', borderTop: '1px dashed #000', margin: '0.4rem 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
          <span>TOTAL</span>
          <span>Rp {total.toLocaleString('id-ID')}</span>
        </div>
        <div style={{ textAlign: 'center', marginTop: '0.5rem' }}>{settings.receipt_footer_text || 'Terima kasih'}</div>
      </div>

      <div className="no-print" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '1rem' }}>
        <button onClick={() => window.print()} style={{
          padding: '0.6rem 1.2rem', borderRadius: '8px', border: 'none',
          background: 'var(--primary)', color: '#fff', fontWeight: 700, cursor: 'pointer',
        }}>Cetak Struk</button>
        <button onClick={onDone} style={{
          padding: '0.6rem 1.2rem', borderRadius: '8px', border: '1px solid var(--border-color)',
          background: 'transparent', cursor: 'pointer', fontWeight: 700,
        }}>Transaksi Baru</button>
      </div>
    </div>
  );
}
