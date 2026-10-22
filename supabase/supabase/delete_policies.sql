-- Fix: "Penghapusan diblokir oleh sistem database (RLS)" saat hapus laporan POS.
-- Jalankan di Supabase Dashboard > SQL Editor.
-- Policy dibatasi ke user yang sudah login (Supabase Auth), bukan anon publik.

-- 1. Laporan penjualan
alter table public.sales_reports enable row level security;

drop policy if exists "auth delete sales_reports" on public.sales_reports;
create policy "auth delete sales_reports"
  on public.sales_reports
  for delete
  to authenticated
  using (true);

-- 2. Log restock/pemotongan stok (dibersihkan saat laporan dihapus)
alter table public.stock_restock_log enable row level security;

drop policy if exists "auth delete stock_restock_log" on public.stock_restock_log;
create policy "auth delete stock_restock_log"
  on public.stock_restock_log
  for delete
  to authenticated
  using (true);

-- 3. (opsional) kalau revert stok saat hapus laporan juga gagal, pastikan UPDATE branch_inventory diizinkan:
-- drop policy if exists "auth update branch_inventory" on public.branch_inventory;
-- create policy "auth update branch_inventory"
--   on public.branch_inventory for update to authenticated using (true) with check (true);
