import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import { supabase } from '../supabase';

export default function ForgotPassword() {
  const [identifier, setIdentifier] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [sentToEmail, setSentToEmail] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let targetEmail = identifier.trim();

      // Jika bukan email (tidak ada @), cari email berdasarkan username
      if (!targetEmail.includes('@')) {
        const { data: userData, error: userErr } = await supabase
          .from('users')
          .select('email')
          .eq('username', targetEmail)
          .single();

        if (userErr || !userData?.email) {
          setError('Username tidak ditemukan dalam sistem.');
          return;
        }
        targetEmail = userData.email;
      }

      // Tentukan redirect URL berdasarkan environment
      const redirectTo = `${window.location.origin}/reset-password`;

      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(targetEmail, {
        redirectTo,
      });

      if (resetErr) {
        setError('Gagal mengirim email reset. Pastikan email terdaftar di sistem.');
        return;
      }

      setSentToEmail(targetEmail);
      setSent(true);

    } catch (err) {
      console.error(err);
      setError('Terjadi kesalahan. Coba lagi nanti.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="animate-fade-in">
      <div className="glass-panel" style={{ width: '100%', maxWidth: '420px', padding: '2.5rem', margin: '1rem' }}>

        {/* Header */}
        <div className="text-center mb-6">
          <div className="flex justify-center mb-2 text-primary">
            <Icon name="store" size={44} />
          </div>
          <h1 className="text-primary mb-1">TEIKO POS</h1>
          <p className="text-muted">Reset Kata Sandi</p>
        </div>

        {sent ? (
          /* Success State */
          <div className="animate-fade-in">
            <div style={{ textAlign: 'center', padding: '1rem 0' }}>
              <div style={{ color: 'var(--primary)', display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
                <Icon name="check-circle" size={56} />
              </div>
              <h2 style={{ marginBottom: '0.75rem', color: 'var(--primary)' }}>Email Terkirim!</h2>
              <p className="text-muted" style={{ marginBottom: '0.5rem', lineHeight: 1.6 }}>
                Link reset kata sandi telah dikirim ke:
              </p>
              <div style={{
                backgroundColor: 'rgba(9,108,70,0.08)',
                border: '1px solid rgba(9,108,70,0.2)',
                borderRadius: '8px',
                padding: '0.6rem 1rem',
                fontFamily: 'monospace',
                fontWeight: 700,
                color: 'var(--primary)',
                marginBottom: '1.25rem',
                wordBreak: 'break-all'
              }}>
                <Icon name="mail" size={14} style={{ display: 'inline', marginRight: '0.4rem', verticalAlign: 'middle' }} />
                {sentToEmail}
              </div>
              <p className="text-muted" style={{ fontSize: '0.85rem', lineHeight: 1.6 }}>
                Buka email tersebut dan klik link yang diberikan untuk membuat kata sandi baru.
                Link berlaku selama <strong>1 jam</strong>.
              </p>
            </div>
            <Link to="/login" className="btn-secondary" style={{ display: 'flex', justifyContent: 'center', marginTop: '1.5rem', gap: '0.5rem', textDecoration: 'none' }}>
              <Icon name="arrow-left" size={16} /> Kembali ke Login
            </Link>
          </div>
        ) : (
          /* Form State */
          <>
            <p className="text-muted" style={{ marginBottom: '1.5rem', fontSize: '0.9rem', lineHeight: 1.6 }}>
              Masukkan <strong>username</strong> atau <strong>email</strong> yang terdaftar. Link reset kata sandi akan dikirim ke email yang terhubung.
            </p>

            {error && (
              <div style={{
                backgroundColor: 'rgba(255, 56, 60,0.1)',
                color: 'var(--danger)',
                padding: '0.75rem',
                borderRadius: '8px',
                marginBottom: '1rem',
                border: '1px solid rgba(255, 56, 60,0.2)',
                fontSize: '0.9rem'
              }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="flex-col gap-4">
              <div style={{ marginBottom: '1.25rem' }}>
                <label className="text-muted" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                  Username atau Email
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  placeholder="kasir_godean atau email@contoh.com"
                  autoFocus
                  autoComplete="username"
                />
              </div>

              <button disabled={loading} type="submit" className="btn-primary" style={{ width: '100%', marginBottom: '1rem' }}>
                {loading ? 'Mengirim...' : 'Kirim Link Reset'}
              </button>
            </form>

            <Link to="/login" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.875rem', textDecoration: 'none', marginTop: '0.5rem' }}>
              <Icon name="arrow-left" size={14} /> Kembali ke Login
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
