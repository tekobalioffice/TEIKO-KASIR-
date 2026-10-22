import { createClient } from '@supabase/supabase-js'

// URL Database Supabase
const supabaseUrl = 'https://ltufkvpsdbdybhheflwi.supabase.co'
// Kunci API (Anon/Public)
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0dWZrdnBzZGJkeWJoaGVmbHdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNDAyOTAsImV4cCI6MjA4ODgxNjI5MH0.EdhPLL_Vhwwcep-6jQY2Sz40zVLHPa5TNW1q21CyrrM'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Client khusus untuk Admin membuat akun staff tanpa mengubah sesi login Admin saat ini
export const supabaseAdminAuth = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  }
})
