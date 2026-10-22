// Seed data awal ke Supabase (dev/baru, bukan produksi): 1 admin, 1 outlet, produk contoh.
// Jalankan: node scripts/seed-dev.mjs <email-akun-admin> <password>
// Akun itu harus sudah ada di Supabase Auth (Dashboard > Authentication > Users > Add user,
// toggle Auto Confirm User), RLS di sini mengizinkan authenticated saja, jadi tidak bisa
// pakai anon key polos.
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });

const [, , email, password] = process.argv;
if (!email || !password) {
  console.log('Pakai: node scripts/seed-dev.mjs <email> <password>');
  process.exit(1);
}

const supa = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

const { data: auth, error: authErr } = await supa.auth.signInWithPassword({ email, password });
if (authErr) { console.log('LOGIN ERROR:', authErr.message); process.exit(1); }
const uid = auth.user.id;
console.log('logged in as', uid);

const { error: userErr } = await supa.from('users').upsert([{
  id: uid, name: 'Admin Teiko', role: 'admin', branch: null, username: 'admin', email,
}]);
console.log('users:', userErr ? userErr.message : 'ok');

// outlets.name tidak unique di schema.sql, jadi cek dulu biar tidak dobel kalau script dijalankan ulang.
const { data: existingOutlet } = await supa.from('outlets').select('id').eq('name', 'Pusat').maybeSingle();
if (!existingOutlet) {
  const { error: outletErr } = await supa.from('outlets').insert([{
    name: 'Pusat', address: 'Jalan Contoh No. 1', allow_inventory_edit: true,
  }]);
  console.log('outlets:', outletErr ? outletErr.message : 'ok');
} else {
  console.log('outlets: sudah ada, dilewati');
}

const products = [
  { name: 'Choco Oreo', category: 'Sachet Series', variant: 'Ori', price: 5000, display_order: 1, is_unlimited: false },
  { name: 'GD Capucinno', category: 'Sachet Series', variant: 'Ori', price: 6000, display_order: 2, is_unlimited: false },
  { name: 'NS Lemon', category: 'Sachet Series', variant: 'Premi', price: 8000, display_order: 3, susu_add_price: 3000 },
  { name: 'Es Teh', category: 'Hot Series', variant: 'Standar', price: 0, display_order: 4, is_unlimited: true },
];
const { error: prodErr } = await supa.from('products').insert(products);
console.log('products:', prodErr ? prodErr.message : `ok (${products.length})`);

const invRows = products.filter(p => !p.is_unlimited).map(p => ({
  branch_name: 'Pusat',
  item_name: p.variant && p.variant !== 'Standar' ? `${p.name} ${p.variant}` : p.name,
  display_qty: 20, safety_qty: 0, tambah_qty: 0,
}));
const { error: invErr } = await supa.from('branch_inventory').insert(invRows);
console.log('branch_inventory:', invErr ? invErr.message : `ok (${invRows.length})`);

console.log('DONE');
