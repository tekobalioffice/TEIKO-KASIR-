import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';

// Struk print-only via window.print(). Tidak pakai library cetak baru.
// Logo, ukuran kertas, dan teks (nama toko, alamat, telp, Instagram, footer) dari app_settings
// (menu Pengaturan admin). Tabel belum ada (migrations_settings.sql belum dijalankan) = default.
const CHANNEL_LABEL = { offline: 'Offline', gojek: 'Gojek', grab: 'Grab' };
export const DEFAULT_SETTINGS = {
  receipt_width_mm: 58, receipt_header_text: 'TEIKO', receipt_footer_text: 'Terima kasih',
  receipt_logo_url: '', receipt_address: '', receipt_phone: '', receipt_instagram: '', receipt_extra_text: '',
};

const center = { textAlign: 'center' };
const dashed = { border: 'none', borderTop: '1px dashed #000', margin: '0.4rem 0' };

// Dipakai juga di Pengaturan buat preview — `settings` langsung dari form, tanpa fetch.
export function ReceiptPaper({ order, branchName, settings }) {
  const items = order.items || [];
  const total = order.total ?? items.reduce((s, it) => s + it.price * it.qty, 0);
  const waktu = new Date(order.created_at || Date.now()).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  const ig = (settings.receipt_instagram || '').trim().replace(/^@/, '');
  const lines = (txt) => (txt || '').split('\n').filter(l => l.trim()).map((l, i) => <div key={i} style={center}>{l}</div>);

  return (
    <div id="struk" style={{
      width: `${settings.receipt_width_mm || 58}mm`, margin: '0 auto', padding: '0.5rem', fontFamily: 'monospace',
      fontSize: '0.72rem', color: '#000', background: '#fff', boxSizing: 'border-box',
    }}>
      {settings.receipt_logo_url && (
        <img src={settings.receipt_logo_url} alt="" style={{ display: 'block', margin: '0 auto 0.3rem', maxWidth: '60%', maxHeight: '22mm', objectFit: 'contain', filter: 'grayscale(1)' }} />
      )}
      <div style={{ ...center, fontWeight: 700, fontSize: '0.85rem' }}>{settings.receipt_header_text || 'TEIKO'}</div>
      {lines(settings.receipt_address)}
      {settings.receipt_phone && <div style={center}>Telp/WA {settings.receipt_phone}</div>}
      <hr style={dashed} />
      <div style={center}>{branchName || '-'} · {CHANNEL_LABEL[order.channel] || order.channel}{order.shift ? ` · Shift ${order.shift}` : ''}</div>
      <div style={center}>{waktu}</div>
      {order.id && <div style={center}>No. {String(order.id).slice(0, 8).toUpperCase()}</div>}
      {order.staff_name && <div style={center}>Kasir: {order.staff_name}</div>}
      <hr style={dashed} />

      {items.map((it, i) => (
        <div key={i} style={{ marginBottom: '0.2rem' }}>
          <div>{it.name}{it.variant && it.variant !== 'Standar' ? ` (${it.variant})` : ''}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{it.qty} x {it.price.toLocaleString('id-ID')}</span>
            <span>{(it.qty * it.price).toLocaleString('id-ID')}</span>
          </div>
        </div>
      ))}

      <hr style={dashed} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
        <span>TOTAL</span>
        <span>Rp {total.toLocaleString('id-ID')}</span>
      </div>
      {order.payment_method && order.payment_method !== 'cash' && (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Bayar</span><span>{{ qris: 'QRIS', gojek: 'Gojek', grab: 'Grab' }[order.payment_method] || order.payment_method}</span>
        </div>
      )}
      {order.channel === 'offline' && (order.payment_method || 'cash') === 'cash' && order.paid_amount != null && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Tunai</span><span>Rp {order.paid_amount.toLocaleString('id-ID')}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Kembalian</span><span>Rp {Math.max(0, order.paid_amount - total).toLocaleString('id-ID')}</span>
          </div>
        </>
      )}
      <hr style={dashed} />
      <div style={{ ...center, marginTop: '0.3rem' }}>{settings.receipt_footer_text || 'Terima kasih'}</div>
      {ig && <div style={center}>IG: @{ig}</div>}
      {lines(settings.receipt_extra_text)}
    </div>
  );
}

export default function Receipt({ order, branchName, onDone }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('app_settings').select('*').maybeSingle();
      if (data) setSettings({ ...DEFAULT_SETTINGS, ...data });
    })();
  }, []);

  return (
    <div>
      <style>{`
        @page { size: ${settings.receipt_width_mm || 58}mm auto; margin: 0; }
        @media print {
          body * { visibility: hidden; }
          #struk, #struk * { visibility: visible; }
          #struk { position: absolute; top: 0; left: 0; }
          .no-print { display: none !important; }
        }
      `}</style>

      <ReceiptPaper order={order} branchName={branchName} settings={settings} />

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
