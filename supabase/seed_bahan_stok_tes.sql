-- Bahan / operasional (salinan nama dari laporan produksi DS 23 Okt, 32 item) + stok TES
-- di display semua cabang. Aman dijalankan ulang: bahan/stok yang sudah ada tidak ditimpa.
-- Stok tes: cup 100, Diamond/Ultra 10 kotak, bahan lain 20; menu yang punya stok sendiri 20.

with bahan(name, display_order, stok) as (values
  ('Gula 1', 1, 20),
  ('Gula 2', 2, 20),
  ('Premium Tea 1', 3, 20),
  ('Premium 2', 4, 20),
  ('Paper Cup', 5, 100),
  ('Cup (Flat) Ori', 6, 100),
  ('Cup (Flat) Premi', 7, 100),
  ('Black Tea Ori', 8, 20),
  ('Black Tea Premi', 9, 20),
  ('Gula Milk Tea Ori', 10, 20),
  ('Gula Milk Tea Premi', 11, 20),
  ('Diamond BC', 12, 10),
  ('Diamond Besar', 13, 10),
  ('Ultra Milk Besar', 14, 10),
  ('OatMilk', 15, 20),
  ('Bubble Besar', 16, 20),
  ('Bubble Kecil', 17, 20),
  ('Susu Kental Manis', 18, 20),
  ('Gula Cair', 19, 20),
  ('Krim Cair', 20, 20),
  ('Sedotan Kecil', 21, 20),
  ('Sedotan Besar', 22, 20),
  ('Sedotan Topping', 23, 20),
  ('Tutup Manual Ori', 24, 20),
  ('Tutup Manual Premi', 25, 20),
  ('Tisu Kering', 26, 20),
  ('Tisu Basah', 27, 20),
  ('Sealer', 28, 20),
  ('Form Penjualan', 29, 20),
  ('Form Stok', 30, 20),
  ('QCP', 31, 20),
  ('Kertas Thermal', 32, 20)
)
insert into public.operational_items (name, category, display_order)
select b.name, 'Bahan', b.display_order from bahan b
where not exists (select 1 from public.operational_items o where lower(trim(o.name)) = lower(b.name));

-- Stok display tes: bahan.
with bahan(name, stok) as (values
  ('Gula 1', 20),
  ('Gula 2', 20),
  ('Premium Tea 1', 20),
  ('Premium 2', 20),
  ('Paper Cup', 100),
  ('Cup (Flat) Ori', 100),
  ('Cup (Flat) Premi', 100),
  ('Black Tea Ori', 20),
  ('Black Tea Premi', 20),
  ('Gula Milk Tea Ori', 20),
  ('Gula Milk Tea Premi', 20),
  ('Diamond BC', 10),
  ('Diamond Besar', 10),
  ('Ultra Milk Besar', 10),
  ('OatMilk', 20),
  ('Bubble Besar', 20),
  ('Bubble Kecil', 20),
  ('Susu Kental Manis', 20),
  ('Gula Cair', 20),
  ('Krim Cair', 20),
  ('Sedotan Kecil', 20),
  ('Sedotan Besar', 20),
  ('Sedotan Topping', 20),
  ('Tutup Manual Ori', 20),
  ('Tutup Manual Premi', 20),
  ('Tisu Kering', 20),
  ('Tisu Basah', 20),
  ('Sealer', 20),
  ('Form Penjualan', 20),
  ('Form Stok', 20),
  ('QCP', 20),
  ('Kertas Thermal', 20)
)
insert into public.branch_inventory (branch_name, item_name, display_qty, safety_qty, tambah_qty)
select o.name, b.name, b.stok, 0, 0 from public.outlets o cross join bahan b
on conflict (branch_name, item_name) do nothing;

-- Stok display tes: menu yang punya stok sendiri (bukan unlimited, bukan Es Teh/Teh Tarik/Milk Tea/Full Cream).
-- Nama item = nama + varian (kecuali Standar), sama dengan kunci stok di aplikasi.
insert into public.branch_inventory (branch_name, item_name, display_qty, safety_qty, tambah_qty)
select o.name,
       case when coalesce(nullif(p.variant, ''), 'Standar') = 'Standar' then p.name else p.name || ' ' || p.variant end,
       20, 0, 0
from public.outlets o cross join public.products p
where not coalesce(p.is_unlimited, false)
  and p.name not in ('Es Teh', 'Teh Tarik', 'Milk Tea', 'Full Cream')
on conflict (branch_name, item_name) do nothing;

-- Cek: jumlah bahan & stok per cabang.
select o.name as cabang, count(bi.*) as item_stok
from public.outlets o left join public.branch_inventory bi on bi.branch_name = o.name
group by o.name order by o.name;
