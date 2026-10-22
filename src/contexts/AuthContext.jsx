import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabase';

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);

  async function login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  }

  async function logout() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  async function handleUserChange(user) {
    if (!user) {
      setUserData(null);
      setCurrentUser(null);
      setLoading(false);
      return;
    }

    setCurrentUser(user);
    // If we already have userData for this user, don't fetch again
    if (userData && userData.id === user.id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('users')
        .select('id, name, branch, role, username')
        .eq('id', user.id)
        .single();
        
      if (data) {
        setUserData(data);
      } else {
        setUserData({ role: 'unknown' });
      }
    } catch (error) {
      console.error("Error fetching user profile from Supabase", error);
      setUserData({ role: 'unknown' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Check initial active session
    supabase.auth.getSession().then((res) => {
      if (res.error) console.error("Session error:", res.error);
      const session = res.data?.session;
      handleUserChange(session?.user ?? null);
    }).catch(err => {
      console.error("Critical Auth Error:", err);
      handleUserChange(null);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handleUserChange(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const value = {
    currentUser,
    userData,
    loading,
    login,
    logout
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
