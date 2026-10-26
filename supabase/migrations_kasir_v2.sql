-- Kasir v2: metode bayar (Tunai/QRIS), pembatalan transaksi (void), hak akses lebih ketat.
-- Jalankan di SQL Editor project sistem baru (uuvbdvcwphptbzrqvsja). Aman dijalankan ulang.

-- 1) Metode bayar. 'cash' | 'qris' untuk Offline; Gojek/Grab dicatat 'gojek' / 'grab'.
alter table public.orders add column if not exists payment_method text not null default 'cash';

-- 2) Void: transaksi tidak dihapus, cuma ditandai batal (siapa, kapan, kenapa).
alter table public.orders add column if not exists voided_at timestamptz;
alter table public.orders add column if not exists void_reason text;
alter table public.orders add column if not exists voided_by text;

-- 3) Hak akses. Sebelumnya: semua user login boleh apa saja di semua tabel.
--    Sekarang: transaksi Kasir boleh dibuat & dibatalkan staf, tapi HAPUS cuma admin;
--    harga Gojek/Grab, pengaturan struk, dan master produk cuma admin yang boleh ubah.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid() and lower(u.role) in ('admin', 'administrator', 'owner')
  );
$$;

-- orders
drop policy if exists "auth all orders" on public.orders;
drop policy if exists "orders read" on public.orders;
drop policy if exists "orders insert" on public.orders;
drop policy if exists "orders update" on public.orders;
drop policy if exists "orders delete admin" on public.orders;
create policy "orders read" on public.orders for select to authenticated using (true);
create policy "orders insert" on public.orders for insert to authenticated with check (true);
create policy "orders update" on public.orders for update to authenticated using (true) with check (true); -- void
create policy "orders delete admin" on public.orders for delete to authenticated using (public.is_admin());

-- order_items: staf cuma boleh baca & tambah
drop policy if exists "auth all order_items" on public.order_items;
drop policy if exists "order_items read" on public.order_items;
drop policy if exists "order_items insert" on public.order_items;
drop policy if exists "order_items admin" on public.order_items;
create policy "order_items read" on public.order_items for select to authenticated using (true);
create policy "order_items insert" on public.order_items for insert to authenticated with check (true);
create policy "order_items admin" on public.order_items for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- harga channel, pengaturan, master produk: baca semua, ubah admin
do $$
declare t text;
begin
  foreach t in array array['product_channel_prices', 'app_settings', 'products'] loop
    execute format('drop policy if exists "auth all %1$s" on public.%1$I', t);
    execute format('drop policy if exists "%1$s read" on public.%1$I', t);
    execute format('drop policy if exists "%1$s admin write" on public.%1$I', t);
    execute format('alter table public.%1$I enable row level security', t);
    execute format('create policy "%1$s read" on public.%1$I for select to authenticated using (true)', t);
    execute format('create policy "%1$s admin write" on public.%1$I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Cek: tiap tabel di bawah harus cuma punya policy yang dibuat file ini (tidak ada "auth all ...").
select tablename, policyname, cmd from pg_policies
where schemaname = 'public' and tablename in ('orders', 'order_items', 'product_channel_prices', 'app_settings', 'products')
order by tablename, policyname;
