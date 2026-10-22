-- Pengaturan struk (ukuran kertas printer + teks header/footer).
-- Satu baris saja (singleton) — trik id boolean primary key default true
-- mencegah baris kedua tanpa app logic tambahan.
create table public.app_settings (
  id boolean primary key default true,
  check (id),
  receipt_width_mm integer not null default 58, -- 58 atau 80
  receipt_header_text text not null default 'TEIKO',
  receipt_footer_text text not null default 'Terima kasih'
);

insert into public.app_settings (id) values (true);

alter table public.app_settings enable row level security;
drop policy if exists "auth all app_settings" on public.app_settings;
create policy "auth all app_settings" on public.app_settings for all to authenticated using (true) with check (true);
