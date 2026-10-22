-- Tabel baru untuk Mode Kasir (grid produk + keranjang + struk + harga channel).
-- Jalankan SETELAH supabase/schema.sql dan supabase/trigger_current_qty.sql.

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  branch_name text not null,
  shift text,
  channel text not null default 'offline', -- 'offline' | 'gojek' | 'grab'
  total integer not null default 0,
  staff_name text,
  created_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id),
  product_name text not null, -- snapshot, kalau produk diubah/dihapus nanti riwayat tetap utuh
  qty integer not null default 1,
  price integer not null default 0, -- harga satuan SAAT transaksi (sudah termasuk harga channel kalau ada)
  variant text
);

-- Harga khusus per channel. Tidak ada baris untuk kombinasi tertentu = pakai products.price biasa.
create table public.product_channel_prices (
  product_id uuid not null references public.products(id) on delete cascade,
  channel text not null, -- 'gojek' | 'grab'
  price integer not null default 0,
  primary key (product_id, channel)
);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.product_channel_prices enable row level security;

drop policy if exists "auth all orders" on public.orders;
create policy "auth all orders" on public.orders for all to authenticated using (true) with check (true);

drop policy if exists "auth all order_items" on public.order_items;
create policy "auth all order_items" on public.order_items for all to authenticated using (true) with check (true);

drop policy if exists "auth all product_channel_prices" on public.product_channel_prices;
create policy "auth all product_channel_prices" on public.product_channel_prices for all to authenticated using (true) with check (true);
