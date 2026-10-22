import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Icon from '../components/Icon';
import { supabase } from '../supabase';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [validSession, setValidSession] = useState(false);
  const [checking, setChecking] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // Supabase akan mengirim token di URL hash (#access_token=...&type=recovery)
    // Kita perlu mengecek apakah ada session aktif dari link recovery
    const checkSession = async () => {
      // Saat user klik link dari email, Supabase otomatis set session dari URL hash
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setValidSession(true);
      } else {
        setError('Link reset tidak valid atau sudah kedaluwarsa. Silakan minta link baru.');
      }
      setChecking(false);
    };

    // Dengarkan perubahan auth state (Supabase proses token dari URL hash)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setValidSession(true);
        setChecking(false);
      }
    });

    checkSession();
    return () => subscription.unsubscribe();
  }, []);

  const handleReset = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('Konfirmasi kata sandi tidak cocok.');
      return;
    }
    if (password.length < 6) {
      setError('Kata sandi minimal 6 karakter.');
      return;
    }

    setLoading(true);
    try {
      const { error: updateErr } = await supabase.auth.updateUser({ password });
      if (updateErr) {
        setError('Gagal memperbarui kata sandi: ' + updateErr.message);
        return;
      }
      setSuccess(true);
      // Otomatis redirect ke login setelah 3 detik
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      console.error(err);
      setError('Terjadi kesalahan. Coba lagi.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="animate-fade-in">
      <div className="glass-panel" style={{ width: '100%', maxWidth: '420px', padding: '2.5rem', margin: '1rem' }}>

        <div className="text-center mb-6">
          <div className="flex justify-center mb-2 text-primary">
            <Icon name="store" size={44} />
          </div>
          <h1 className="text-primary mb-1">TEIKO POS</h1>
          <p className="text-muted">Buat Kata Sandi Baru</p>
        </div>

        {checking ? (
          <div className="text-center text-muted py-8">Memverifikasi link reset...</div>
        ) : success ? (
          /* Berhasil */
          <div className="animate-fade-in text-center">
            <div style={{ color: 'var(--primary)', display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
              <Icon name="check-circle" size={56} />
            </div>
            <h2 style={{ color: 'var(--primary)', marginBottom: '0.75rem' }}>Kata Sandi Diperbarui!</h2>
            <p className="text-muted" style={{ marginBottom: '1.5rem', lineHeight: 1.6 }}>
              Kata sandi Anda berhasil diubah. Anda akan diarahkan ke halaman login dalam beberapa detik...
            </p>
            <Link to="/login" className="btn-primary" style={{ display: 'flex', justifyContent: 'center', textDecoration: 'none' }}>
              Ke Halaman Login
            </Link>
          </div>
        ) : !validSession ? (
          /* Link Tidak Valid */
          <div className="animate-fade-in text-center">
            <div style={{ color: 'var(--danger)', display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
              <Icon name="key" size={48} />
            </div>
            <p style={{ color: 'var(--danger)', marginBottom: '1.5rem', lineHeight: 1.6 }}>{error}</p>
            <Link to="/forgot-password" className="btn-primary" style={{ display: 'flex', justifyContent: 'center', textDecoration: 'none' }}>
              Minta Link Baru
            </Link>
          </div>
        ) : (
          /* Form Ganti Sandi */
          <>
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

            <form onSubmit={handleReset} className="flex-col gap-4">
              <div style={{ marginBottom: '1rem' }}>
                <label className="text-muted" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                  Kata Sandi Baru
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="input-field"
                    style={{ paddingRight: '2.5rem' }}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    placeholder="Minimal 6 karakter"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}
                  >
                    {showPassword ? <Icon name="eye-off" size={16} /> : <Icon name="eye" size={16} />}
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <label className="text-muted" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                  Konfirmasi Kata Sandi Baru
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input-field"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={6}
                  placeholder="Ulangi kata sandi baru"
                />
                {confirm && password !== confirm && (
                  <p style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '0.3rem' }}>
                    Kata sandi tidak cocok
                  </p>
                )}
                {confirm && password === confirm && confirm.length >= 6 && (
                  <p style={{ color: 'var(--primary)', fontSize: '0.8rem', marginTop: '0.3rem' }}>
                    Kata sandi cocok
                  </p>
                )}
              </div>

              <button
                disabled={loading || password !== confirm || password.length < 6}
                type="submit"
                className="btn-primary"
                style={{ width: '100%' }}
              >
                {loading ? 'Menyimpan...' : 'Simpan Kata Sandi Baru'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
