-- Skema disusun ulang dari Table Editor project lama (teikopr0jec) + pemakaian di src/.
-- Semua tabel sudah dicek dari screenshot kolom asli (bukan tebakan lagi).
-- Jalankan di Supabase Dashboard (project baru) > SQL Editor.

-- ============ outlets ============
create table public.outlets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  allow_inventory_edit boolean not null default true
);

-- ============ users (staf/admin, bukan auth.users) ============
create table public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null, -- 'admin' | 'branch' | 'gudang' | 'owner'
  branch text,
  username text unique,
  email text
);

-- ============ products ============
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  price numeric default 0,
  variant text,
  image_url text,
  is_unlimited boolean default false,
  display_order integer,
  uses_tea boolean default false,
  is_dual_base boolean default false,
  susu_add_price integer default 0,
  is_non_base boolean default false
);

-- ============ operational_items (bahan/operasional di opname) ============
create table public.operational_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text,
  category text,
  created_at timestamptz not null default now(),
  is_unlimited boolean default false,
  display_order integer
);

-- ============ branch_inventory (stok real-time per cabang per item) ============
create table public.branch_inventory (
  id uuid primary key default gen_random_uuid(),
  branch_name text not null,
  item_name text not null,
  current_qty numeric default 0, -- dipaksa trigger = display_qty + safety_qty
  updated_at timestamptz not null default now(),
  display_qty numeric default 0,
  safety_qty numeric default 0,
  tambah_qty numeric default 0,
  unique (branch_name, item_name)
);

-- trigger trg_sync_current_qty: lihat supabase/trigger_current_qty.sql
-- jalankan file itu SETELAH tabel ini dibuat.

-- ============ sales_reports (laporan per shift, dasar omzet blind POS) ============
create table public.sales_reports (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  branch text, -- kolom lama, sering null, dibiarkan untuk kompatibilitas
  shift text not null,
  totals numeric default 0, -- kolom lama, tak dipakai payload insert, dibiarkan default 0
  details jsonb default '[]'::jsonb,   -- array per-produk (qty, price, setoran_aktual/selisih/note nebeng di sini)
  expenses jsonb default '[]'::jsonb,  -- array {name, amount}
  stocks jsonb default '[]'::jsonb,    -- obsolete, dibiarkan kosong
  branch_name text not null,
  staff_name text,
  cash_awal integer default 0,
  total_revenue integer default 0,
  total_expense integer default 0,
  cash_akhir integer default 0,
  created_at timestamptz not null default now()
);

-- ============ stock_restock_log (mutasi stok: tambah/kirim/koreksi) ============
create table public.stock_restock_log (
  id uuid primary key default gen_random_uuid(),
  branch_name text not null,
  item_name text not null,
  petugas_name text,
  qty_added numeric default 0,
  qty_before numeric default 0,
  qty_after numeric default 0,
  created_at timestamptz not null default now()
);

-- ============ pending_stock_actions (transfer antar cabang, nunggu ACC) ============
-- Dikonfirmasi dari Definition project lama.
create table public.pending_stock_actions (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  action_type text not null, -- 'transfer' | 'transfer_out' | 'deduct' dll
  item_name text not null,
  qty numeric not null,
  source_branch text,
  target_branch text,
  created_by text,
  status text not null default 'pending', -- 'pending' | 'approved' | 'rejected_acked' dll
  note text
);

-- ============ stock_distributions (kiriman gudang -> cabang) ============
create table public.stock_distributions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  to_branch text not null,
  item_name text,
  qty numeric,
  sent_by text,
  notes text
);

-- ============ profiles (link ke auth.users, role ringkas) ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text
);

-- ============ warehouse_inventory (stok gudang pusat) ============
create table public.warehouse_inventory (
  id uuid primary key default gen_random_uuid(),
  item_name text not null,
  current_qty numeric default 0,
  updated_at timestamptz not null default now()
);

-- ============ RLS: pola yang sudah dipakai di project lama (lihat supabase/delete_policies.sql, koreksi_laporan.sql) ============
-- Semua tabel: izinkan authenticated full access. Sesuaikan lagi kalau project lama lebih ketat.
do $$
declare t text;
begin
  for t in select unnest(array[
    'outlets','users','products','operational_items','branch_inventory',
    'sales_reports','stock_restock_log','pending_stock_actions',
    'stock_distributions','profiles','warehouse_inventory'
  ])
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "auth all %I" on public.%I;', t, t);
    execute format(
      'create policy "auth all %I" on public.%I for all to authenticated using (true) with check (true);',
      t, t
    );
  end loop;
end $$;
