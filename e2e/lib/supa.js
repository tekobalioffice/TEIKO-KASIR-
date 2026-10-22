import { createClient } from '@supabase/supabase-js';

// Sama dengan src/supabase.js (nilai ini memang sudah ada di repo).
const URL = 'https://ltufkvpsdbdybhheflwi.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0dWZrdnBzZGJkeWJoaGVmbHdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNDAyOTAsImV4cCI6MjA4ODgxNjI5MH0.EdhPLL_Vhwwcep-6jQY2Sz40zVLHPa5TNW1q21CyrrM';

const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ANON;

export const supa = createClient(URL, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export const hasServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
export const TEST_OUTLET = process.env.E2E_TEST_OUTLET || 'TEST-E2E';

/** Snapshot branch_inventory untuk satu outlet — dipakai assert sebelum/sesudah. */
export async function inventorySnapshot(branch) {
  const { data, error } = await supa
    .from('branch_inventory')
    .select('item_name, current_qty, display_qty, safety_qty, tambah_qty')
    .eq('branch_name', branch);
  if (error) throw error;
  const map = {};
  for (const row of data) map[row.item_name] = row;
  return map;
}

/** Log stok terbaru untuk outlet (buat verifikasi jejak kurasi/oper/tambah). */
export async function latestLogs(branch, limit = 20) {
  const { data, error } = await supa
    .from('stock_restock_log')
    .select('item_name, qty_added, qty_before, qty_after, petugas_name, created_at')
    .eq('branch_name', branch)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function outletExists(name) {
  const { data } = await supa.from('outlets').select('name').eq('name', name).maybeSingle();
  return !!data;
}

/**
 * Reset stok outlet test ke baseline supaya run berulang deterministik
 * (tiap flow mengurangi stok; tanpa reset lama-lama semua 0 → sweep semua skip).
 * Juga bersihkan pending_stock_actions sisa oper + kiriman uji.
 */
export async function seedOutlet(branch, { current = 30, display = 15, safety = 15 } = {}) {
  const { data, error } = await supa
    .from('branch_inventory').select('id, item_name').eq('branch_name', branch);
  if (error) throw error;
  for (const row of data) {
    await supa.from('branch_inventory')
      .update({ current_qty: current, display_qty: display, safety_qty: safety })
      .eq('id', row.id);
  }
  await supa.from('pending_stock_actions').delete().eq('source_branch', branch).eq('status', 'pending');
  await supa.from('pending_stock_actions').delete().eq('target_branch', branch).eq('status', 'pending');
  return data.length;
}
