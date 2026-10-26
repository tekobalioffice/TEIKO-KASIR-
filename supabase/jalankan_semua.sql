-- Gabungan: migrations_settings.sql + seed_products_full.sql + dedupe_products.sql.
-- Tempel SEMUA isi file ini ke SQL Editor Supabase lalu Run. Aman dijalankan ulang.

-- ===================== migrations_settings.sql =====================
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

-- ===================== seed_products_full.sql =====================
-- Master produk lengkap (salinan dari produksi, 71 item). Aman dijalankan ulang.
-- 1) Buang produk contoh dari scripts/seed-dev.mjs (id acak, nama kembar dengan data asli;
--    "Es Teh" contohnya bahkan is_unlimited = true, padahal Es Teh WAJIB false).
--    Yang sudah dipakai transaksi Kasir (order_items) dibiarkan supaya riwayat tidak rusak.
delete from public.products p
where p.id not in (
  '04218917-4393-4662-91c8-5962d2e28405','05a2bd3d-6315-4fb4-8e45-f9f3ec142606','0b7102f0-3d20-4efc-aef0-5e1def720543',
  '13153e38-b01a-45de-9ce6-e60ae2c00867','145195c3-068a-45a4-b033-6e12e15cd548','183e960a-c8f2-41c4-9dc2-50f4f40cf33c',
  '1c51fd75-9d4a-4bb7-a825-d1231ad149eb','1ed27644-f187-464c-84b7-761e34b99191','1f4d5051-22a0-4a7c-8c1b-9e1c290d5ca1',
  '1f4f188c-680b-4e01-8703-98489a039730','1fc5141f-19c2-4527-a26b-7ba42995c5a9','20cb696d-3d29-41e2-94de-8ad6628cc489',
  '210ea332-f496-4e4c-96e4-a56f1cf6a3b6','21117977-2db3-4619-b67a-906fef4ecbf2','24ccfdaf-cfcb-4297-82ae-5deec77bc27d',
  '2c9ab654-31fa-47e9-bb3b-5258616ea7f5','353e0997-bae3-4484-a74f-21423aa5758e','3d21584b-b59a-4fb1-b853-bc745d76c5fd',
  '43180b69-4dfe-47f2-a4a4-4dd10b00d4c7','482eb95c-ee92-47b8-97f4-63a15e6f8d2f','5867b52f-d0ae-45ad-aca1-9ada65073297',
  '5e1cb61d-7cb1-49d1-a337-4260b6e5b8ab','6063fe1c-f65a-48bf-a395-217430b89d12','65fe6ecf-831b-48b9-82a4-35b401a8047a',
  '67372f28-5527-4d32-988b-3940ac884529','69b16af8-bdc6-416e-aea0-f25dec38f4b0','6a59fd5d-9979-4aa7-9ab6-9c424a9a9313',
  '6bfa7aa4-a46b-48f9-8729-6f0759aa01ce','6d0d5b6c-0671-4afe-a701-0b3829d2dfff','785279ff-5118-4982-9fb2-404567699031',
  '78a29bfb-66e4-4f7f-938c-e224be025bfd','7cc8d0d8-f811-4540-a709-9c4be8f7ccb8','80aa9b88-aca1-4729-8b3c-09905385afb5',
  '81a51c15-4e55-45f5-8c6a-51e54086a14f','828b1d99-4c43-4529-9dc3-f70ab51b76ed','8688ad27-b2d8-4db3-9659-7f447ff4593c',
  '87711c01-6af9-41db-9b3f-68183741d65d','8b2707d4-2f8b-4db2-beaf-1b1c6aeed186','90ba0ca2-a764-4676-9ee2-5341b7e94bcb',
  '917bf967-28f4-4f18-9e2b-f50259227006','95696b73-bea2-4171-8cba-ee47bb0ccb84','95904513-e42f-4809-be83-f82bc033db31',
  '9dbc3a46-71bf-4cdd-b6b0-b303e9b1f683','a43ed3d1-6392-4d9c-86bc-ff3466cc822c','a7015934-a200-4827-a0bf-cff917d2772d',
  'b1311f6a-4dfb-4569-8441-dbf4a4b40304','b1d4bfad-8443-4929-8667-75ad73fd30d3','b43a2eb0-42fa-468c-b903-cc72957ca876',
  'b505a1f7-566e-4883-8db3-d2e06411051e','b5f861c3-34c6-4855-a04e-2de038e5bf31','b6e7bf3f-c461-4299-b94f-4ea6c57a2628',
  'b81e9014-e614-4b27-aefe-7d766ddf03eb','bf2d69d9-c886-4009-a4fb-d89715e56cd5','c57849b1-7691-43d1-b19c-782b5c07149f',
  'c774c0db-4f81-44fd-95df-51dbc6265b6a','c985519a-a0ef-43d0-bc9c-507a5c138a0d','c9c2884b-a092-4c77-9810-f939ff5f5679',
  'ca934a8f-f897-4bd9-9ff1-11762bd6e07c','cd8d05c0-a754-4dbb-9910-2a0fa7863b5f','cdfca8db-0193-49c9-8dd7-a5b34d74e166',
  'd68adc5f-a674-418b-b73f-4ffdfb591548','d6eda8b6-e189-4b87-a327-332412a3e5ec','dfbaa937-c42d-4e51-bdc9-5a331422a358',
  'dffd6e70-b196-4754-a6fe-0b3b6294714c','e1d86677-3274-4689-8c15-62818e4f4d31','e304a98e-05f8-45fa-b966-cec11cdb0fed',
  'e62d2414-a552-4805-b5fb-c9d6685396e7','e9ac0bac-e6e1-4f8e-aef0-3d7804877783','f85a5fd7-c7fd-4004-b7c1-22204d8b79fd',
  'fddaa6e1-e777-4271-a31c-43647882908f','fe8885a3-04d2-4c1c-8bdb-555c3dc5a7c2'
)
and p.name in ('Choco Oreo', 'GD Capucinno', 'NS Lemon', 'Es Teh')
and not exists (select 1 from public.order_items oi where oi.product_id = p.id);

-- 2) Masukkan master produk asli. Sudah ada (id sama) = dilewati.
INSERT INTO public.products (id, name, category, price, variant, image_url, is_unlimited, display_order, uses_tea, is_dual_base, susu_add_price, is_non_base) VALUES ('04218917-4393-4662-91c8-5962d2e28405', 'Choco Oreo', 'Sachet Series', '5000.00', 'Ori', null, true, 58, false, false, 0, false), ('05a2bd3d-6315-4fb4-8e45-f9f3ec142606', 'GD Capucinno', 'Sachet Series', '6000.00', 'Ori', null, false, 12, false, false, 0, false), ('0b7102f0-3d20-4efc-aef0-5e1def720543', 'Beng-Beng', 'Sachet Series', '6000.00', 'Ori', null, false, 10, false, false, 0, false), ('13153e38-b01a-45de-9ce6-e60ae2c00867', 'Teh Serai', 'Hot Series', '6000.00', 'Standar', null, true, 66, false, false, 0, false), ('145195c3-068a-45a4-b033-6e12e15cd548', 'NS Lemon', 'Sachet Series', '8000.00', 'Premi', null, false, 21, false, false, 3000, false), ('183e960a-c8f2-41c4-9dc2-50f4f40cf33c', 'NS Jeruk', 'Sachet Series', '5000.00', 'Ori', null, false, 16, false, false, 3000, false), ('1c51fd75-9d4a-4bb7-a825-d1231ad149eb', 'Ice Americano', 'Coffee Series', '9000.00', 'Premi', null, true, 63, false, false, 0, false), ('1ed27644-f187-464c-84b7-761e34b99191', 'NS Lemon', 'Sachet Series', '5000.00', 'Ori', null, false, 20, false, false, 3000, false), ('1f4d5051-22a0-4a7c-8c1b-9e1c290d5ca1', 'Brown Sugar', 'Coffee Series', '6000.00', 'Standar', null, false, 69, false, false, 0, false), ('1f4f188c-680b-4e01-8703-98489a039730', 'Thai Tea', 'Tea Series', '10000.00', 'Ori', null, false, 38, false, false, 0, false), ('1fc5141f-19c2-4527-a26b-7ba42995c5a9', 'Avocado', 'Milky Series', '5000.00', 'Ori', null, false, 54, false, false, 0, false), ('20cb696d-3d29-41e2-94de-8ad6628cc489', 'Green Tea Latte', 'Tea Series', '7000.00', 'Premi', null, false, 57, false, false, 0, false), ('210ea332-f496-4e4c-96e4-a56f1cf6a3b6', 'Cao Jelly', 'Topping', '2000.00', 'Standar', null, false, 77, false, false, 0, true), ('21117977-2db3-4619-b67a-906fef4ecbf2', 'Kresek', 'Drink', '2000.00', 'Standar', null, false, 88, false, false, 0, true), ('24ccfdaf-cfcb-4297-82ae-5deec77bc27d', 'Dancow Cokelat', 'Sachet Series', '9000.00', 'Ori', null, false, 24, false, false, 0, false), ('2c9ab654-31fa-47e9-bb3b-5258616ea7f5', 'Kopi Bali', 'Hot Series', '6000.00', 'Standar', null, false, 65, false, false, 0, false), ('353e0997-bae3-4484-a74f-21423aa5758e', 'Belgian Choco', 'Choco Series', '10000.00', 'Ori', null, true, 48, false, false, 0, false), ('3d21584b-b59a-4fb1-b853-bc745d76c5fd', 'Es Teh', 'Tea Series', '3000.00', 'Ori', 'https://ltufkvpsdbdybhheflwi.supabase.co/storage/v1/object/public/products/1777449683355_ypifrwz2ztd.png', false, 97, false, false, 0, false), ('43180b69-4dfe-47f2-a4a4-4dd10b00d4c7', 'Green Thai Tea Premi', 'Drink', '15000.00', 'Standar', null, false, 41, false, false, 0, false), ('482eb95c-ee92-47b8-97f4-63a15e6f8d2f', 'Belgian Choco', 'Choco Series', '14000.00', 'Premi', null, true, 49, false, false, 0, false), ('5867b52f-d0ae-45ad-aca1-9ada65073297', 'Ice Americano', 'Coffee Series', '6000.00', 'Ori', null, true, 62, false, false, 0, false), ('5e1cb61d-7cb1-49d1-a337-4260b6e5b8ab', 'Taro', 'Milky Series', '7000.00', 'Premi', null, false, 61, false, false, 0, false), ('6063fe1c-f65a-48bf-a395-217430b89d12', 'Coffee Jelly', 'Topping', '2000.00', 'Standar', null, false, 74, false, false, 0, true), ('65fe6ecf-831b-48b9-82a4-35b401a8047a', 'NS Jeruk', 'Sachet Series', '8000.00', 'Premi', null, false, 17, false, false, 3000, false), ('67372f28-5527-4d32-988b-3940ac884529', 'Tehspresso', 'Coffee Series', '10000.00', 'Premi', null, false, 33, false, false, 0, false), ('69b16af8-bdc6-416e-aea0-f25dec38f4b0', 'Melon', 'Milky Series', '3000.00', 'Ori', null, false, 52, false, false, 0, false), ('6a59fd5d-9979-4aa7-9ab6-9c424a9a9313', 'Madu Hutan', 'Tea Series', '5000.00', 'Ori', null, false, 28, false, false, 0, false), ('6bfa7aa4-a46b-48f9-8729-6f0759aa01ce', 'Extra Joss Susu', 'Sachet Series', '9000.00', 'Premi', null, false, 15, false, false, 0, false), ('6d0d5b6c-0671-4afe-a701-0b3829d2dfff', 'Leci Jelly', 'Topping', '2000.00', 'Standar', null, false, 76, false, false, 0, true), ('785279ff-5118-4982-9fb2-404567699031', 'Beng-Beng', 'Sachet Series', '9000.00', 'Premi', null, false, 11, false, false, 0, false), ('78a29bfb-66e4-4f7f-938c-e224be025bfd', 'Choco Oreo', 'Sachet Series', '7000.00', 'Premi', null, true, 59, false, false, 0, false), ('7cc8d0d8-f811-4540-a709-9c4be8f7ccb8', 'Coffee Cream', 'Coffee Series', '13000.00', 'Standar', null, false, 68, false, false, 0, false), ('80aa9b88-aca1-4729-8b3c-09905385afb5', 'Teh Tarik', 'Tea Series', '12000.00', 'Premi', null, false, 104, false, false, 0, false), ('81a51c15-4e55-45f5-8c6a-51e54086a14f', 'Salted Caramel', 'Coffee Series', '6000.00', 'Standar', null, false, 70, false, false, 0, false), ('828b1d99-4c43-4529-9dc3-f70ab51b76ed', 'Matcha Oat Latte', 'Tea Series', '23000.00', 'Ori', null, true, 42, false, false, 0, false), ('8688ad27-b2d8-4db3-9659-7f447ff4593c', 'Milk Tea', 'Tea Series', '10000.00', 'Ori', null, true, 101, false, false, 0, false), ('87711c01-6af9-41db-9b3f-68183741d65d', 'Hazelnut', 'Drink', '6000.00', 'Standar', null, false, 71, false, false, 0, false), ('8b2707d4-2f8b-4db2-beaf-1b1c6aeed186', 'NS Leci', 'Sachet Series', '5000.00', 'Ori', null, false, 22, false, false, 3000, false), ('90ba0ca2-a764-4676-9ee2-5341b7e94bcb', 'Green Thai Tea Ori', 'Tea Series', '10000.00', 'Standar', null, false, 40, false, false, 0, false), ('917bf967-28f4-4f18-9e2b-f50259227006', 'Milo', 'Sachet Series', '6000.00', 'Ori', null, false, 8, false, false, 0, false), ('95696b73-bea2-4171-8cba-ee47bb0ccb84', 'Teh Matcha Latte', 'Tea Series', '8000.00', 'Standar', null, false, 96, false, false, 0, false), ('95904513-e42f-4809-be83-f82bc033db31', 'Es Coklat', 'Choco Series', '10000.00', 'Premi', null, true, 31, false, false, 0, false), ('9dbc3a46-71bf-4cdd-b6b0-b303e9b1f683', 'Milo', 'Sachet Series', '9000.00', 'Premi', null, false, 9, false, false, 0, false), ('a43ed3d1-6392-4d9c-86bc-ff3466cc822c', 'Tehspresso', 'Coffee Series', '7000.00', 'Ori', null, false, 32, false, false, 0, false), ('a7015934-a200-4827-a0bf-cff917d2772d', 'NS Jeruk Nipis', 'Sachet Series', '5000.00', 'Ori', null, false, 18, false, false, 3000, false), ('b1311f6a-4dfb-4569-8441-dbf4a4b40304', 'Teh Jahe', 'Hot Series', '6000.00', 'Standar', null, false, 67, false, false, 0, false), ('b1d4bfad-8443-4929-8667-75ad73fd30d3', 'Teh Tarik', 'Tea Series', '8000.00', 'Ori', null, false, 103, false, false, 0, false), ('b43a2eb0-42fa-468c-b903-cc72957ca876', 'Dancow Putih', 'Sachet Series', '9000.00', 'Ori', null, false, 26, false, false, 0, false), ('b505a1f7-566e-4883-8db3-d2e06411051e', 'Extra Joss Susu', 'Sachet Series', '6000.00', 'Ori', null, false, 14, false, false, 0, false), ('b5f861c3-34c6-4855-a04e-2de038e5bf31', 'Thai Tea', 'Tea Series', '14000.00', 'Premi', null, false, 39, false, false, 0, false), ('b6e7bf3f-c461-4299-b94f-4ea6c57a2628', 'Madu Hutan', 'Tea Series', '8000.00', 'Premi', null, false, 29, false, false, 0, false), ('b81e9014-e614-4b27-aefe-7d766ddf03eb', 'Es Teh', 'Tea Series', '5000.00', 'Premi', 'https://ltufkvpsdbdybhheflwi.supabase.co/storage/v1/object/public/products/1777449695966_0rnddno883fk.png', false, 98, false, false, 0, false), ('bf2d69d9-c886-4009-a4fb-d89715e56cd5', 'Strawberry', 'Milky Series', '3000.00', 'Ori', null, false, 50, false, false, 0, false), ('c57849b1-7691-43d1-b19c-782b5c07149f', 'Strawberry', 'Milky Series', '4000.00', 'Premi', null, false, 51, false, false, 0, false), ('c774c0db-4f81-44fd-95df-51dbc6265b6a', 'GD Capucinno', 'Sachet Series', '9000.00', 'Premi', null, false, 13, false, false, 0, false), ('c985519a-a0ef-43d0-bc9c-507a5c138a0d', 'Espresso (Hot)', 'Hot Series', '6000.00', 'Standar', null, true, 64, false, false, 0, false), ('c9c2884b-a092-4c77-9810-f939ff5f5679', 'NS Jeruk Nipis', 'Sachet Series', '8000.00', 'Premi', null, false, 19, false, false, 3000, false), ('ca934a8f-f897-4bd9-9ff1-11762bd6e07c', 'Green Tea Latte', 'Tea Series', '5000.00', 'Ori', null, false, 56, false, false, 0, false), ('cd8d05c0-a754-4dbb-9910-2a0fa7863b5f', 'Dancow Cokelat', 'Sachet Series', '12000.00', 'Premi', null, false, 25, false, false, 0, false), ('cdfca8db-0193-49c9-8dd7-a5b34d74e166', 'Full Cream', 'Milky Series', '12000.00', 'Premi', null, true, 100, false, false, 0, false), ('d68adc5f-a674-418b-b73f-4ffdfb591548', 'Matcha Oat Latte', 'Tea Series', '32000.00', 'Premi', null, true, 43, false, false, 0, false), ('d6eda8b6-e189-4b87-a327-332412a3e5ec', 'NS Leci', 'Sachet Series', '8000.00', 'Premi', null, false, 23, false, false, 3000, false), ('dfbaa937-c42d-4e51-bdc9-5a331422a358', 'Dancow Putih', 'Sachet Series', '12000.00', 'Premi', null, false, 27, false, false, 0, false), ('dffd6e70-b196-4754-a6fe-0b3b6294714c', 'Milk Tea', 'Tea Series', '14000.00', 'Premi', null, true, 102, false, false, 0, false), ('e1d86677-3274-4689-8c15-62818e4f4d31', 'Melon', 'Milky Series', '4000.00', 'Premi', null, false, 53, false, false, 0, false), ('e304a98e-05f8-45fa-b966-cec11cdb0fed', 'Pudding Vanilla', 'Topping', '2000.00', 'Standar', null, false, 79, false, false, 0, true), ('e62d2414-a552-4805-b5fb-c9d6685396e7', 'Avocado', 'Milky Series', '7000.00', 'Premi', null, false, 55, false, false, 0, false), ('e9ac0bac-e6e1-4f8e-aef0-3d7804877783', 'Full Cream', 'Milky Series', '8000.00', 'Ori', null, true, 99, false, false, 0, false), ('f85a5fd7-c7fd-4004-b7c1-22204d8b79fd', 'Pudding Coklat', 'Topping', '2000.00', 'Standar', null, false, 78, false, false, 0, true), ('fddaa6e1-e777-4271-a31c-43647882908f', 'Es Coklat', 'Choco Series', '7000.00', 'Ori', null, true, 30, false, false, 0, false), ('fe8885a3-04d2-4c1c-8bdb-555c3dc5a7c2', 'Taro', 'Milky Series', '5000.00', 'Ori', null, false, 60, false, false, 0, false)
ON CONFLICT (id) DO NOTHING;

-- Kategori 'Teh' cuma berisi Teh Matcha Latte -> digabung ke 'Tea Series' (tab Kasir & opname).
update public.products set category = 'Tea Series' where category = 'Teh';

-- 3) Cek: harus 71 (+ produk contoh yang sudah terlanjur dipakai transaksi, kalau ada).
select count(*) as total_produk from public.products;

-- ===================== dedupe_products.sql =====================
-- Hapus data kembar (double). Aman dijalankan ulang; jalankan SESUDAH seed_products_full.sql.
-- Produk dianggap kembar kalau nama + varian sama (huruf besar/kecil & spasi diabaikan).
-- Yang disimpan: id master asli (seed_products_full.sql) > yang punya foto > yang pertama.
-- Transaksi Kasir & harga Gojek/Grab yang nempel di produk kembar dipindah ke yang disimpan dulu,
-- jadi riwayat tidak hilang.

-- 0) Lihat dulu apa saja yang kembar (opsional, jalankan baris ini sendiri):
-- select name, coalesce(nullif(variant,''),'Standar') v, count(*) from public.products group by 1,2 having count(*) > 1;

-- Satu statement saja (tanpa tabel bantu): SQL Editor Supabase gagal baca tabel bantu antar statement.
-- Urutan di dalamnya: pindah transaksi Kasir & harga Gojek/Grab ke produk yang disimpan, baru hapus yang dobel.
with master(id) as (values
    ('04218917-4393-4662-91c8-5962d2e28405'), ('05a2bd3d-6315-4fb4-8e45-f9f3ec142606'), ('0b7102f0-3d20-4efc-aef0-5e1def720543'),
    ('13153e38-b01a-45de-9ce6-e60ae2c00867'), ('145195c3-068a-45a4-b033-6e12e15cd548'), ('183e960a-c8f2-41c4-9dc2-50f4f40cf33c'),
    ('1c51fd75-9d4a-4bb7-a825-d1231ad149eb'), ('1ed27644-f187-464c-84b7-761e34b99191'), ('1f4d5051-22a0-4a7c-8c1b-9e1c290d5ca1'),
    ('1f4f188c-680b-4e01-8703-98489a039730'), ('1fc5141f-19c2-4527-a26b-7ba42995c5a9'), ('20cb696d-3d29-41e2-94de-8ad6628cc489'),
    ('210ea332-f496-4e4c-96e4-a56f1cf6a3b6'), ('21117977-2db3-4619-b67a-906fef4ecbf2'), ('24ccfdaf-cfcb-4297-82ae-5deec77bc27d'),
    ('2c9ab654-31fa-47e9-bb3b-5258616ea7f5'), ('353e0997-bae3-4484-a74f-21423aa5758e'), ('3d21584b-b59a-4fb1-b853-bc745d76c5fd'),
    ('43180b69-4dfe-47f2-a4a4-4dd10b00d4c7'), ('482eb95c-ee92-47b8-97f4-63a15e6f8d2f'), ('5867b52f-d0ae-45ad-aca1-9ada65073297'),
    ('5e1cb61d-7cb1-49d1-a337-4260b6e5b8ab'), ('6063fe1c-f65a-48bf-a395-217430b89d12'), ('65fe6ecf-831b-48b9-82a4-35b401a8047a'),
    ('67372f28-5527-4d32-988b-3940ac884529'), ('69b16af8-bdc6-416e-aea0-f25dec38f4b0'), ('6a59fd5d-9979-4aa7-9ab6-9c424a9a9313'),
    ('6bfa7aa4-a46b-48f9-8729-6f0759aa01ce'), ('6d0d5b6c-0671-4afe-a701-0b3829d2dfff'), ('785279ff-5118-4982-9fb2-404567699031'),
    ('78a29bfb-66e4-4f7f-938c-e224be025bfd'), ('7cc8d0d8-f811-4540-a709-9c4be8f7ccb8'), ('80aa9b88-aca1-4729-8b3c-09905385afb5'),
    ('81a51c15-4e55-45f5-8c6a-51e54086a14f'), ('828b1d99-4c43-4529-9dc3-f70ab51b76ed'), ('8688ad27-b2d8-4db3-9659-7f447ff4593c'),
    ('87711c01-6af9-41db-9b3f-68183741d65d'), ('8b2707d4-2f8b-4db2-beaf-1b1c6aeed186'), ('90ba0ca2-a764-4676-9ee2-5341b7e94bcb'),
    ('917bf967-28f4-4f18-9e2b-f50259227006'), ('95696b73-bea2-4171-8cba-ee47bb0ccb84'), ('95904513-e42f-4809-be83-f82bc033db31'),
    ('9dbc3a46-71bf-4cdd-b6b0-b303e9b1f683'), ('a43ed3d1-6392-4d9c-86bc-ff3466cc822c'), ('a7015934-a200-4827-a0bf-cff917d2772d'),
    ('b1311f6a-4dfb-4569-8441-dbf4a4b40304'), ('b1d4bfad-8443-4929-8667-75ad73fd30d3'), ('b43a2eb0-42fa-468c-b903-cc72957ca876'),
    ('b505a1f7-566e-4883-8db3-d2e06411051e'), ('b5f861c3-34c6-4855-a04e-2de038e5bf31'), ('b6e7bf3f-c461-4299-b94f-4ea6c57a2628'),
    ('b81e9014-e614-4b27-aefe-7d766ddf03eb'), ('bf2d69d9-c886-4009-a4fb-d89715e56cd5'), ('c57849b1-7691-43d1-b19c-782b5c07149f'),
    ('c774c0db-4f81-44fd-95df-51dbc6265b6a'), ('c985519a-a0ef-43d0-bc9c-507a5c138a0d'), ('c9c2884b-a092-4c77-9810-f939ff5f5679'),
    ('ca934a8f-f897-4bd9-9ff1-11762bd6e07c'), ('cd8d05c0-a754-4dbb-9910-2a0fa7863b5f'), ('cdfca8db-0193-49c9-8dd7-a5b34d74e166'),
    ('d68adc5f-a674-418b-b73f-4ffdfb591548'), ('d6eda8b6-e189-4b87-a327-332412a3e5ec'), ('dfbaa937-c42d-4e51-bdc9-5a331422a358'),
    ('dffd6e70-b196-4754-a6fe-0b3b6294714c'), ('e1d86677-3274-4689-8c15-62818e4f4d31'), ('e304a98e-05f8-45fa-b966-cec11cdb0fed'),
    ('e62d2414-a552-4805-b5fb-c9d6685396e7'), ('e9ac0bac-e6e1-4f8e-aef0-3d7804877783'), ('f85a5fd7-c7fd-4004-b7c1-22204d8b79fd'),
    ('fddaa6e1-e777-4271-a31c-43647882908f'), ('fe8885a3-04d2-4c1c-8bdb-555c3dc5a7c2')
),
ranked as (
  select p.id,
    first_value(p.id) over w as keep_id,
    row_number() over w as rn
  from public.products p
  left join master m on m.id = p.id::text
  window w as (
    partition by lower(trim(p.name)), lower(coalesce(nullif(trim(p.variant), ''), 'Standar'))
    order by (m.id is not null) desc, (p.image_url is not null) desc, p.display_order nulls last, p.id
  )
),
dup as (select id, keep_id from ranked where rn > 1),
moved_items as (
  update public.order_items oi set product_id = d.keep_id from dup d where oi.product_id = d.id returning 1
),
moved_prices as (
  insert into public.product_channel_prices (product_id, channel, price)
  select d.keep_id, cp.channel, cp.price
  from public.product_channel_prices cp join dup d on d.id = cp.product_id
  on conflict (product_id, channel) do nothing returning 1
)
delete from public.products where id in (select id from dup);

-- Bahan/operasional kembar (nama sama) — simpan yang paling awal dibuat.
delete from public.operational_items o
using public.operational_items k
where lower(trim(o.name)) = lower(trim(k.name))
  and (k.created_at, k.id) < (o.created_at, o.id);


-- Cek: harus kosong semua.
select 'products' as tabel, name, coalesce(nullif(variant,''),'Standar') as varian, count(*)
from public.products group by 2, 3 having count(*) > 1
union all
select 'operational_items', name, '-', count(*)
from public.operational_items group by 2 having count(*) > 1;

-- Refresh cache kolom supaya app langsung kenal kolom baru (paid_amount, report_date).
notify pgrst, 'reload schema';
