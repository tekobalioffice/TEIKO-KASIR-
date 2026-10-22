import React, { useState, useEffect } from 'react';
import Icon from '../components/Icon';
import { supabase } from '../supabase';

// Singleton row (id selalu true) — lihat supabase/migrations_settings.sql.
export default function AdminSettings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchSettings(); }, []);

  const fetchSettings = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('app_settings').select('*').single();
    if (error) {
      console.error(error);
      alert(`Gagal ambil pengaturan:\n${error.message}\n\nKalau pesannya "table not found", jalankan dulu supabase/migrations_settings.sql di SQL Editor Supabase.`);
    } else {
      setSettings(data);
    }
    setLoading(false);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from('app_settings').update({
      receipt_width_mm: parseInt(settings.receipt_width_mm) || 58,
      receipt_header_text: settings.receipt_header_text || 'TEIKO',
      receipt_footer_text: settings.receipt_footer_text || 'Terima kasih',
    }).eq('id', true);
    setSaving(false);
    if (error) alert(`Gagal simpan:\n${error.message}`);
    else alert('Pengaturan tersimpan.');
  };

  if (loading) return <div className="text-muted" style={{ padding: '2rem', textAlign: 'center' }}>Memuat pengaturan...</div>;
  if (!settings) return null;

  return (
    <div className="animate-fade-in">
      <div className="page-title">
        <h1 className="text-primary mb-1">Pengaturan</h1>
        <p className="text-muted">Ukuran kertas printer struk dan teks header/footer struk.</p>
      </div>

      <div className="glass-panel" style={{ maxWidth: '480px', padding: '1.5rem' }}>
        <form onSubmit={handleSave} className="flex-col gap-4">
          <div>
            <label className="text-muted" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
              <Icon name="file" size={15} /> Ukuran Kertas Printer
            </label>
            <select className="input-field" value={settings.receipt_width_mm}
              onChange={e => setSettings({ ...settings, receipt_width_mm: e.target.value })}>
              <option value={58}>58mm (default)</option>
              <option value={80}>80mm</option>
            </select>
          </div>

          <div>
            <label className="text-muted" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Teks Header Struk (nama toko)</label>
            <input type="text" className="input-field" value={settings.receipt_header_text}
              onChange={e => setSettings({ ...settings, receipt_header_text: e.target.value })} placeholder="TEIKO" />
          </div>

          <div>
            <label className="text-muted" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Teks Footer Struk</label>
            <input type="text" className="input-field" value={settings.receipt_footer_text}
              onChange={e => setSettings({ ...settings, receipt_footer_text: e.target.value })} placeholder="Terima kasih" />
          </div>

          <button type="submit" disabled={saving} className="btn-primary" style={{ marginTop: '0.5rem' }}>
            {saving ? 'Menyimpan...' : 'Simpan Pengaturan'}
          </button>
        </form>
      </div>
    </div>
  );
}
