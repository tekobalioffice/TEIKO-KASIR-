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
