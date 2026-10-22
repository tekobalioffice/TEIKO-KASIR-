import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/Icon';
import { supabase } from '../supabase';

export default function Login() {
  const [identifier, setIdentifier] = useState(''); // bisa email atau username
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setError('');
      setLoading(true);

      // Tentukan apakah input adalah email atau username
      let loginEmail = identifier.trim();
      if (!loginEmail.includes('@')) {
        // Cari email berdasarkan username di tabel public.users
        const { data: userData, error: userErr } = await supabase
          .from('users')
          .select('email')
          .eq('username', loginEmail)
          .single();

        if (userErr || !userData?.email) {
          setError('Username tidak ditemukan. Periksa kembali username Anda.');
          return;
        }
        loginEmail = userData.email;
      }

      const result = await login(loginEmail, password);
      
      if (!result?.user) {
        setError('Login gagal. Periksa kembali username/email dan password Anda.');
        return;
      }
      
      // Let AuthContext handle the profile fetching and App.jsx handle the redirection
      // Or we can just wait a tiny bit for the state to sync
      setTimeout(() => navigate('/'), 100);

    } catch (err) {
      setError('Login gagal. Periksa kembali username/email dan password Anda.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="animate-fade-in">
      <div className="glass-panel" style={{ width: '100%', maxWidth: '400px', padding: '2.5rem', margin: '1rem' }}>
        <div className="text-center mb-4">
          <div className="flex justify-center mb-2 text-primary">
            <Icon name="store" size={48} />
          </div>
          <h1 className="text-primary mb-1">TEIKO POS</h1>
          <p className="text-muted">Login to Portal</p>
        </div>

        {error && (
          <div style={{ backgroundColor: 'rgba(255, 56, 60, 0.1)', color: 'var(--danger)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', border: '1px solid rgba(255, 56, 60, 0.2)' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex-col gap-4">
          <div style={{ marginBottom: '1rem' }}>
            <label className="text-muted" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Username atau Email</label>
            <input 
              type="text" 
              className="input-field" 
              value={identifier} 
              onChange={(e) => setIdentifier(e.target.value)}
              required 
              placeholder="bagastya atau admin@teiko.com"
              autoComplete="username"
            />
          </div>
          <div style={{ marginBottom: '1.5rem' }}>
            <label className="text-muted" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Password</label>
            <input 
              type="password" 
              className="input-field" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required 
              placeholder="••••••••"
            />
          </div>
          <button disabled={loading} type="submit" className="btn-primary" style={{ width: '100%' }}>
            {loading ? 'Logging in...' : 'Sign In'}
          </button>
          <div style={{ textAlign: 'center', marginTop: '1rem' }}>
            <Link
              to="/forgot-password"
              style={{ color: 'var(--text-muted)', fontSize: '0.875rem', textDecoration: 'none' }}
              onMouseOver={e => e.target.style.color = 'var(--primary)'}
              onMouseOut={e => e.target.style.color = 'var(--text-muted)'}
            >
              Lupa kata sandi?
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
