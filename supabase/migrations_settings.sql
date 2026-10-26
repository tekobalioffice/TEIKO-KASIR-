-- Pengaturan struk + kolom shift untuk order Kasir. Aman dijalankan ulang.
-- Satu baris saja (singleton) — trik id boolean primary key default true
-- mencegah baris kedua tanpa app logic tambahan.
create table if not exists public.app_settings (
  id boolean primary key default true,
  check (id),
  receipt_width_mm integer not null default 58, -- 58 atau 80
  receipt_header_text text not null default 'TEIKO',
  receipt_footer_text text not null default 'Terima kasih'
);

alter table public.app_settings add column if not exists receipt_logo_url text;
alter table public.app_settings add column if not exists receipt_address text;
alter table public.app_settings add column if not exists receipt_phone text;
alter table public.app_settings add column if not exists receipt_instagram text;
alter table public.app_settings add column if not exists receipt_extra_text text; -- bebas, mis. "WiFi: teiko123"

insert into public.app_settings (id) values (true) on conflict (id) do nothing;

alter table public.app_settings enable row level security;
drop policy if exists "auth all app_settings" on public.app_settings;
create policy "auth all app_settings" on public.app_settings for all to authenticated using (true) with check (true);

-- Order Kasir dikaitkan ke sesi Input Penjualan (tanggal laporan + shift), bukan created_at:
-- Shift 2 bisa lewat tengah malam tapi tetap masuk laporan tanggal kemarin.
alter table public.orders add column if not exists report_date date;
alter table public.orders add column if not exists paid_amount integer; -- uang dari customer (tunai), buat kembalian di struk
create index if not exists orders_branch_report_idx on public.orders (branch_name, report_date, shift);

-- Logo struk diupload ke bucket storage 'products' (sama dengan foto produk), path settings/...
