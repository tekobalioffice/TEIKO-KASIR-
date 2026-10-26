import React, { useState, useEffect } from 'react';
import Icon from '../components/Icon';
import { supabase } from '../supabase';
import { ReceiptPaper, DEFAULT_SETTINGS } from '../components/Receipt';

const SAMPLE_ORDER = {
  id: 'contoh00', channel: 'offline', shift: '1', staff_name: 'Kasir',
  items: [{ name: 'Es Teh', variant: 'Ori', qty: 2, price: 5000 }, { name: 'Milk Tea', qty: 1, price: 10000 }],
};

const TEXT_FIELDS = [
  ['receipt_header_text', 'Nama Toko (judul struk)', 'TEIKO', false],
  ['receipt_address', 'Alamat (boleh beberapa baris)', 'Jl. Contoh No. 1, Denpasar', true],
  ['receipt_phone', 'No. Telp / WA', '0812xxxxxxx', false],
  ['receipt_instagram', 'Instagram', '@teiko.id', false],
  ['receipt_footer_text', 'Teks Penutup', 'Terima kasih', false],
  ['receipt_extra_text', 'Teks Tambahan (TikTok, WiFi, promo — 1 baris per info)', 'TikTok: @teiko.id\nWiFi: teiko123', true],
];

// Singleton row (id selalu true) — lihat supabase/migrations_settings.sql.
export default function AdminSettings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { fetchSettings(); }, []);

  const fetchSettings = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('app_settings').select('*').single();
    if (error) {
      console.error(error);
      alert(`Gagal ambil pengaturan:\n${error.message}\n\nKalau pesannya "table not found" / kolom tidak ada, jalankan dulu supabase/migrations_settings.sql di SQL Editor Supabase.`);
    } else {
      setSettings({ ...DEFAULT_SETTINGS, ...data });
    }
    setLoading(false);
  };

  const set = (k, v) => setSettings(s => ({ ...s, [k]: v }));

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert('Ukuran logo maksimal 2MB'); return; }
    setUploading(true);
    try {
      const path = `settings/logo_${Date.now()}.${file.name.split('.').pop()}`;
      const { error } = await supabase.storage.from('products').upload(path, file);
      if (error) throw error;
      set('receipt_logo_url', supabase.storage.from('products').getPublicUrl(path).data.publicUrl);
    } catch (err) {
      alert(`Gagal upload logo:\n${err.message}\n\nPastikan bucket storage 'products' ada & Public.`);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from('app_settings').update({
      receipt_width_mm: parseInt(settings.receipt_width_mm) || 58,
      receipt_header_text: settings.receipt_header_text || 'TEIKO',
      receipt_footer_text: settings.receipt_footer_text || 'Terima kasih',
      receipt_logo_url: settings.receipt_logo_url || null,
      receipt_address: settings.receipt_address || null,
      receipt_phone: settings.receipt_phone || null,
      receipt_instagram: settings.receipt_instagram || null,
      receipt_extra_text: settings.receipt_extra_text || null,
    }).eq('id', true);
    setSaving(false);
    if (error) alert(`Gagal simpan:\n${error.message}`);
    else alert('Pengaturan tersimpan.');
  };

  if (loading) return <div className="text-muted" style={{ padding: '2rem', textAlign: 'center' }}>Memuat pengaturan...</div>;
  if (!settings) return null;

  const label = { display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' };

  return (
    <div className="animate-fade-in">
      <div className="page-title">
        <h1 className="text-primary mb-1">Pengaturan</h1>
        <p className="text-muted">Logo, ukuran kertas, dan tulisan di struk Kasir.</p>
      </div>

      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div className="glass-panel" style={{ flex: '1 1 380px', maxWidth: '520px', padding: '1.5rem' }}>
          <form onSubmit={handleSave} className="flex-col gap-4">
            <div>
              <label className="text-muted" style={label}>Logo Struk</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ width: 80, height: 80, borderRadius: 10, border: '2px dashed var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: '#fff' }}>
                  {settings.receipt_logo_url
                    ? <img src={settings.receipt_logo_url} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    : <Icon name="image" size={24} />}
                </div>
                <label className="btn-secondary" style={{ cursor: uploading ? 'not-allowed' : 'pointer' }}>
                  {uploading ? 'Mengupload...' : settings.receipt_logo_url ? 'Ganti Logo' : 'Upload Logo'}
                  <input type="file" accept="image/*" onChange={handleLogoUpload} disabled={uploading} style={{ display: 'none' }} />
                </label>
                {settings.receipt_logo_url && (
                  <button type="button" className="btn-secondary" style={{ color: 'var(--danger)' }} onClick={() => set('receipt_logo_url', '')}>Hapus</button>
                )}
              </div>
              <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.4rem' }}>Printer thermal cuma hitam-putih — logo dicetak grayscale. Pakai logo kontras (hitam di latar putih).</p>
            </div>

            <div>
              <label className="text-muted" style={label}><Icon name="file" size={15} /> Ukuran Kertas Printer</label>
              <select className="input-field" value={settings.receipt_width_mm} onChange={e => set('receipt_width_mm', e.target.value)}>
                <option value={58}>58mm (default)</option>
                <option value={80}>80mm</option>
              </select>
            </div>

            {TEXT_FIELDS.map(([k, text, ph, multi]) => (
              <div key={k}>
                <label className="text-muted" style={label}>{text}</label>
                {multi
                  ? <textarea className="input-field" rows={3} value={settings[k] || ''} onChange={e => set(k, e.target.value)} placeholder={ph} />
                  : <input type="text" className="input-field" value={settings[k] || ''} onChange={e => set(k, e.target.value)} placeholder={ph} />}
              </div>
            ))}

            <button type="submit" disabled={saving || uploading} className="btn-primary" style={{ marginTop: '0.5rem' }}>
              {saving ? 'Menyimpan...' : 'Simpan Pengaturan'}
            </button>
          </form>
        </div>

        <div style={{ flex: '0 0 auto' }}>
          <div className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '0.5rem', fontWeight: 700 }}>Preview Struk</div>
          <div style={{ border: '1px solid var(--border-color)', borderRadius: 8, padding: '0.5rem', background: '#fff' }}>
            <ReceiptPaper order={SAMPLE_ORDER} branchName="Nama Cabang" settings={settings} />
          </div>
        </div>
      </div>
    </div>
  );
}
