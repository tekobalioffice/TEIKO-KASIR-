// ─── Parse & Format ──────────────────────────────────────────────────────────

export const parseQty = (val) => {
  if (val === undefined || val === null || val === '') return 0;
  let s = String(val).trim().replace(/,/g, '.');
  if (s.includes(' ')) {
    const parts = s.split(' ');
    if (parts.length === 2 && parts[1].includes('/')) {
      const whole = parseFloat(parts[0]) || 0;
      const fracParts = parts[1].split('/');
      if (fracParts.length === 2 && parseFloat(fracParts[1]) !== 0) {
        return whole + (parseFloat(fracParts[0]) / parseFloat(fracParts[1]));
      }
    }
  } else if (s.includes('/')) {
    const parts = s.split('/');
    if (parts.length === 2 && parseFloat(parts[1]) !== 0) {
      return parseFloat(parts[0]) / parseFloat(parts[1]);
    }
  }
  const parsed = parseFloat(s);
  return isNaN(parsed) ? NaN : parsed;
};

// Menjumlahkan/mengurangi ekspresi sederhana dari form kertas, mis. "4+8" -> 12, "20-3" -> 17.
// Blank -> null (artinya "jangan ubah"). Tak terbaca -> NaN. Tanpa operator -> parseQty biasa.
export const sumExpr = (val) => {
  if (val === undefined || val === null || String(val).trim() === '') return null;
  const s = String(val).trim();
  if (!/[+-]/.test(s.slice(1))) return parseQty(s); // abaikan tanda di posisi awal
  const parts = s.match(/[+-]?[^+-]+/g);
  if (!parts) return NaN;
  let total = 0;
  for (let part of parts) {
    part = part.trim();
    let sign = 1;
    if (part[0] === '+') part = part.slice(1).trim();
    else if (part[0] === '-') { sign = -1; part = part.slice(1).trim(); }
    const n = parseQty(part);
    if (isNaN(n)) return NaN;
    total += sign * n;
  }
  return total;
};

export const formatFraction = (val) => {
  if (val === undefined || val === null || val === '') return '';
  const num = parseFloat(val);
  if (isNaN(num)) return val;
  const whole = Math.floor(num);
  const frac = num - whole;
  const roundedFrac = Math.round(frac * 1000) / 1000;
  let fracStr = '';
  if (roundedFrac === 0.25) fracStr = '1/4';
  else if (roundedFrac === 0.5) fracStr = '2/4';
  else if (roundedFrac === 0.75) fracStr = '3/4';
  else if (roundedFrac === 0.2) fracStr = '1/5';
  else if (roundedFrac === 0.4) fracStr = '2/5';
  else if (roundedFrac === 0.6) fracStr = '3/5';
  else if (roundedFrac === 0.8) fracStr = '4/5';
  else if (Math.abs(roundedFrac - 0.333) < 0.01) fracStr = '1/3';
  else if (Math.abs(roundedFrac - 0.667) < 0.01) fracStr = '2/3';
  else if (roundedFrac > 0) return String(Math.round(num));
  if (whole > 0 && fracStr !== '') return `${whole} ${fracStr}`;
  if (whole === 0 && fracStr !== '') return fracStr;
  return String(whole);
};

// ─── Item Classification ──────────────────────────────────────────────────────

export const isAutoCalculatedItem = (itemName) => {
  if (!itemName) return false;
  const n = String(itemName).trim().toLowerCase();
  return n.startsWith('es teh') || n.startsWith('teh tarik') ||
         n.startsWith('full cream') || n.startsWith('milk tea');
};

// ─── Stock Key Helpers (BranchPOS) ───────────────────────────────────────────

export const STOCK_KEY_MAP = {
  'Hot Americano': 'Espresso (Hot)',
  'Milk Tea': 'Gula Milk Tea',
  'Matcha Oat Latte': 'Matcha',
};

export const getStockKey = (prod) => {
  if (STOCK_KEY_MAP[prod.name]) {
    const mapped = STOCK_KEY_MAP[prod.name];
    if (prod.variant && prod.variant !== 'Standar') return `${mapped} ${prod.variant}`;
    return mapped;
  }
  if (prod.variant && prod.variant !== 'Standar') return `${prod.name} ${prod.variant}`;
  return prod.name;
};

export const getDetailKey = (p) =>
  (p.variant && p.variant !== 'Standar' ? `${p.name} ${p.variant}` : p.name);

// ─── Domain Constants ─────────────────────────────────────────────────────────

export const CUP_SUBTRACTOR_DRINKS = [
  'Milo', 'Beng-Beng', 'GD Cappuccino', 'GD Capucinno', 'Extra Joss Susu',
  'NS Jeruk', 'NS Jeruk Nipis', 'NS Lemon', 'NS Leci', 'Dancow Cokelat',
  'Dancow Putih', 'Es Coklat', 'Matcha Oat Latte', 'Full Cream', 'Belgian Choco', 'Belgian Chocolate',
  'Ice Americano', 'Americano', 'Coffee Cream', 'Coffe Cream', 'Teh Tarik',
  'Thai Tea', 'Tehspresso', 'Ice Roast', 'Kopi Bali', 'Teh Serai', 'Teh Jahe',
  'Teh Matcha Latte', 'Milk Tea', 'Gula Milk Tea', 'Green Thai Tea Ori',
  'Green Thai Tea Premi',
];

export const BUBBLE_PORSI_MAP = {
  'Bubble Besar': 20,
  'Bubble Kecil': 10,
};

export const getBubblePorsi = (prodName, bungkusKeluar) => {
  const key = Object.keys(BUBBLE_PORSI_MAP).find(k =>
    prodName && prodName.toLowerCase().includes(k.toLowerCase())
  );
  if (!key) return null;
  return Math.round(bungkusKeluar * BUBBLE_PORSI_MAP[key]);
};

// Batas waktu log Oper/ACC Porsi Bubble yang BELUM ke-bake di porsi_sisa laporan `report`.
// Pakai closed_at di meta laporan itu sendiri — ditulis bareng laporan (atomik), jadi ga
// bergantung marker "Tutup Shift" terpisah yang bisa hilang kalau sinyal putus (PDK 28 Sep:
// operan -5 kehitung dua kali). Laporan lama tanpa closed_at: fallback marker terakhir.
export const getPorsiWindowStart = async (supabase, branchName, report) => {
  const closedAt = (report?.details || []).find(d => d._is_meta && d.closed_at)?.closed_at;
  if (closedAt) return closedAt;
  const { data } = await supabase.from('stock_restock_log').select('created_at')
    .eq('branch_name', branchName).eq('item_name', 'Status Aktivitas')
    .ilike('petugas_name', '%Tutup Shift%').order('created_at', { ascending: false }).limit(1);
  return data?.[0]?.created_at || null;
};
