-- ============================================================================
-- current_qty = display_qty + safety_qty  (SELALU, dipaksa trigger)
-- ============================================================================
-- current_qty adalah nilai TURUNAN. Trigger ini menghitung ulang di SETIAP
-- insert/update, jadi tidak peduli jalur kodenya -- tidak bisa "drift" lagi.
--
-- JALANKAN DI: Supabase Dashboard > SQL Editor, saat app tidak sedang dipakai.
-- Kalau error "40P01 deadlock" atau "lock_timeout" -> tunggu, Run lagi (transient).
-- Jalankan BAGIAN 1 dulu sampai sukses, baru BAGIAN 2.
-- ============================================================================

-- ---------- BAGIAN 1: fungsi + trigger ----------
set lock_timeout = '10s';

create or replace function public.sync_current_qty()
returns trigger
language plpgsql
as $$
begin
  new.current_qty := coalesce(new.display_qty, 0) + coalesce(new.safety_qty, 0);
  return new;
end
$$;

drop trigger if exists trg_sync_current_qty on public.branch_inventory;
create trigger trg_sync_current_qty
  before insert or update on public.branch_inventory
  for each row
  execute function public.sync_current_qty();

-- ---------- BAGIAN 2: repair data + verifikasi (jalankan setelah BAGIAN 1 sukses) ----------
-- update public.branch_inventory
-- set current_qty = coalesce(display_qty, 0) + coalesce(safety_qty, 0)
-- where current_qty is distinct from coalesce(display_qty, 0) + coalesce(safety_qty, 0);
--
-- select branch_name, item_name, display_qty, safety_qty, current_qty
-- from public.branch_inventory
-- where current_qty is distinct from coalesce(display_qty, 0) + coalesce(safety_qty, 0);
