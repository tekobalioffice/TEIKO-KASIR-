import { createClient } from '@supabase/supabase-js'

// URL Database Supabase
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
// Kunci API (Anon/Public)
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Client khusus untuk Admin membuat akun staff tanpa mengubah sesi login Admin saat ini
export const supabaseAdminAuth = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  }
})
