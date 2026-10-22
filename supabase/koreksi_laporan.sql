-- Untuk fitur "Koreksi Laporan Per Baris" (halaman Koreksi Laporan).
-- Jalankan di Supabase Dashboard > SQL Editor.
-- Mengizinkan UPDATE sales_reports oleh user yang sudah login (Supabase Auth).
-- Validasi balance (Awal + Tambah - Jual = Sisa) ditegakkan di aplikasi.

alter table public.sales_reports enable row level security;

drop policy if exists "auth update sales_reports" on public.sales_reports;
create policy "auth update sales_reports"
  on public.sales_reports
  for update
  to authenticated
  using (true)
  with check (true);
