/**
 * ============================================================================
 * PENJELASAN UMUM MODUL EKSPOR EXCEL (exportExcel.js)
 * ============================================================================
 * File utilitas ini bertanggung jawab penuh untuk menghasilkan laporan Excel (*.xlsx)
 * secara dinamis dengan desain profesional (menggunakan pustaka xlsx-js-style).
 * 
 * Laporan yang dihasilkan mencakup:
 * 1. Rekap Penjualan (Shift 1, Shift 2, ataupun Gabungan).
 * 2. Kartu Stok Barang / FORM STOK BARANG (laporan Awal, Tambah, Penjualan, Sisa, dan Stok Akhir).
 * 3. Laporan Selisih / Waste (perbandingan pemakaian bahan secara fisik vs teoritis struk).
 * 4. Riwayat Aktivitas Stok (log audit semua perubahan stok).
 * ============================================================================
 */
import { pindahByItem } from './pindahLogs';
import * as XLSX from 'xlsx-js-style';
import { format, parseISO } from 'date-fns';
import { id } from 'date-fns/locale';
import { sumExpr, formatFraction, parseQty as parseQtyStr, CUP_SUBTRACTOR_DRINKS } from './stockUtils';

const PENJUALAN_NAMES = {
  // Left Column (Row 13-36 => Index 0-23; Beng-Beng 1 baris biar GD Capucinno sejajar Taro)
  'Es Teh': { col: 1, row: 13, name: 'Es Teh' },
  'Milo': { col: 1, row: 15, name: 'Milo' },
  'Beng-Beng': { col: 1, row: 17, name: 'Beng-Beng' },
  'GD Capucinno': { col: 1, row: 18, name: 'GD Capucinno' },
  'Extra Joss Susu': { col: 1, row: 19, name: 'Extra Joss Susu' },
  'NS Jeruk': { col: 1, row: 20, name: 'NS Jeruk' },
  'NS Jeruk Nipis': { col: 1, row: 21, name: 'NS Jeruk Nipis' },
  'NS Lemon': { col: 1, row: 22, name: 'NS Lemon' },
  'NS Leci': { col: 1, row: 23, name: 'NS Leci' },
  'Dancow Cokelat': { col: 1, row: 24, name: 'Dancow coklat' },
  'Dancow coklat': { col: 1, row: 24, name: 'Dancow coklat' },
  'Dancow Putih': { col: 1, row: 25, name: 'Dancow putih' },
  'Dancow putih': { col: 1, row: 25, name: 'Dancow putih' },
  'Teh Madu Hutan': { col: 1, row: 26, name: 'Teh Madu Hutan' },
  'Madu Hutan': { col: 1, row: 26, name: 'Teh Madu Hutan' },
  'Es Coklat': { col: 1, row: 27, name: 'Es Coklat' },
  'Tehspresso': { col: 1, row: 28, name: 'Tehspresso' },
  'Teh Tarik': { col: 1, row: 29, name: 'Teh Tarik' },
  'Milk Tea': { col: 1, row: 30, name: 'Milk Tea' },
  'Thai Tea': { col: 1, row: 31, name: 'Thai Tea' },
  'Green Thai Tea': { col: 1, row: 32, name: 'Green Thai Tea' },
  'Matcha Oat Latte': { col: 1, row: 33, name: 'Matcha Oat Latte' },
  'Full Cream': { col: 1, row: 34, name: 'full cream' },
  'full cream': { col: 1, row: 34, name: 'full cream' },
  'Belgian Chocolate': { col: 1, row: 35, name: 'Belgian Chocolate' },
  'Belgian Choco': { col: 1, row: 35, name: 'Belgian Chocolate' },

  // Right Column
  'Strawberry': { col: 3, row: 13, name: 'Strawberry' },
  'TeiKo Strawberry': { col: 3, row: 13, name: 'Strawberry' },
  'Melon': { col: 3, row: 14, name: 'Melon' },
  'Avocado': { col: 3, row: 15, name: 'Alpukat' },
  'TeiKo Alpukat': { col: 3, row: 15, name: 'Alpukat' },
  'Green Tea': { col: 3, row: 16, name: 'Green Tea' },
  'Green Tea Latte': { col: 3, row: 16, name: 'Green Tea' },
  'Choco Oreo': { col: 3, row: 17, name: 'Choco Oreo' },
  'Taro': { col: 3, row: 18, name: 'Taro' },
  'Ice Americano': { col: 3, row: 19, name: 'Ice Americano' },
  'Hot Americano': { col: 3, row: 20, name: 'hot Americano' },
  'hot Americano': { col: 3, row: 20, name: 'hot Americano' },
  'Espresso (Hot)': { col: 3, row: 20, name: 'hot Americano' },
  'Kopi Bali': { col: 3, row: 21, name: 'Kopi Bali' },
  'Teh Serai': { col: 3, row: 22, name: 'Teh Serai' },
  'Teh Jahe': { col: 3, row: 23, name: 'Teh Jahe' },
  'Teh Matcha Latte': { col: 3, row: 24, name: 'Teh Matcha Latte' },
  'Coffe Cream': { col: 3, row: 25, name: 'Coffe Cream' },
  'Coffee Cream': { col: 3, row: 25, name: 'Coffe Cream' },
  'Brown Sugar': { col: 3, row: 26, name: 'Brown Sugar' },
  'Salted Caramel': { col: 3, row: 27, name: 'Salted Caramel' },
  'Hazelnut': { col: 3, row: 28, name: 'Hazelnut' },
  'TeiKo Hazelnut': { col: 3, row: 28, name: 'Hazelnut' },
  'Bubble': { col: 3, row: 29, name: 'Bubble' },
  'Bubble Besar': { col: 3, row: 29, name: 'Bubble' },
  'Bubble Kecil': { col: 3, row: 29, name: 'Bubble' },
  'Coffee Jelly': { col: 3, row: 30, name: 'Coffee Jelly' },
  'Rainbow Jelly': { col: 3, row: 31, name: 'Rainbow Jelly' },
  'Leci Jelly': { col: 3, row: 32, name: 'Leci Jelly' },
  'Pudding Coklat': { col: 3, row: 34, name: 'Pudding Coklat' },
  'Silky Pudding Choco': { col: 3, row: 34, name: 'Pudding Coklat' },
  'Pudding Vanilla': { col: 3, row: 35, name: 'Pudding Vanilla' },
  'Silky Pudding Vanilla': { col: 3, row: 35, name: 'Pudding Vanilla' },
  'Cao Jelly': { col: 3, row: 33, name: 'Cao Jelly' },
  'Kresek': { col: 3, row: 36, name: 'Kresek' },
};

const STOCK_ROWS = {
  // Left Column (Row 38 to 61)
  'Cup Oval 14oz (Ori)': { col: 1, row: 38 },
  'Cup Oval 16oz (Premi)': { col: 1, row: 39 },
  'Teh Panas 12oz (Hot)': { col: 1, row: 40 },
  'Lid Cup (Seal)': { col: 1, row: 41 },
  'Kresek': { col: 1, row: 42 },
  'Gula Cair': { col: 1, row: 43 },
  'Gula Milk Tea': { col: 1, row: 44 },
  'Gula Aren': { col: 1, row: 45 },
  'Fructose': { col: 1, row: 46 },
  'Madu Hutan': { col: 1, row: 47 },
  'SKM Carnation': { col: 1, row: 48 },
  'SKM Tiga Sapi': { col: 1, row: 49 },
  'Ultra Milk Besar': { col: 1, row: 50 },
  'Diamond Besar': { col: 1, row: 51 },
  'Diamond Kecil': { col: 1, row: 52 },
  'Oat Milk': { col: 1, row: 53 },
  'Evaporasi': { col: 1, row: 54 },
  'Yakult': { col: 1, row: 55 },
  'Air Putih': { col: 1, row: 56 },
  'Black Tea': { col: 1, row: 57 },
  'Serai': { col: 1, row: 58 },
  'Green Tea (Daun)': { col: 1, row: 59 },
  'Biji Kopi': { col: 1, row: 61 },

  // Right Column (Row 38 to 58)
  'Jahe': { col: 3, row: 38 },
  'Oreo': { col: 3, row: 39 },
  'Sirup Strawberry': { col: 3, row: 40 },
  'Sirup Melon': { col: 3, row: 41 },
  'Sirup Hazelnut': { col: 3, row: 42 },
  'Sirup Salted': { col: 3, row: 43 },
  'Sirup Avocado': { col: 3, row: 44 },
  'Sirup Leci': { col: 3, row: 45 },
  'Bubuk Coklat': { col: 3, row: 46 },
  'Bubuk Taro': { col: 3, row: 47 },
  'Bubuk Green Tea': { col: 3, row: 48 },
  'Thai Tea': { col: 3, row: 49 },
  'Green Thai Tea': { col: 3, row: 50 },
  'Matcha Latte': { col: 3, row: 51 },
  'Coffe Cream': { col: 3, row: 52 },
  'Coffee Cream': { col: 3, row: 52 },
  'Belgian Chocolate': { col: 3, row: 53 },
  'Belgian Choco': { col: 3, row: 53 },
  'Dancow Coklat': { col: 3, row: 54 },
  'Dancow Putih': { col: 3, row: 55 },
  'Milo': { col: 3, row: 56 },
  'NutriSari': { col: 3, row: 57 },
  'Sedotan Kecil': { col: 3, row: 58 },
  'Sedotan Besar': { col: 3, row: 59 },
};

// Lookup case-insensitive buat dictionary nama produk (PENJUALAN_NAMES/STOCK_KEY_MAP).
// Staff kadang ngetik nama beda kapitalisasi ("milo" bukan "Milo") pas bikin Master Produk,
// tapi dictionary mapping-nya fixed-case — tanpa ini produk jatuh ke "unmapped" padahal
// sebenarnya sudah ada posisi/remap-nya.
const lookupCI = (dict, key) => {
  if (key == null) return undefined;
  if (Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
  const lowerKey = key.toLowerCase();
  const foundKey = Object.keys(dict).find(k => k.toLowerCase() === lowerKey);
  return foundKey !== undefined ? dict[foundKey] : undefined;
};

// Urutan produk baku (dipakai Kartu Stok & Surat Jalan) — dipetakan sesuai form kertas outlet.
const EXCEL_ORDER = [
  "Gula 1", "Gula 2", "Premium Tea 1", "Premium 2", "Paper Cup", "Cup (Flat)", "Milo", "Beng-Beng", "GD Capucinno",
  "Extra Joss Susu", "NS Jeruk", "NS Jeruk Nipis", "NS Lemon", "NS Leci", "Dancow Cokelat", "Dancow Putih",
  "Madu Hutan", "Es Coklat", "Ice Roast", "Black Tea", "Gula Milk Tea", "Thai Tea", "Green Thai Tea", "Matcha Oat Latte",
  "Diamond BC", "Diamond Besar", "Ultra Milk Besar", "OatMilk", "Belgian Choco", "Strawberry", "Melon",
  "Avocado", "Green Tea Latte", "Choco Oreo", "Taro", "Ice Americano", "Espresso (Hot)", "Kopi Bali", "Teh Serai", "Teh Jahe", "Coffee Cream",
  "Brown Sugar", "Salted Caramel", "Hazelnut", "Bubble Besar", "Bubble Kecil", "Coffee Jelly", "Rainbow Jelly", "Leci Jelly", "Cao Jelly", "Pudding Coklat",
  "Pudding Vanilla", "Susu Kental Manis", "Gula Cair", "Krim Cair", "Sedotan Kecil", "Sedotan Besar",
  "Sedotan Topping", "Tutup Manual", "Kresek", "Tisu Kering", "Tisu Basah", "Sealer", "Form Penjualan",
  "Form Stok", "QCP", "Kertas Thermal", "Teh Matcha Latte"
];

const rp = (n) => Number(n || 0).toLocaleString('id-ID');

export const formatFrac = (num) => {
  if (num === null || num === undefined || num === '-' || num === '') return '';
  const val = parseFloat(num);
  if (isNaN(val) || val === 0) return '0';
  const whole = Math.floor(val);
  const frac = val - whole;
  const roundedFrac = Math.round(frac * 1000) / 1000;
  let fracStr = '';
  if (roundedFrac === 0.25) fracStr = '1/4';
  else if (roundedFrac === 0.5) fracStr = '2/4';
  else if (roundedFrac === 0.75) fracStr = '3/4';
  else if (roundedFrac === 0.2) fracStr = '1/5';
  else if (roundedFrac === 0.4) fracStr = '2/5';
  else if (roundedFrac === 0.6) fracStr = '3/5';
  else if (roundedFrac === 0.8) fracStr = '4/5';
  else if (roundedFrac > 0) return String(val.toFixed(2));
  if (whole > 0 && fracStr !== '') return `${whole} ${fracStr}`;
  else if (whole === 0 && fracStr !== '') return fracStr;
  return String(whole);
};


const formatDate = (dateStr) => {
  if (!dateStr) return '';
  try {
    return format(parseISO(dateStr), 'dd MMMM yyyy', { locale: id });
  } catch {
    return dateStr;
  }
};

// Helper to check if date is valid
const isValidDate = (d) => d instanceof Date && !isNaN(d.getTime());

// Helper to trigger download in browser
const saveAs = (buffer, filename) => {
  try {
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("saveAs error:", err);
  }
};

// ============================================================================
// TEMPLATE STYLING EXCEL (xlsx-js-style)
// ============================================================================
// Semua border, perataan teks, warna latar belakang, dan warna font ditentukan di sini.

const BORDER_ALL = {
  top: { style: 'thin' },
  bottom: { style: 'thin' },
  left: { style: 'thin' },
  right: { style: 'thin' }
};

// Gaya untuk judul kolom tabel (Header) -> warna latar abu-abu muda & teks tebal rata tengah
const STYLE_HEADER = {
  fill: { fgColor: { rgb: "EFEFEF" } }, // Light gray
  font: { bold: true },
  border: BORDER_ALL,
  alignment: { horizontal: 'center', vertical: 'center' }
};

// Gaya untuk teks deskriptif (Nama Produk, Keterangan Aktivitas) -> Rata Kiri
const STYLE_LEFT = {
  border: BORDER_ALL,
  alignment: { horizontal: 'left', vertical: 'center' }
};

// Gaya standar untuk angka biasa (Ori) -> Rata Tengah
const STYLE_DEFAULT = {
  border: BORDER_ALL,
  alignment: { horizontal: 'center', vertical: 'center' }
};

// Gaya tebal untuk angka subtotal / Ori Sisa -> Rata Tengah Tebal
const STYLE_BOLD = {
  font: { bold: true },
  border: BORDER_ALL,
  alignment: { horizontal: 'center', vertical: 'center' }
};

// Gaya Biru untuk angka di kolom PREMI -> Rata Tengah Biru (#0000FF)
const STYLE_PREMI = {
  font: { color: { rgb: "0000FF" } },
  border: BORDER_ALL,
  alignment: { horizontal: 'center', vertical: 'center' }
};

// Gaya Biru Tebal untuk angka Sisa / Stok di kolom PREMI -> Rata Tengah Biru Tebal (#0000FF Bold)
const STYLE_PREMI_BOLD = {
  font: { bold: true, color: { rgb: "0000FF" } },
  border: BORDER_ALL,
  alignment: { horizontal: 'center', vertical: 'center' }
};

// Gaya Merah untuk angka Penjualan / Keluar -> Rata Tengah Merah (#FF0000)
const STYLE_RED = {
  font: { color: { rgb: "FF0000" } },
  border: BORDER_ALL,
  alignment: { horizontal: 'center', vertical: 'center' }
};

// Gaya Merah Tebal untuk STOK AKHIR -> Rata Tengah Merah Tebal (#FF0000 Bold)
const STYLE_RED_BOLD = {
  font: { bold: true, color: { rgb: "FF0000" } },
  border: BORDER_ALL,
  alignment: { horizontal: 'center', vertical: 'center' }
};

// Gaya Hijau untuk kolom Tambah yang berasal dari "Pindah ke Display" (stok gudang -> display)
const STYLE_ORANGE = {
  font: { bold: true, color: { rgb: "00B050" } },
  border: BORDER_ALL,
  alignment: { horizontal: 'center', vertical: 'center' }
};

/**
 * Fungsi internal pembantu untuk membangun susunan baris dan sel sheet Rekap Penjualan.
 * - Membagi produk ke dalam dua kolom (kiri & kanan) seperti format kasir.
 * - Menerapkan warna biru untuk varian Premi.
 */
const createSalesSheetData = (data, branchName, isConsolidated = false) => {
  const wsData = [];
  const shiftLabel = isConsolidated ? 'Gabungan' : `Shift ${data.shift || '-'}`;

  // Row 1
  wsData.push([
    { v: 'Outlet', s: STYLE_BOLD }, { v: branchName, s: STYLE_DEFAULT },
    { v: 'Jam Kerja', s: STYLE_BOLD }, { v: shiftLabel, s: STYLE_DEFAULT },
    { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT },
    { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }
  ]);

  // Row 2
  wsData.push([
    { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT },
    { v: 'Tanggal', s: STYLE_BOLD }, { v: formatDate(data.date), s: STYLE_DEFAULT },
    { v: 'Petugas', s: STYLE_BOLD }, { v: data.staffName || '-', s: STYLE_DEFAULT },
    { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }
  ]);

  // Row 3 (Spacer)
  wsData.push(Array(11).fill({ v: '', s: STYLE_DEFAULT }));

  // Row 4
  wsData.push([
    { v: 'No', s: STYLE_HEADER }, { v: 'Nama Produk', s: STYLE_HEADER },
    { v: 'Ori', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER },
    { v: 'Premi', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER },
    { v: 'Nama Produk', s: STYLE_HEADER },
    { v: 'Ori', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER },
    { v: 'Premi', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }
  ]);

  // Row 5
  wsData.push([
    { v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER },
    { v: 'Jumlah', s: STYLE_HEADER }, { v: 'Total', s: STYLE_HEADER },
    { v: 'Jumlah', s: STYLE_HEADER }, { v: 'Total', s: STYLE_HEADER },
    { v: '', s: STYLE_HEADER },
    { v: 'Jumlah', s: STYLE_HEADER }, { v: 'Total', s: STYLE_HEADER },
    { v: 'Jumlah', s: STYLE_HEADER }, { v: 'Total', s: STYLE_HEADER }
  ]);

  const leftItems = Array(24).fill(null);
  const rightItems = Array(24).fill(null);

  Object.keys(PENJUALAN_NAMES).forEach(dbName => {
    const mapInfo = PENJUALAN_NAMES[dbName];
    const item = {
      name: mapInfo.name,
      ori: { qty: 0, price: 0 },
      premi: { qty: 0, price: 0 },
      isMapped: true
    };
    if (mapInfo.col === 1) {
      leftItems[mapInfo.row - 13] = item;
    } else if (mapInfo.col === 3) {
      rightItems[mapInfo.row - 13] = item;
    }
  });

  (data.products || []).forEach(prod => {
    const pureName = prod.name.replace(/ Ori$/i, '').replace(/ Premi$/i, '').trim();
    const mapInfo = lookupCI(PENJUALAN_NAMES, pureName) || lookupCI(PENJUALAN_NAMES, prod.name);

    // Baris Bahan "Kresek" = pemakaian stok, bukan penjualan (yang dijual = produk Kresek).
    if (mapInfo?.name === 'Kresek' && prod.category === 'Bahan') return;

    if (mapInfo) {
      let variantStr = (prod.variant || 'Standar').toLowerCase();
      if (prod.name.toLowerCase().endsWith(' ori')) variantStr = 'ori';
      if (prod.name.toLowerCase().endsWith(' premi')) variantStr = 'premi';

      const targetKey = variantStr.includes('premi') ? 'premi' : 'ori';
      let targetList;
      if (mapInfo.col === 1) targetList = leftItems;
      else if (mapInfo.col === 3) targetList = rightItems;

      const idx = mapInfo.row - 13;
      if (targetList && targetList[idx]) {
        let addQty = parseInt(prod.qty) || 0;
        let addPrice = prod.price;

        if (prod.category === 'Bahan') {
          addQty = parseInt(prod.terjual_pure) || 0;
        }

        const pNameLower = (prod.name || '').toLowerCase();
        if (pNameLower.includes('bubble')) {
          addQty = parseInt(prod.porsi_terpakai) || 0;
          addPrice = parseInt(prod.price) || 2000;
        } else if (pNameLower.includes('jelly') || pNameLower.includes('pudding') || pNameLower.includes('cao')) {
          addQty = parseInt(prod.qty) || parseInt(prod.terjual_pure) || parseInt(prod.terjual_fisik) || 0;
          addPrice = parseInt(prod.price) || 2000;
        }

        targetList[idx][targetKey].qty += addQty;
        if (addPrice > 0) targetList[idx][targetKey].price = addPrice;
      }
    } else {
      // Dynamic unmapped products
      const pNameLower = (prod.name || '').toLowerCase();
      const isBubble = pNameLower.includes('bubble');
      const isOtherTopping = pNameLower.includes('jelly') || pNameLower.includes('pudding') || pNameLower.includes('cao');

      if (prod.category !== 'Bahan' || isBubble || isOtherTopping) {
        const isRightSide = prod.category === 'Topping' || prod.category === 'Lainnya' || isBubble || isOtherTopping;
        const uList = isRightSide ? rightItems : leftItems;

        let existing = uList.find(i => i && i.name === prod.name && i.isUnmapped);
        if (!existing) {
          existing = { name: prod.name, ori: { qty: 0, price: 0 }, premi: { qty: 0, price: 0 }, isMapped: true, isUnmapped: true };
          uList.push(existing);
        }

        const variant = (prod.variant || 'Standar').toLowerCase();
        const tKey = variant.includes('premi') ? 'premi' : 'ori';

        let aQty = parseInt(prod.qty) || 0;
        let aPrice = parseFloat(prod.price) || 0;

        if (isBubble) {
          aQty = parseInt(prod.porsi_terpakai) || 0;
          aPrice = parseInt(prod.price) || 2000;
        } else if (isOtherTopping) {
          aQty = parseInt(prod.qty) || parseInt(prod.terjual_pure) || parseInt(prod.terjual_fisik) || 0;
          aPrice = parseInt(prod.price) || 2000;
        }

        existing[tKey].qty += aQty;
        if (aPrice > 0) existing[tKey].price = aPrice;
      }
    }
  });

  // Calculate total Tambahan Susu
  let totalSusuQty = 0;
  let susuPrice = 0;
  (data.products || []).forEach(prod => {
    if (prod.is_dual_base && parseInt(prod.susu_qty) > 0) {
      totalSusuQty += parseInt(prod.susu_qty);
      susuPrice = parseInt(prod.susu_add_price) || 2000;
    }
  });

  if (totalSusuQty > 0) {
    let existingSusu = rightItems.find(i => i && i.name === 'Tambahan Susu');
    if (!existingSusu) {
      existingSusu = { name: 'Tambahan Susu', ori: { qty: 0, price: 0 }, premi: { qty: 0, price: 0 }, isMapped: true, isUnmapped: true };
      rightItems.push(existingSusu);
    }
    existingSusu.ori.qty += totalSusuQty;
    existingSusu.ori.price = susuPrice;
  }

  let totalCupsOri = 0;
  let totalCupsPremi = 0;
  let paperCups = 0;
  let totalSalesRp = 0;

  const customMerges = [];

  let leftNo = 1;
  const maxRows = Math.max(leftItems.length, rightItems.length, 24);

  for (let i = 0; i < maxRows; i++) {
    const left = leftItems[i];
    const right = rightItems[i];
    const row = [];

    // Left Side
    if (left && left.isMapped) {
      row.push({ v: leftNo++, s: STYLE_DEFAULT });
      row.push({ v: left.name, s: STYLE_LEFT });

      const lOri = left.ori.qty;
      const lOriP = left.ori.price * lOri;
      const lPremi = left.premi.qty;
      const lPremiP = left.premi.price * lPremi;

      row.push({ v: lOri > 0 ? lOri : '', s: STYLE_RED });
      row.push({ v: lOriP > 0 ? rp(lOriP) : '', s: STYLE_RED });
      row.push({ v: lPremi > 0 ? lPremi : '', s: STYLE_RED });
      row.push({ v: lPremiP > 0 ? rp(lPremiP) : '', s: STYLE_RED });

      if (left.name === 'Es Teh' || left.name === 'Milo') {
        // Vertical merge for columns A to F (col 0 to 5)
        for (let c = 0; c <= 5; c++) {
          customMerges.push({ s: { r: i + 5, c: c }, e: { r: i + 6, c: c } });
        }
      }

      if (left.name !== 'Teh Madu Hutan') {
        totalCupsOri += lOri;
        totalCupsPremi += lPremi;
      }
      totalSalesRp += (lOriP + lPremiP);
    } else {
      row.push({ v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT });
    }

    // Right Side
    if (right && right.isMapped) {
      row.push({ v: right.name, s: STYLE_LEFT });

      const rOri = right.ori.qty;
      const rOriP = right.ori.price * rOri;
      row.push({ v: rOri > 0 ? rOri : '', s: STYLE_RED }); row.push({ v: rOriP > 0 ? rp(rOriP) : '', s: STYLE_RED });

      const rPremi = right.premi.qty;
      const rPremiP = right.premi.price * rPremi;
      row.push({ v: rPremi > 0 ? rPremi : '', s: STYLE_RED }); row.push({ v: rPremiP > 0 ? rp(rPremiP) : '', s: STYLE_RED });

      const toppings = ['Bubble', 'Coffee Jelly', 'Rainbow Jelly', 'Leci Jelly', 'Pudding Coklat', 'Pudding Vanilla', 'Strawberry', 'Melon', 'Alpukat', 'Green Tea', 'Choco Oreo', 'Taro', 'Teh Matcha Latte', 'Brown Sugar', 'Salted Caramel', 'Hazelnut', 'Kresek'];

      const rightLower = (right.name || '').toLowerCase();
      const isDynamicTopping = rightLower.includes('bubble') || rightLower.includes('jelly') || rightLower.includes('pudding') || rightLower.includes('cao');

      const PAPER_CUP_DRINKS = ['Kopi Bali', 'Teh Serai', 'Teh Jahe', 'Teh Matcha Latte'];

      if (PAPER_CUP_DRINKS.includes(right.name)) {
        paperCups += rOri + rPremi;
      } else if (!toppings.includes(right.name) && right.name !== 'hot Americano' && !isDynamicTopping) {
        totalCupsOri += rOri;
        totalCupsPremi += rPremi;
      }
      totalSalesRp += (rOriP + rPremiP);
    } else {
      row.push({ v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT });
    }

    wsData.push(row);
  }

  // Row 29, 30: Spacers
  wsData.push(Array(11).fill({ v: '', s: STYLE_DEFAULT }));
  wsData.push(Array(11).fill({ v: '', s: STYLE_DEFAULT }));

  // Process Expenses
  let totalExpenses = 0;
  const expenseRows = [];
  (data.expenses || []).forEach(exp => {
    const amount = parseInt(exp.amount) || 0;
    if (amount > 0) {
      totalExpenses += amount;
      expenseRows.push([exp.name, amount]);
    }
  });

  const cashAwal = parseInt(data.cashAwal) || 0;
  const gojekTotal = 0;

  wsData.push([
    { v: 'TOTAL', s: STYLE_BOLD }, { v: '', s: STYLE_DEFAULT },
    { v: rp(totalSalesRp), s: STYLE_BOLD }, { v: '', s: STYLE_DEFAULT },
    { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT },
    { v: `Cash Awal : ${rp(cashAwal)}`, s: STYLE_BOLD },
    { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }
  ]);

  wsData.push([
    { v: 'PENGELUARAN', s: STYLE_BOLD }, { v: '', s: STYLE_DEFAULT },
    { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT },
    { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT },
    { v: 'TOTAL CUP', s: STYLE_BOLD },
    { v: '', s: STYLE_DEFAULT },
    { v: '', s: STYLE_DEFAULT },
    { v: 'TTD', s: STYLE_BOLD }, { v: '', s: STYLE_DEFAULT }
  ]);

  // Setoran yang diinput staff saat Tutup Shift vs Total Penjualan sheet ini.
  const setoran = (data.setoranAktual === undefined || data.setoranAktual === null || data.setoranAktual === '')
    ? null : (parseInt(String(data.setoranAktual).replace(/\D/g, '')) || 0);
  const expenseCount = Math.max(expenseRows.length, setoran !== null ? 5 : 4);
  for (let e = 0; e < expenseCount; e++) {
    const expRow = [];
    if (e < expenseRows.length) {
      expRow.push({ v: expenseRows[e][0], s: STYLE_DEFAULT });
      expRow.push({ v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT });
      expRow.push({ v: rp(expenseRows[e][1]), s: STYLE_RED });
    } else {
      expRow.push({ v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT });
    }

    if (e === 0) {
      expRow.push({ v: `Ori : ${totalCupsOri}${paperCups > 0 ? ` + ${paperCups}` : ''}`, s: STYLE_BOLD });
      expRow.push({ v: `Premi: ${totalCupsPremi}`, s: STYLE_BOLD });
      expRow.push({ v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT });
    } else if (e === 1) {
      expRow.push({ v: 'Total Pemasukan', s: STYLE_BOLD });
      expRow.push({ v: rp(totalSalesRp), s: STYLE_BOLD });
      expRow.push({ v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT });
    } else if (e === 2) {
      expRow.push({ v: 'Total Pengeluaran', s: STYLE_BOLD });
      expRow.push({ v: rp(totalExpenses), s: STYLE_RED_BOLD });
      expRow.push({ v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT });
    } else if (e === 3) {
      expRow.push({ v: 'Total Penjualan', s: STYLE_BOLD });
      expRow.push({ v: rp(totalSalesRp - totalExpenses), s: STYLE_RED_BOLD });
      expRow.push({ v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT });
    } else if (e === 4 && setoran !== null) {
      const diff = setoran - (totalSalesRp - totalExpenses);
      expRow.push({ v: 'Input Hasil Penjualan', s: STYLE_BOLD });
      expRow.push({ v: rp(setoran), s: STYLE_BOLD });
      expRow.push(diff > 0 ? { v: `Plus ${rp(diff)}`, s: STYLE_ORANGE }
        : diff < 0 ? { v: `Minus ${rp(-diff)}`, s: STYLE_RED_BOLD }
        : { v: 'Balance', s: STYLE_BOLD });
      expRow.push({ v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT });
    } else {
      expRow.push({ v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT });
    }
    wsData.push(expRow);
  }

  wsData.push([
    { v: 'TOTAL', s: STYLE_BOLD }, { v: '', s: STYLE_DEFAULT },
    { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT },
    { v: rp(totalExpenses), s: STYLE_RED_BOLD },
    { v: '', s: STYLE_DEFAULT },
    { v: '', s: STYLE_DEFAULT },
    { v: '', s: STYLE_DEFAULT },
    { v: gojekTotal, s: STYLE_DEFAULT },
    { v: 'Grab/Gojek', s: STYLE_DEFAULT }
  ]);

  wsData.push(Array(11).fill({ v: '', s: STYLE_DEFAULT }));
  wsData.push([
    { v: 'NOTE :', s: { font: { bold: true, italic: true }, border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } } } },
    { v: data.note || '', s: { font: { italic: true }, border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } } } },
    { v: '', s: { border: { top: { style: 'thin' }, bottom: { style: 'thin' } } } },
    { v: '', s: { border: { top: { style: 'thin' }, bottom: { style: 'thin' } } } },
    { v: '', s: { border: { top: { style: 'thin' }, bottom: { style: 'thin' } } } },
    { v: '', s: { border: { top: { style: 'thin' }, bottom: { style: 'thin' } } } },
    { v: '', s: { border: { top: { style: 'thin' }, bottom: { style: 'thin' } } } },
    { v: '', s: { border: { top: { style: 'thin' }, bottom: { style: 'thin' } } } },
    { v: '', s: { border: { top: { style: 'thin' }, bottom: { style: 'thin' } } } },
    { v: '', s: { border: { top: { style: 'thin' }, bottom: { style: 'thin' } } } },
    { v: '', s: { border: { top: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } } } }
  ]);
  customMerges.push({ s: { r: wsData.length - 1, c: 1 }, e: { r: wsData.length - 1, c: 10 } });

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  const merges = [
    { s: { r: 3, c: 0 }, e: { r: 4, c: 0 } },
    { s: { r: 3, c: 1 }, e: { r: 4, c: 1 } },
    { s: { r: 3, c: 2 }, e: { r: 3, c: 3 } },
    { s: { r: 3, c: 4 }, e: { r: 3, c: 5 } },
    { s: { r: 3, c: 6 }, e: { r: 4, c: 6 } },
    { s: { r: 3, c: 7 }, e: { r: 3, c: 8 } },
    { s: { r: 3, c: 9 }, e: { r: 3, c: 10 } },
    ...customMerges
  ];

  const lastRow = wsData.length - 1;
  const baseOffset = Math.max(expenseCount, 3);

  merges.push({ s: { r: lastRow - baseOffset - 1, c: 2 }, e: { r: lastRow - baseOffset - 1, c: 3 } });
  merges.push({ s: { r: lastRow - baseOffset - 1, c: 6 }, e: { r: lastRow - baseOffset - 1, c: 10 } });
  merges.push({ s: { r: lastRow - baseOffset, c: 0 }, e: { r: lastRow - baseOffset, c: 4 } });

  for (let i = 0; i < expenseCount; i++) {
    merges.push({ s: { r: lastRow - baseOffset + 1 + i, c: 0 }, e: { r: lastRow - baseOffset + 1 + i, c: 4 } });
  }

  merges.push({ s: { r: lastRow, c: 0 }, e: { r: lastRow, c: 4 } });

  ws['!merges'] = merges;
  ws['!cols'] = [
    { wch: 5 }, { wch: 22 }, { wch: 7 }, { wch: 10 }, { wch: 7 }, { wch: 10 },
    { wch: 25 }, { wch: 7 }, { wch: 10 }, { wch: 7 }, { wch: 10 }
  ];

  return ws;
};

/**
 * ============================================================================
 * PEMBUATAN SHEET: FORM STOK BARANG / KARTU STOK
 * ============================================================================
 * Fungsi utama untuk menghasilkan tabel "FORM STOK BARANG" pada Excel:
 * - Mengambil stok awal (Shift 1 / Shift 2), penambahan, dan penjualan per shift.
 * - Menghitung sisa stok dan Stok Akhir secara matematis.
 * - Menerapkan perataan tengah (STYLE_DEFAULT, dsb.) pada semua sel angka,
 *   dan perataan kiri (STYLE_LEFT) pada Nama Produk dan Keterangan Aktivitas.
 */
const createDetailedStockSheetData = (data, branchName) => {
  const wsData = [];

  // Metadata Headers
  wsData.push([
    { v: 'FORM STOK BARANG', s: STYLE_HEADER },
    ...Array(21).fill({ v: '', s: STYLE_HEADER })
  ]);

  const isShift2 = String(data.shift) === '2';
  const petugasDisplay = isShift2 ? `${data.staff1 || '-'} / ${data.staff2 || '-'}` : (data.staff1 || data.staffName || '-');

  wsData.push([
    { v: 'Tanggal', s: STYLE_BOLD }, { v: format(new Date(data.date || new Date()), 'dd MMMM yyyy', { locale: id }), s: STYLE_DEFAULT },
    { v: 'Outlet', s: STYLE_BOLD }, { v: branchName, s: STYLE_DEFAULT },
    { v: 'Petugas', s: STYLE_BOLD }, { v: petugasDisplay, s: STYLE_DEFAULT },
    ...Array(15).fill({ v: '', s: STYLE_DEFAULT })
  ]);
  wsData.push([]); // Spacer

  // Main Headers (Row 4)
  wsData.push([
    { v: 'No', s: STYLE_HEADER }, { v: 'Nama Produk', s: STYLE_HEADER },
    { v: 'SHIFT 1', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER },
    { v: 'SHIFT 2', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER },
    { v: 'STOK', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER },
    { v: 'STOK AKHIR', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER },
    { v: 'Keterangan Aktivitas', s: STYLE_HEADER }
  ]);

  // Sub Headers (Row 5)
  wsData.push([
    { v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER },
    { v: 'Awal', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER },
    { v: 'Tambah', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER },
    { v: 'Penjualan', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER },
    { v: 'Sisa', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER },
    { v: 'Awal', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER },
    { v: 'Tambah', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER },
    { v: 'Penjualan', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER },
    { v: 'Sisa', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER },
    { v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER },
    { v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER },
    { v: '', s: STYLE_HEADER }
  ]);

  // O/P Headers (Row 6)
  const opRow = [{ v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }];
  for (let i = 0; i < 10; i++) {
    opRow.push({ v: 'O', s: STYLE_HEADER }, { v: 'P', s: STYLE_HEADER });
  }
  opRow.push({ v: '', s: STYLE_HEADER });
  wsData.push(opRow);

  // --- DATA PROCESSING ---

  // Calculate total Ori vs Premi sales to distribute operational items usage
  let s1TotalO = 0, s1TotalP = 0;
  let s2TotalO = 0, s2TotalP = 0;

  if (isShift2) {
    Object.entries(data.shift1Map || {}).forEach(([key, qty]) => {
      if (key.toLowerCase().includes('premi')) s1TotalP += qty;
      else s1TotalO += qty;
    });
    (data.products || []).forEach(p => {
      const qty = parseInt(p.qty) || 0;
      if (p.variant?.toLowerCase().includes('premi')) s2TotalP += qty;
      else s2TotalO += qty;
    });
  } else {
    (data.products || []).forEach(p => {
      const qty = parseInt(p.qty) || 0;
      if (p.variant?.toLowerCase().includes('premi')) s1TotalP += qty;
      else s1TotalO += qty;
    });
  }

  const getRatio = (o, p) => {
    const total = o + p;
    return total > 0 ? { o: o / total, p: p / total } : { o: 1, p: 0 };
  };
  const s1Ratio = getRatio(s1TotalO, s1TotalP);
  const s2Ratio = getRatio(s2TotalO, s2TotalP);

  const EXCLUDED_FSO = ['teh tarik', 'full cream', 'es teh'];

  const SUPPORT_ITEMS = [
    "Gula 1", "Gula 2", "Premium Tea 1", "Premium 2", "Paper Cup",
    "Diamond BC", "Diamond Besar", "Ultra Milk Besar", "OatMilk",
    "Coffee Cream", "Brown Sugar", "Salted Caramel", "Hazelnut", "Bubble Besar", "Bubble Kecil",
    "Coffee Jelly", "Rainbow Jelly", "Leci Jelly", "Cao Jelly",
    "Pudding Coklat", "Pudding Vanilla", "Susu Kental Manis", "Gula Cair", "Krim Cair",
    "Sedotan Kecil", "Sedotan Besar", "Sedotan Topping", "Tutup Manual",
    "Tisu Kering", "Tisu Basah", "Sealer", "Form Penjualan",
    "Form Stok", "QCP", "Kertas Thermal"
  ];

  // Item box-pecahan: staff hitung pemakaian per PORSI, bukan per kotak.
  // Kartu Stok kolom Penjualan tampilkan porsi (kotak x isi), Awal/Sisa tetap notasi kotak.
  const PORSI_PER_BOX = { 'Diamond Besar': 5, 'Ultra Milk Besar': 4, 'Diamond BC': 4 };

  const STOCK_KEY_MAP = {
    'Tehspresso': 'Ice Roast',
    'hot Americano': 'Espresso (Hot)',
    'Milk Tea': 'Gula Milk Tea',
    'Dancow coklat': 'Dancow Cokelat',
    'Dancow putih': 'Dancow Putih',
    'Teh Madu Hutan': 'Madu Hutan',
    'Belgian Chocolate': 'Belgian Choco',
    'Teh Panas 12oz (Hot)': 'Paper Cup',
    'Cup Oval 14oz (Ori)': 'Cup (Flat)',
    'Cup Oval 16oz (Premi)': 'Cup (Flat)'
  };

  const productsByName = {};

  (data.products || []).forEach(p => {
    let rawName = p.name.trim();
    let variant = p.variant?.toLowerCase().includes('premi') ? 'premi' : 'ori';

    if (rawName.toLowerCase().endsWith(' ori')) {
      rawName = rawName.substring(0, rawName.length - 4).trim();
      variant = 'ori';
    } else if (rawName.toLowerCase().endsWith(' premi')) {
      rawName = rawName.substring(0, rawName.length - 6).trim();
      variant = 'premi';
    } else if (rawName.toLowerCase().includes('(premi)')) {
      variant = 'premi';
    } else if (rawName.toLowerCase().includes('(ori)')) {
      variant = 'ori';
    }

    const cleanName = lookupCI(STOCK_KEY_MAP, rawName) || rawName;
    if (EXCLUDED_FSO.includes(cleanName.toLowerCase())) return;

    let matchName = EXCEL_ORDER.find(e => e.toLowerCase() === cleanName.toLowerCase()) || cleanName;

    if (!productsByName[matchName]) productsByName[matchName] = {};
    productsByName[matchName][variant] = p;
  });

  const stocksByName = {};
  (data.stocks || []).forEach(s => {
    let rawName = s.name.trim();
    let isVariant = false;
    let variant = 'ori';

    if (rawName.toLowerCase().endsWith(' ori')) {
      rawName = rawName.substring(0, rawName.length - 4).trim();
      variant = 'ori';
      isVariant = true;
    } else if (rawName.toLowerCase().endsWith(' premi')) {
      rawName = rawName.substring(0, rawName.length - 6).trim();
      variant = 'premi';
      isVariant = true;
    }

    const cleanName = lookupCI(STOCK_KEY_MAP, rawName) || rawName;
    if (EXCLUDED_FSO.includes(cleanName.toLowerCase())) return;

    let matchName = EXCEL_ORDER.find(e => e.toLowerCase() === cleanName.toLowerCase()) || cleanName;

    if (!stocksByName[matchName]) {
      stocksByName[matchName] = { usedO: 0, usedP: 0, usedRaw: 0, tambahO: 0, tambahP: 0, tambahRaw: 0 };
    }

    const usedQty = parseFloat(s.used !== undefined ? s.used : ((parseFloat(s.porsi_terpakai) || 0) + (parseFloat(s.porsi_rusak) || 0))) || 0;
    const tambahQty = parseFloat(s.tambah) || 0;

    if (isVariant) {
      if (variant === 'premi') {
        stocksByName[matchName].usedP += usedQty;
        stocksByName[matchName].tambahP += tambahQty;
      } else {
        stocksByName[matchName].usedO += usedQty;
        stocksByName[matchName].tambahO += tambahQty;
      }
    } else {
      stocksByName[matchName].usedRaw += usedQty;
      stocksByName[matchName].tambahRaw += tambahQty;
    }
  });

  const allNames = new Set(EXCEL_ORDER);
  Object.keys(productsByName).forEach(name => allNames.add(name));
  Object.keys(stocksByName).forEach(name => allNames.add(name));

  const sortedNames = Array.from(allNames).sort((a, b) => {
    let orderA = EXCEL_ORDER.findIndex(e => e.toLowerCase() === a.toLowerCase());
    let orderB = EXCEL_ORDER.findIndex(e => e.toLowerCase() === b.toLowerCase());

    if (orderA === -1) orderA = 999;
    if (orderB === -1) orderB = 999;

    if (orderA !== orderB) return orderA - orderB;
    return a.localeCompare(b);
  });

  // Build log-based awal/tambah maps: fallback when display_awal is missing in saved report.
  // Tags: "(Set Manual)" → display_awal (qty_after), "[DISPLAY]" after Set Manual → tambah.
  const logAwalMap = {};
  const logTambahMap = {};
  // Pindah stok gudang (safety) -> display selama shift. Tag "(Pindah ke Display)",
  // qty_added negatif (mutasi internal, total tidak berubah). Masuk kolom Tambah, warna oranye.
  const pindahDisplayMap = {};
  if (data.shiftLogs && data.shiftLogs.length > 0) {
    // Aturan hitung pindah (staff vs [PERBAIKI], reset oleh Koreksi) ada di utils/pindahLogs.js.
    Object.assign(pindahDisplayMap, pindahByItem(data.shiftLogs, data.koreksiLogs || []));
    const logsByItem = {};
    data.shiftLogs.forEach(log => {
      if (!logsByItem[log.item_name]) logsByItem[log.item_name] = [];
      logsByItem[log.item_name].push(log);
    });
    Object.entries(logsByItem).forEach(([itemName, logs]) => {
      const sorted = [...logs].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      let lastSetManualTime = -Infinity;
      sorted.forEach(log => {
        const pet = log.petugas_name || '';
        if (pet.includes('(Set Manual)') && log.qty_after != null) {
          logAwalMap[itemName] = log.qty_after;
          lastSetManualTime = new Date(log.created_at).getTime();
          logTambahMap[itemName] = 0;
        } else if (pet.includes('(Reset Tambah)')) {
          // tambah_qty di-set 0 manual (koreksi salah input) — abaikan [DISPLAY] sebelum ini,
          // lanjut hitung dari 0 buat [DISPLAY] SESUDAH titik reset.
          logTambahMap[itemName] = 0;
        } else if (pet.includes('[DISPLAY]') && log.qty_added > 0) {
          if (new Date(log.created_at).getTime() > lastSetManualTime) {
            logTambahMap[itemName] = (logTambahMap[itemName] || 0) + log.qty_added;
          }
        }
      });
    });
  }
  const getLogKey = (prodName) => prodName && (lookupCI(STOCK_KEY_MAP, prodName) || prodName);

  // AdminInventory.jsx nge-log item varian (Ori/Premi) pakai nama BER-SUFFIX ("Milo Ori"),
  // tapi produk di sini nyimpen nama polos + field variant terpisah ("Milo" + "Ori").
  // Coba key ber-suffix dulu (cocok skema AdminInventory), baru fallback ke nama polos.
  const resolveLogKey = (prod, fallbackName) => {
    if (prod?.variant && prod.variant !== 'Standar') {
      const suffixedKey = getLogKey(`${prod.name} ${prod.variant}`);
      if (logAwalMap[suffixedKey] !== undefined) return suffixedKey;
    }
    const bareKey = getLogKey(prod?.name || fallbackName);
    if (bareKey && logAwalMap[bareKey] !== undefined) return bareKey;
    return null;
  };

  const supportMerges = [];
  let idx = 1;
  sortedNames.forEach((name, i) => {
    const isSupport = SUPPORT_ITEMS.includes(name);

    const row = [];
    row.push({ v: idx++, s: STYLE_DEFAULT });
    row.push({ v: name, s: STYLE_LEFT });

    const prodO = productsByName[name]?.ori;
    const prodP = productsByName[name]?.premi;

    let stockUsedO = 0;
    let stockUsedP = 0;
    let stockTambahO = 0;
    let stockTambahP = 0;
    if (stocksByName[name]) {
      if (isSupport) {
        stockUsedO = stocksByName[name].usedO + stocksByName[name].usedP + stocksByName[name].usedRaw;
        stockUsedP = 0;
        stockTambahO = stocksByName[name].tambahO + stocksByName[name].tambahP + stocksByName[name].tambahRaw;
        stockTambahP = 0;
      } else {
        const activeRatio = isShift2 ? s2Ratio : s1Ratio;
        stockUsedO = stocksByName[name].usedO + (stocksByName[name].usedRaw * activeRatio.o);
        stockUsedP = stocksByName[name].usedP + (stocksByName[name].usedRaw * activeRatio.p);
        stockTambahO = stocksByName[name].tambahO + (stocksByName[name].tambahRaw * activeRatio.o);
        stockTambahP = stocksByName[name].tambahP + (stocksByName[name].tambahRaw * activeRatio.p);
      }
    }

    let s1AwalO = 0, s1AwalP = 0;
    let s1TambahO = 0, s1TambahP = 0;
    let s1PenjO = 0, s1PenjP = 0;
    let s1SisaO = 0, s1SisaP = 0;

    let s2AwalO = 0, s2AwalP = 0;
    let s2TambahO = 0, s2TambahP = 0;
    let s2PenjO = 0, s2PenjP = 0;
    let s2SisaO = 0, s2SisaP = 0;

    if (isShift2) {
      s2TambahO = prodO ? parseFloat(prodO.tambah) || 0 : stockTambahO;
      s2TambahP = prodP ? parseFloat(prodP.tambah) || 0 : stockTambahP;

      s2PenjO = prodO ? ((prodO.category === 'Bahan' || (prodO.name && prodO.name.toLowerCase().includes('bubble'))) ? parseFloat(prodO.terjual_fisik) : parseFloat(prodO.qty)) || 0 : stockUsedO;
      s2PenjP = prodP ? ((prodP.category === 'Bahan' || (prodP.name && prodP.name.toLowerCase().includes('bubble'))) ? parseFloat(prodP.terjual_fisik) : parseFloat(prodP.qty)) || 0 : stockUsedP;

      const getDisplaySisa = (prod) => {
        // Sisa DISPLAY saja — jangan fallback ke total inventory (itu termasuk safety stock)
        if (prod && prod.sisa_input != null && prod.sisa_input !== '') {
          const v = parseFloat(prod.sisa_input);
          return isNaN(v) ? 0 : v;
        }
        if (prod && prod.display_awal !== undefined && prod.display_awal !== null && prod.display_awal !== '') {
          return Math.max(0, (parseFloat(prod.display_awal) || 0) + (parseFloat(prod.tambah) || 0));
        }
        return 0;
      };

      s2SisaO = getDisplaySisa(prodO);
      s2SisaP = getDisplaySisa(prodP);

      {
        // Prioritas: display_awal dari LAPORAN (sumber kebenaran, ditulis Koreksi Laporan) >
        // logAwalMap (jejak Set Manual lama, sudah pensiun & bisa basi) > rumus.
        const hasRep = prodO && prodO.display_awal !== undefined && prodO.display_awal !== null && prodO.display_awal !== '';
        const lkO = hasRep ? null : resolveLogKey(prodO, name);
        if (hasRep) {
          s2AwalO = parseFloat(prodO.display_awal) || 0;
        } else if (lkO && logAwalMap[lkO] !== undefined) {
          s2AwalO = logAwalMap[lkO];
          s2TambahO = logTambahMap[lkO] ?? 0;
        } else {
          s2AwalO = s2SisaO + s2PenjO - s2TambahO;
        }
        // Tidak terjual → Sisa disalin dari Awal+Tambah, apapun cabang di atas yang
        // ngisi Awal-nya. Biar shift berikutnya baca Awal yang benar dari Sisa (bukan blank).
        if (s2PenjO === 0) s2SisaO = s2AwalO + s2TambahO;
      }
      {
        const hasRep = prodP && prodP.display_awal !== undefined && prodP.display_awal !== null && prodP.display_awal !== '';
        const lkP = (hasRep || !prodP) ? null : resolveLogKey(prodP, null);
        if (hasRep) {
          s2AwalP = parseFloat(prodP.display_awal) || 0;
        } else if (lkP && logAwalMap[lkP] !== undefined) {
          s2AwalP = logAwalMap[lkP];
          s2TambahP = logTambahMap[lkP] ?? 0;
        } else {
          s2AwalP = s2SisaP + s2PenjP - s2TambahP;
        }
        if (s2PenjP === 0) s2SisaP = s2AwalP + s2TambahP;
      }

      s1SisaO = data.shift1SisaMap?.[prodO?.name] ?? data.shift1SisaMap?.[`${name} Ori`] ?? data.shift1SisaMap?.[name] ?? s2AwalO;
      s1SisaP = data.shift1SisaMap?.[prodP?.name] ?? data.shift1SisaMap?.[`${name} Premi`] ?? s2AwalP;

      s1TambahO = data.shift1Tambah?.[prodO?.name] || data.shift1Tambah?.[`${name} Ori`] || data.shift1Tambah?.[name] || 0;
      s1TambahP = data.shift1Tambah?.[prodP?.name] || data.shift1Tambah?.[`${name} Premi`] || 0;

      s1PenjO = (data.shift1Map?.[prodO?.name] || data.shift1Map?.[`${name} Ori`] || data.shift1Map?.[name] || 0) + (data.shift1OpMap?.[name] ? data.shift1OpMap[name] * s1Ratio.o : 0);
      s1PenjP = (data.shift1Map?.[prodP?.name] || data.shift1Map?.[`${name} Premi`] || 0) + (data.shift1OpMap?.[name] ? data.shift1OpMap[name] * s1Ratio.p : 0);

      const s1KeyO = prodO?.name || `${name} Ori` || name;
      const s1KeyP = prodP?.name || `${name} Premi`;
      if (data.shift1AwalMap?.[s1KeyO] !== undefined) {
        s1AwalO = data.shift1AwalMap[s1KeyO];
      } else {
        s1AwalO = s1SisaO + s1PenjO - s1TambahO;
      }
      if (data.shift1AwalMap?.[s1KeyP] !== undefined) {
        s1AwalP = data.shift1AwalMap[s1KeyP];
      } else {
        s1AwalP = s1SisaP + s1PenjP - s1TambahP;
      }
    } else {
      s1TambahO = prodO ? parseFloat(prodO.tambah) || 0 : stockTambahO;
      s1TambahP = prodP ? parseFloat(prodP.tambah) || 0 : stockTambahP;

      s1PenjO = prodO ? ((prodO.category === 'Bahan' || (prodO.name && prodO.name.toLowerCase().includes('bubble'))) ? parseFloat(prodO.terjual_fisik) : parseFloat(prodO.qty)) || 0 : stockUsedO;
      s1PenjP = prodP ? ((prodP.category === 'Bahan' || (prodP.name && prodP.name.toLowerCase().includes('bubble'))) ? parseFloat(prodP.terjual_fisik) : parseFloat(prodP.qty)) || 0 : stockUsedP;

      const getDisplaySisa = (prod) => {
        // Sisa DISPLAY saja — jangan fallback ke total inventory (itu termasuk safety stock)
        if (prod && prod.sisa_input != null && prod.sisa_input !== '') {
          const v = parseFloat(prod.sisa_input);
          return isNaN(v) ? 0 : v;
        }
        if (prod && prod.display_awal !== undefined && prod.display_awal !== null && prod.display_awal !== '') {
          return Math.max(0, (parseFloat(prod.display_awal) || 0) + (parseFloat(prod.tambah) || 0));
        }
        return 0;
      };

      s1SisaO = getDisplaySisa(prodO);
      s1SisaP = getDisplaySisa(prodP);

      // Prioritas: display_awal dari LAPORAN (ditulis Koreksi Laporan / snapshot Tutup Shift) >
      // logAwalMap (jejak Set Manual — fitur sudah pensiun, bisa basi) > rumus.
      {
        const hasRep = prodO && prodO.display_awal !== undefined && prodO.display_awal !== null && prodO.display_awal !== '';
        const lkO = hasRep ? null : resolveLogKey(prodO, name);
        if (hasRep) {
          s1AwalO = parseFloat(prodO.display_awal) || 0;
        } else if (lkO && logAwalMap[lkO] !== undefined) {
          s1AwalO = logAwalMap[lkO];
          s1TambahO = logTambahMap[lkO] ?? 0;
        } else {
          s1AwalO = s1SisaO + s1PenjO - s1TambahO;
        }
        if (s1PenjO === 0) s1SisaO = s1AwalO + s1TambahO;
      }
      {
        const hasRep = prodP && prodP.display_awal !== undefined && prodP.display_awal !== null && prodP.display_awal !== '';
        const lkP = (hasRep || !prodP) ? null : resolveLogKey(prodP, null);
        if (hasRep) {
          s1AwalP = parseFloat(prodP.display_awal) || 0;
        } else if (lkP && logAwalMap[lkP] !== undefined) {
          s1AwalP = logAwalMap[lkP];
          s1TambahP = logTambahMap[lkP] ?? 0;
        } else {
          s1AwalP = s1SisaP + s1PenjP - s1TambahP;
        }
        if (s1PenjP === 0) s1SisaP = s1AwalP + s1TambahP;
      }

      s2AwalO = '';
      s2AwalP = '';

      s2TambahO = '';
      s2TambahP = '';
      s2PenjO = '';
      s2PenjP = '';

      s2SisaO = '';
      s2SisaP = '';
    }

    if (isSupport) {
      s1AwalO = s1AwalO + s1AwalP; s1AwalP = '';
      s1TambahO = s1TambahO + s1TambahP; s1TambahP = '';
      s1PenjO = s1PenjO + s1PenjP; s1PenjP = '';
      s1SisaO = s1SisaO + s1SisaP; s1SisaP = '';

      if (isShift2) {
        s2AwalO = s2AwalO + s2AwalP; s2AwalP = '';
        s2TambahO = s2TambahO + s2TambahP; s2TambahP = '';
        s2PenjO = s2PenjO + s2PenjP; s2PenjP = '';
        s2SisaO = s2SisaO + s2SisaP; s2SisaP = '';
      }

      const r = 6 + i;
      // SHIFT 1 Merges
      supportMerges.push({ s: { r, c: 2 }, e: { r, c: 3 } }); // Awal
      supportMerges.push({ s: { r, c: 4 }, e: { r, c: 5 } }); // Tambah
      supportMerges.push({ s: { r, c: 6 }, e: { r, c: 7 } }); // Penjualan
      supportMerges.push({ s: { r, c: 8 }, e: { r, c: 9 } }); // Sisa

      // SHIFT 2 Merges
      supportMerges.push({ s: { r, c: 10 }, e: { r, c: 11 } }); // Awal
      supportMerges.push({ s: { r, c: 12 }, e: { r, c: 13 } }); // Tambah
      supportMerges.push({ s: { r, c: 14 }, e: { r, c: 15 } }); // Penjualan
      supportMerges.push({ s: { r, c: 16 }, e: { r, c: 17 } }); // Sisa

      // STOK & STOK AKHIR
      supportMerges.push({ s: { r, c: 18 }, e: { r, c: 19 } }); // Stok
      supportMerges.push({ s: { r, c: 20 }, e: { r, c: 21 } }); // Stok Akhir
    }

    const fmt = (v) => (v !== '' && v > 0) ? formatFrac(v) : '';
    // Kolom Penjualan buat item box-pecahan: tampilkan PORSI (kotak x isi), bukan kotak.
    // Staff hitung pemakaian per porsi (mis. Diamond Besar 5 1/5 -> 4 1/5 = 5 porsi dipakai).
    const _pb = PORSI_PER_BOX[name];
    const fmtPenj = (v) => (v !== '' && v > 0) ? (_pb ? String(Math.round(v * _pb)) : formatFrac(v)) : '';

    // "Pindah ke Display" (stok gudang -> display) selama shift aktif: masukkan ke kolom
    // Tambah shift itu dan warnai oranye. Sisa & STOK (safety_remaining) sudah mencerminkan
    // pindah ini; ini melengkapi supaya Awal + Tambah - Jual = Sisa balance.
    // Key log = nama ber-suffix ("Milo Ori") atau nama polos; pindahDisplayMap pakai item_name mentah.
    const _pindahLookup = (prod, fb) => {
      if (!prod && !fb) return 0;
      if (prod?.variant && prod.variant !== 'Standar') {
        const k = getLogKey(`${prod.name} ${prod.variant}`);
        if (pindahDisplayMap[k]) return pindahDisplayMap[k];
      }
      const bare = getLogKey(prod?.name || fb);
      return bare ? (pindahDisplayMap[bare] || 0) : 0;
    };
    const _pinO = _pindahLookup(prodO, name);
    const _pinP = prodP ? _pindahLookup(prodP, null) : 0;
    // Kolom Tambah: warna = SUMBER, bukan varian. Hitam = kiriman Gudang Pusat
    // (Ori & Premi sama), hijau = murni Pindah ke Display. Tidak pakai biru-Premi
    // di kolom ini biar tidak rancu dengan makna hijau/hitam.
    let s1TambOStyle = STYLE_DEFAULT, s1TambPStyle = STYLE_DEFAULT;
    let s2TambOStyle = STYLE_DEFAULT, s2TambPStyle = STYLE_DEFAULT;
    const N = v => Number(v) || 0;
    // Pindahkan qty "Pindah ke Display" ke kolom Tambah (hijau) supaya:
    //   Awal (awal shift sebenarnya) + Tambah - Jual = Sisa  selalu balance,
    // apapun raw Awal-nya (pra- atau pasca-pindah, mis. akibat "Sinkron Stok Awal").
    //   Awal' = Awal + gap - pin  ; Tambah' = Tambah + pin  ; gap = Sisa - (Awal + Tambah - Jual)
    // HIJAU (STYLE_ORANGE) hanya kalau SELURUH isi kolom Tambah berasal dari "Pindah ke
    // Display" (stok gudang cabang). Kalau shift itu juga ada kiriman dari Gudang Pusat
    // (tamb awal > 0), kolomnya campuran -> biarkan HITAM biar tidak menyesatkan
    // ("hitam = dari pengiriman pusat, hijau = ambil dari stok cabang sendiri").
    const applyPin = (awal, tamb, penj, sisa, pin) => {
      if (!(pin > 0)) return { awal, tamb, orange: false };
      // Sisa / Awal belum terisi (belum bisa dibalance): pindahan tetap ditampilkan di Tambah, Awal tidak disentuh —
      // supaya Keterangan ("pindah stok ke display") dan kolom Tambah tidak saling bertentangan.
      if (sisa === '' || awal === '') {
        if (tamb === '' && awal === '') return { awal, tamb, orange: false };
        return { awal, tamb: N(tamb) + pin, orange: N(tamb) === 0 };
      }
      // Awal = lanjutan Sisa shift sebelumnya, JANGAN digeser. Log pindah bisa lebih besar dari
      // pindah bersih (CS 9 Okt S2: pindah 100 dibatalkan lewat Koreksi lalu dipindah ulang ->
      // 2 log = 200, Awal ke-hitung mundur jadi 35 padahal 135). Batasi pindah ke ruang yang
      // masih menjaga Awal: Sisa - Awal - Tambah + Jual.
      const room = N(sisa) - N(awal) - N(tamb) + N(penj);
      // room == 0: tidak ada ruang buat menggeser Awal (Sisa belum diperbarui / sama dengan Awal). Tambah TETAP
      // menampilkan qty pindahan sebenarnya (sama dengan Keterangan), Awal tidak disentuh — jangan dikosongkan,
      // dipotong, atau Awal dinolkan. room < 0 (Awal sudah termasuk pindahan) diseimbangkan di bawah.
      // Sisa ikut naik sebesar pindahan: Awal + Tambah' - Jual = Sisa'. Tanpa ini Sisa tertinggal di Awal
      // (rumus "tidak terjual -> Sisa = Awal + Tambah" di atas tidak tahu soal pindahan).
      if (Math.abs(room) <= 0.0005) return { awal, tamb: N(tamb) + pin, orange: N(tamb) === 0, sisa: N(sisa) + pin };
      if (room > 0) pin = Math.min(pin, room);
      if (!(pin > 0)) return { awal, tamb, orange: false };
      const pureFromPindah = N(tamb) === 0;
      // Target: Awal' + Tambah' - Jual = Sisa, dengan pindah tampil di Tambah.
      let newTamb = N(tamb) + pin;
      let newAwal = N(sisa) - newTamb + N(penj);
      // Kalau pindah lebih besar dari "ruang" (Awal jadi negatif): kecilkan yang di Tambah,
      // JANGAN buang selisih diam-diam ke Awal=0 (bikin baris tidak balance).
      if (newAwal < 0) { newTamb += newAwal; newAwal = 0; }
      return { awal: newAwal, tamb: Math.max(0, newTamb), orange: pureFromPindah };
    };
    if (isShift2) {
      if (_pinO > 0) { const r = applyPin(s2AwalO, s2TambahO, s2PenjO, s2SisaO, _pinO); s2AwalO = r.awal; s2TambahO = r.tamb; if (r.sisa !== undefined) s2SisaO = r.sisa; if (r.orange) s2TambOStyle = STYLE_ORANGE; }
      if (_pinP > 0) {
        if (s2TambahP === '' || isSupport) { const r = applyPin(s2AwalO, s2TambahO, s2PenjO, s2SisaO, _pinP); s2AwalO = r.awal; s2TambahO = r.tamb; if (r.sisa !== undefined) s2SisaO = r.sisa; if (r.orange) s2TambOStyle = STYLE_ORANGE; }
        else { const r = applyPin(s2AwalP, s2TambahP, s2PenjP, s2SisaP, _pinP); s2AwalP = r.awal; s2TambahP = r.tamb; if (r.sisa !== undefined) s2SisaP = r.sisa; if (r.orange) s2TambPStyle = STYLE_ORANGE; }
      }
      // Pindah yang terjadi di SHIFT 1 (dari shift1Report.pindah_display) — kolom Shift 1
      const p1 = data.shift1Pindah || {};
      const _p1O = _pindahLookup ? (p1[getLogKey(prodO?.variant && prodO.variant !== 'Standar' ? `${prodO.name} ${prodO.variant}` : (prodO?.name || name))] || 0) : 0;
      const _p1P = prodP ? (p1[getLogKey(`${prodP.name} ${prodP.variant}`)] || 0) : 0;
      if (_p1O > 0) { const r = applyPin(s1AwalO, s1TambahO, s1PenjO, s1SisaO, _p1O); s1AwalO = r.awal; s1TambahO = r.tamb; if (r.sisa !== undefined) s1SisaO = r.sisa; if (r.orange) s1TambOStyle = STYLE_ORANGE; }
      if (_p1P > 0) {
        if (s1TambahP === '' || isSupport) { const r = applyPin(s1AwalO, s1TambahO, s1PenjO, s1SisaO, _p1P); s1AwalO = r.awal; s1TambahO = r.tamb; if (r.sisa !== undefined) s1SisaO = r.sisa; if (r.orange) s1TambOStyle = STYLE_ORANGE; }
        else { const r = applyPin(s1AwalP, s1TambahP, s1PenjP, s1SisaP, _p1P); s1AwalP = r.awal; s1TambahP = r.tamb; if (r.sisa !== undefined) s1SisaP = r.sisa; if (r.orange) s1TambPStyle = STYLE_ORANGE; }
      }
    } else {
      if (_pinO > 0) { const r = applyPin(s1AwalO, s1TambahO, s1PenjO, s1SisaO, _pinO); s1AwalO = r.awal; s1TambahO = r.tamb; if (r.sisa !== undefined) s1SisaO = r.sisa; if (r.orange) s1TambOStyle = STYLE_ORANGE; }
      if (_pinP > 0) {
        if (s1TambahP === '' || isSupport) { const r = applyPin(s1AwalO, s1TambahO, s1PenjO, s1SisaO, _pinP); s1AwalO = r.awal; s1TambahO = r.tamb; if (r.sisa !== undefined) s1SisaO = r.sisa; if (r.orange) s1TambOStyle = STYLE_ORANGE; }
        else { const r = applyPin(s1AwalP, s1TambahP, s1PenjP, s1SisaP, _pinP); s1AwalP = r.awal; s1TambahP = r.tamb; if (r.sisa !== undefined) s1SisaP = r.sisa; if (r.orange) s1TambPStyle = STYLE_ORANGE; }
      }
    }

    // SHIFT 1
    row.push({ v: fmt(s1AwalO), s: STYLE_DEFAULT }, { v: fmt(s1AwalP), s: STYLE_PREMI }); // Awal
    row.push({ v: fmt(s1TambahO), s: s1TambOStyle }, { v: fmt(s1TambahP), s: s1TambPStyle }); // Tambah
    row.push({ v: fmtPenj(s1PenjO), s: STYLE_RED }, { v: fmtPenj(s1PenjP), s: STYLE_RED }); // Penjualan
    row.push({ v: fmt(s1SisaO), s: STYLE_BOLD }, { v: fmt(s1SisaP), s: STYLE_PREMI_BOLD }); // Sisa

    // SHIFT 2
    row.push({ v: fmt(s2AwalO), s: STYLE_DEFAULT }, { v: fmt(s2AwalP), s: STYLE_PREMI }); // Awal
    row.push({ v: fmt(s2TambahO), s: s2TambOStyle }, { v: fmt(s2TambahP), s: s2TambPStyle }); // Tambah
    row.push({ v: fmtPenj(s2PenjO), s: STYLE_RED }, { v: fmtPenj(s2PenjP), s: STYLE_RED }); // Penjualan
    row.push({ v: fmt(s2SisaO), s: STYLE_BOLD }, { v: fmt(s2SisaP), s: STYLE_PREMI_BOLD }); // Sisa

    // STOK = Laci/Gudang, kolom safety_qty langsung — INDEPENDEN dari Display (Awal/Tambah).
    // Staff ambil stok gudang kapan saja tanpa lewat "pengiriman", jadi ga ada rumus
    // total-dikurangi-display yang benar di sini (BranchPOS.jsx sudah dibetulkan buat nyimpen
    // safety_remaining = safety_qty murni, bukan current_qty-display_qty lagi).
    const stokO = parseFloat(prodO?.safety_remaining) || 0;
    const stokP = parseFloat(prodP?.safety_remaining) || 0;

    // STOK AKHIR = Stok gudang (safety) + Sisa display shift terakhir.
    // Shift terakhir = Shift 2 kalau ada, kalau belum ada pakai Sisa Shift 1.
    const activeSisaO = isShift2 ? s2SisaO : s1SisaO;
    const activeSisaP = isShift2 ? s2SisaP : s1SisaP;
    const stokAkhirO = stokO + (typeof activeSisaO === 'number' ? activeSisaO : 0);
    const stokAkhirP = stokP + (typeof activeSisaP === 'number' ? activeSisaP : 0);

    // STOK (Safety masih di gudang) & STOK AKHIR (sisa display)
    row.push({ v: fmt(stokO), s: STYLE_BOLD }, { v: fmt(stokP), s: STYLE_PREMI_BOLD }); // Stok (safety sisa)
    row.push({ v: fmt(stokAkhirO), s: STYLE_RED_BOLD }, { v: fmt(stokAkhirP), s: STYLE_RED_BOLD }); // Stok Akhir

    // KETERANGAN AKTIVITAS
    let ketStr = '';
    const _logMatchesRow = (l) => {
      // Log yang sudah ditandai batal (laporan dihapus / sesi lama pra-seeding) JANGAN
      // muncul di Keterangan — bikin "X di kurasi" hantu padahal aktivitas itu ga berlaku.
      const pet = l.petugas_name || '';
      if (pet.includes('[SESI LAMA') || pet.includes('[LAPORAN DIHAPUS')) return false;
      // Log varian (AdminInventory/BranchStockDrawer) nyimpen item_name BER-SUFFIX
      // ("Avocado Premi"), tapi `name` di sini nama bare EXCEL_ORDER ("Avocado") —
      // lucuti suffix dulu biar Oper/Kurasi/Pindah item varian ke-detect di Keterangan.
      let rawLogName = (l.item_name || '').trim();
      if (rawLogName.toLowerCase().endsWith(' ori')) rawLogName = rawLogName.slice(0, -4).trim();
      else if (rawLogName.toLowerCase().endsWith(' premi')) rawLogName = rawLogName.slice(0, -6).trim();
      let cleanLogName = lookupCI(STOCK_KEY_MAP, rawLogName) || rawLogName;
      if (cleanLogName) cleanLogName = cleanLogName.toLowerCase();
      return cleanLogName === name.toLowerCase();
    };
    if (data.shiftLogs) {
      const _counted = pindahByItem(data.shiftLogs, data.koreksiLogs || []);
      const _lastKor = {};
      [...data.shiftLogs, ...(data.koreksiLogs || [])].forEach(l => { if ((l.petugas_name || '').includes('(Koreksi)')) _lastKor[l.item_name] = Math.max(_lastKor[l.item_name] || 0, new Date(l.created_at).getTime() || 0); });
      const _fixSet = new Set(data.shiftLogs.filter(l => (l.petugas_name || '').includes('[PERBAIKI]')).map(l => l.item_name));
      const logs = data.shiftLogs.filter(l => {
        const pet = l.petugas_name || '';
        if (!_logMatchesRow(l)) return false;
        // satu-satunya aksi admin yang ditulis: pindah stok ke display dari panel Perbaiki (yang masih berlaku, bukan yang sudah di-reset Koreksi)
        if (pet.includes('[PERBAIKI]')) return _counted[l.item_name] > 0 && (new Date(l.created_at).getTime() || 0) > (_lastKor[l.item_name] || 0);
        if (/\((admin|owner)\)/i.test(pet)) return false;
        return !(pet.includes('(Pindah ke Display)') && _fixSet.has(l.item_name)); // digantikan [PERBAIKI]
      });
      if (logs.length > 0) {
        const actions = logs.map(l => {
          const qty = Math.abs(l.qty_added);
          let note = l.petugas_name || '';

          if (note.includes('Operan dari ')) {
            let from = note.split('Operan dari ')[1].split(' (')[0].replace(')', '').trim();
            let fromStr = from;
            if (fromStr.toLowerCase() !== 'gudang' && !fromStr.toLowerCase().startsWith('cabang')) fromStr = `cabang ${fromStr}`;
            return `${qty} di oper dari ${fromStr}`;
          } else if (note.includes('Dioper ke ') || note.includes('(Oper ke ')) {
            let to = '';
            if (note.includes('Dioper ke ')) {
              to = note.split('Dioper ke ')[1].split(' (')[0].replace(')', '').trim();
            } else {
              to = note.split('(Oper ke ')[1].split(')')[0].trim();
            }
            let toStr = to;
            if (toStr.toLowerCase() !== 'gudang' && !toStr.toLowerCase().startsWith('cabang')) toStr = `cabang ${toStr}`;
            return `${qty} di oper ke ${toStr}`;
          } else if (note.toLowerCase().includes('kurasi') || note.includes('Ditarik Gudang') || note.toLowerCase().includes('buang')) {
            return `${qty} di kurasi`;
          } else if (note.includes('(Pindah ke Display)') || note.includes('[PERBAIKI]')) {
            return `${qty} pindah stok ke display`;
          } else if (note.includes('(Pindah ke Laci)')) {
            return `${qty} pindah display ke stok`;
          } else {
            // Keterangan cuma buat aksi drawer staff outlet (Oper/Kurasi/Pindah Laci-Display).
            // Set Manual, Restock, dan aksi admin lain sengaja ga ditampilin di sini.
            return null;
          }
        });
        ketStr = actions.filter(Boolean).join(', ');
      }
    }
    // Aktivitas admin (Koreksi / Penyesuaian Stok dll) sengaja TIDAK ditulis di Keterangan — hanya aksi staff outlet
    // + pindah stok ke display dari panel Perbaiki ([PERBAIKI]).
    row.push({ v: ketStr, s: STYLE_LEFT });

    // Diamond Besar yg sebagian kotaknya asal Ultra Milk (tombol "Jadi Diamond"): tulis "2(ultra)+1".
    // ultra_qty = jml kotak asal Ultra yg masih ada (Diamond asli dipakai duluan), dari laporan.
    // Kolom kotak saja (Awal/Tambah/Sisa/Stok/Stok Akhir); Penjualan (porsi) tidak dipecah.
    if (name === 'Diamond Besar') {
      const U = parseFloat(prodO?.ultra_qty) || 0;
      if (U > 0) {
        [2, 4, 8, 10, 12, 16, 18, 20].forEach(c => {
          const v = parseQtyStr(String(row[c]?.v ?? ''));
          if (!(v > 0)) return;
          const u = Math.min(U, v), rest = Math.round((v - u) * 1000) / 1000;
          row[c] = { ...row[c], v: `${formatFrac(u)}(ultra)${rest > 0 ? '+' + formatFrac(rest) : ''}` };
        });
      }
    }
    wsData.push(row);
  });

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Merges
  const merges = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 22 } }, // Title
    { s: { r: 1, c: 1 }, e: { r: 1, c: 3 } }, // Tanggal val
    { s: { r: 1, c: 5 }, e: { r: 1, c: 7 } }, // Outlet val
    { s: { r: 1, c: 9 }, e: { r: 1, c: 12 } }, // Petugas val

    { s: { r: 3, c: 0 }, e: { r: 5, c: 0 } }, // No
    { s: { r: 3, c: 1 }, e: { r: 5, c: 1 } }, // Nama Produk
    { s: { r: 3, c: 22 }, e: { r: 5, c: 22 } }, // Keterangan Aktivitas

    // SHIFT 1 Merges
    { s: { r: 3, c: 2 }, e: { r: 3, c: 9 } }, // SHIFT 1 label
    { s: { r: 4, c: 2 }, e: { r: 4, c: 3 } }, // Awal S1
    { s: { r: 4, c: 4 }, e: { r: 4, c: 5 } }, // Tambah S1
    { s: { r: 4, c: 6 }, e: { r: 4, c: 7 } }, // Penjualan S1
    { s: { r: 4, c: 8 }, e: { r: 4, c: 9 } }, // Sisa S1

    // SHIFT 2 Merges
    { s: { r: 3, c: 10 }, e: { r: 3, c: 17 } }, // SHIFT 2 label
    { s: { r: 4, c: 10 }, e: { r: 4, c: 11 } }, // Awal S2
    { s: { r: 4, c: 12 }, e: { r: 4, c: 13 } }, // Tambah S2
    { s: { r: 4, c: 14 }, e: { r: 4, c: 15 } }, // Penjualan S2
    { s: { r: 4, c: 16 }, e: { r: 4, c: 17 } }, // Sisa S2

    { s: { r: 3, c: 18 }, e: { r: 4, c: 19 } }, // STOK label
    { s: { r: 3, c: 20 }, e: { r: 4, c: 21 } }, // STOK AKHIR label
  ];

  ws['!merges'] = [...merges, ...supportMerges];

  // Set column widths
  ws['!cols'] = [
    { wch: 4 }, { wch: 25 },
    ...Array(20).fill({ wch: 4.5 }), // Narrow columns for O/P
    { wch: 35 } // Keterangan Aktivitas column width
  ];

  return ws;
};



const createVarianceSheetData = (stockData, consolidatedProducts) => {
  const wsData = [
    [{ v: 'LAPORAN SELISIH BAHAN (WASTE)', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }],
    [],
    [
      { v: 'Bahan Pokok', s: STYLE_HEADER },
      { v: 'Pemakaian Fisik (Support Product)', s: STYLE_HEADER },
      { v: 'Pemakaian Teori (Struk)', s: STYLE_HEADER },
      { v: 'Selisih (Waste)', s: STYLE_HEADER }
    ]
  ];

  const parseQty = (val) => {
    if (typeof val === 'string' && val.includes(' ')) {
      const [whole, frac] = val.split(' ');
      const [num, den] = frac.split('/');
      return parseFloat(whole) + (parseFloat(num) / parseFloat(den));
    }
    if (typeof val === 'string' && val.includes('/')) {
      const [num, den] = val.split('/');
      return parseFloat(num) / parseFloat(den);
    }
    return parseFloat(val) || 0;
  };

  const getBaseUsed = (name) => {
    const p2 = stockData.products.find(p => p.name === name && p.category === 'Bahan');
    if (!p2) return 0;
    const key = p2.variant && p2.variant !== 'Standar' ? `${p2.name} ${p2.variant}` : p2.name;
    const masterAwal = parseFloat(stockData.inventoryMap[key] ?? stockData.inventoryMap[p2.name]) || 0;
    const tambah1 = stockData.shift1Tambah[key] || 0;
    const tambah2 = parseQty(p2.tambah) || 0;
    const sisa = parseQty(p2.qty) || 0;
    return (masterAwal + tambah1 + tambah2) - sisa;
  };

  const getSold = (name, variant = 'Standar') => {
    let total = 0;
    consolidatedProducts.forEach(p => {
      if (p.name === name && (p.variant || 'Standar') === variant) {
        total += parseInt(p.qty) || 0;
      }
    });
    return total;
  };

  // 1. Diamond Besar Ori
  const diamondUsed = getBaseUsed('Diamond Besar Ori') || getBaseUsed('Diamond Besar');
  const milkOriCapacity = diamondUsed * 5;
  const sachetNames = ['Strawberry', 'Melon', 'Avocado', 'Green Tea', 'Green Tea Latte', 'Choco Oreo', 'Taro', 'Belgian Choco', 'Belgian Chocolate'];
  let sachetOriSold = 0; let sachetPremiSold = 0;
  consolidatedProducts.forEach(p => {
    if (sachetNames.includes(p.name)) {
      if (p.variant === 'Premi') sachetPremiSold += parseInt(p.qty) || 0;
      else sachetOriSold += parseInt(p.qty) || 0;
    }
  });
  const coffeCreamOriUsed = getBaseUsed('Coffe Cream Ori') || getBaseUsed('Coffee Cream Ori') || getBaseUsed('Coffe Cream') || getBaseUsed('Coffee Cream') || getSold('Coffe Cream', 'Ori') || getSold('Coffee Cream', 'Ori') || getSold('Coffe Cream', 'Standar') || getSold('Coffee Cream', 'Standar');
  const fullCreamOriSold = getSold('Full Cream', 'Standar') + getSold('Full Cream', 'Ori');

  const milkOriTheory = coffeCreamOriUsed + fullCreamOriSold + sachetOriSold;
  wsData.push([
    { v: 'Susu Diamond Besar', s: STYLE_DEFAULT },
    { v: `${diamondUsed} Kotak (${milkOriCapacity} Porsi)`, s: STYLE_DEFAULT },
    { v: `${milkOriTheory} Porsi`, s: STYLE_DEFAULT },
    { v: `${milkOriCapacity - milkOriTheory} Porsi`, s: STYLE_DEFAULT }
  ]);

  // 2. Ultra Milk Besar Premi
  const ultraUsed = getBaseUsed('Ultra Milk Besar Premi') || getBaseUsed('Ultra Milk Besar');
  const milkPremiCapacity = ultraUsed * 4;
  const fullCreamPremiSold = getSold('Full Cream', 'Premi');
  const milkPremiTheory = fullCreamPremiSold + sachetPremiSold;
  wsData.push([
    { v: 'Susu Ultra Milk Premi', s: STYLE_DEFAULT },
    { v: `${ultraUsed} Kotak (${milkPremiCapacity} Porsi)`, s: STYLE_DEFAULT },
    { v: `${milkPremiTheory} Porsi`, s: STYLE_DEFAULT },
    { v: `${milkPremiCapacity - milkPremiTheory} Porsi`, s: STYLE_DEFAULT }
  ]);

  // 3. Black Tea
  const btOriUsed = getBaseUsed('Black Tea Ori') || getBaseUsed('Black Tea');
  const mtOriSold = getSold('Milk Tea', 'Standar') + getSold('Milk Tea', 'Ori');
  const ttOriSold = getSold('Teh Tarik', 'Standar') + getSold('Teh Tarik', 'Ori');
  const btOriTheory = mtOriSold + ttOriSold;
  wsData.push([
    { v: 'Black Tea Ori', s: STYLE_DEFAULT },
    { v: `${btOriUsed} Porsi`, s: STYLE_DEFAULT },
    { v: `${btOriTheory} Porsi`, s: STYLE_DEFAULT },
    { v: `${btOriUsed - btOriTheory} Porsi`, s: STYLE_DEFAULT }
  ]);

  const btPremiUsed = getBaseUsed('Black Tea Premi');
  const mtPremiSold = getSold('Milk Tea', 'Premi');
  const ttPremiSold = getSold('Teh Tarik', 'Premi');
  const btPremiTheory = mtPremiSold + ttPremiSold;
  wsData.push([
    { v: 'Black Tea Premi', s: STYLE_DEFAULT },
    { v: `${btPremiUsed} Porsi`, s: STYLE_DEFAULT },
    { v: `${btPremiTheory} Porsi`, s: STYLE_DEFAULT },
    { v: `${btPremiUsed - btPremiTheory} Porsi`, s: STYLE_DEFAULT }
  ]);

  // 4. Coffe Cream
  const flavorNames = ['Hazelnut', 'Brown Sugar', 'Salted Caramel'];
  let flavorOriSold = 0; let flavorPremiSold = 0;
  consolidatedProducts.forEach(p => {
    if (flavorNames.includes(p.name)) {
      if (p.variant === 'Premi') flavorPremiSold += parseInt(p.qty) || 0;
      else flavorOriSold += parseInt(p.qty) || 0;
    }
  });
  const ccMenuOriSold = getSold('Coffee Cream', 'Standar') + getSold('Coffee Cream', 'Ori');
  const ccOriTheory = flavorOriSold + ccMenuOriSold;
  wsData.push([
    { v: 'Coffe Cream Ori', s: STYLE_DEFAULT },
    { v: `${coffeCreamOriUsed} Porsi`, s: STYLE_DEFAULT },
    { v: `${ccOriTheory} Porsi`, s: STYLE_DEFAULT },
    { v: `${coffeCreamOriUsed - ccOriTheory} Porsi`, s: STYLE_DEFAULT }
  ]);

  const ccPremiUsed = getBaseUsed('Coffe Cream Premi');
  const ccMenuPremiSold = getSold('Coffee Cream', 'Premi');
  const ccPremiTheory = flavorPremiSold + ccMenuPremiSold;
  wsData.push([
    { v: 'Coffe Cream Premi', s: STYLE_DEFAULT },
    { v: `${ccPremiUsed} Porsi`, s: STYLE_DEFAULT },
    { v: `${ccPremiTheory} Porsi`, s: STYLE_DEFAULT },
    { v: `${ccPremiUsed - ccPremiTheory} Porsi`, s: STYLE_DEFAULT }
  ]);

  // 5. Gelas (Cups)
  let cupOriUsed = 0; let cupPremiUsed = 0;
  stockData.products.forEach(p => {
    if (p.category === 'Bahan' && p.name.toLowerCase().includes('cup')) {
      if (p.name.toLowerCase().includes('premi')) cupPremiUsed += getBaseUsed(p.name);
      else if (p.name.toLowerCase().includes('ori') || !p.name.toLowerCase().includes('premi')) cupOriUsed += getBaseUsed(p.name);
    }
  });

  // Daftar sama persis dengan hitungan Es Teh di POS (stockUtils) — dulu salinan sendiri yang
  // ketinggalan (GD Capucinno, Teh Jahe, Teh Serai, dll) bikin teori cup Excel beda dari POS.
  let cupSubOri = 0; let cupSubPremi = 0;
  consolidatedProducts.forEach(p => {
    if (CUP_SUBTRACTOR_DRINKS.includes(p.name)) {
      if (p.variant === 'Premi') cupSubPremi += parseInt(p.qty) || 0;
      else cupSubOri += parseInt(p.qty) || 0;
    }
  });

  const esTehOriSold = getSold('Es Teh', 'Standar') + getSold('Es Teh', 'Ori');
  const esTehPremiSold = getSold('Es Teh', 'Premi');

  const cupOriTheory = cupSubOri + esTehOriSold;
  wsData.push([
    { v: 'Cup Ori (Paper/Plastik)', s: STYLE_DEFAULT },
    { v: `${cupOriUsed} Gelas`, s: STYLE_DEFAULT },
    { v: `${cupOriTheory} Gelas`, s: STYLE_DEFAULT },
    { v: `${cupOriUsed - cupOriTheory} Gelas`, s: STYLE_DEFAULT }
  ]);

  const cupPremiTheory = cupSubPremi + esTehPremiSold;
  wsData.push([
    { v: 'Cup Premi', s: STYLE_DEFAULT },
    { v: `${cupPremiUsed} Gelas`, s: STYLE_DEFAULT },
    { v: `${cupPremiTheory} Gelas`, s: STYLE_DEFAULT },
    { v: `${cupPremiUsed - cupPremiTheory} Gelas`, s: STYLE_DEFAULT }
  ]);


  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{ wch: 25 }, { wch: 25 }, { wch: 25 }, { wch: 20 }];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
  return ws;
};

/**
 * ============================================================================
 * EKSPOR EXCEL UTAMA: PENJUALAN + STOK + WASTE (exportShiftToExcel)
 * ============================================================================
 * Digunakan oleh kasir atau admin saat menekan tombol Export Excel di akhir shift.
 * Menghasilkan file Excel dengan 3 sheet sekaligus:
 * 1. "Penjualan" -> Laporan penjualan produk & cup.
 * 2. "Stok" -> Kartu Stok lengkap (Awal, Tambah, Penjualan, Sisa, Akhir).
 * 3. "Waste & Selisih" -> Audit pemakaian fisik vs teoritis struk.
 */
export const exportShiftToExcel = (formData, branchName) => {
  try {
    // Sanitize old data to match new capitalization
    if (formData && formData.products) {
      formData.products.forEach(p => {
        if (p.name === 'Cao jelly') p.name = 'Cao Jelly';
      });
    }
    if (formData && formData.shift1Report && formData.shift1Report.details) {
      formData.shift1Report.details.forEach(d => {
        if (d.name === 'Cao jelly') d.name = 'Cao Jelly';
      });
    }

    const wb = XLSX.utils.book_new();
    const isShift2 = String(formData.shift) === '2' && formData.shift1Report;
    const shift1Report = formData.shift1Report;

    // 1. GENERATE SHIFT 1 SHEET (IF SHIFT 2)
    if (isShift2) {
      // Build map of shift 1 sold details
      const s1Map = {};
      if (shift1Report?.details) {
        shift1Report.details.filter(d => !d._is_meta && !d._is_inventory_snapshot).forEach(d => {
          const stdName = d.name;
          const key = d.variant && d.variant !== 'Standar' ? `${stdName} ${d.variant}` : stdName;
          s1Map[key] = d;
        });
      }

      // Map over formData.products (master list) to include all menus with Shift 1 qty
      const s1Products = (formData.products || []).map(prod => {
        const variant = prod.variant || 'Standar';
        const key = variant !== 'Standar' ? `${prod.name} ${variant}` : prod.name;
        const soldDetail = s1Map[key];
        return {
          ...prod,
          qty: soldDetail ? (soldDetail.qty || 0) : 0,
          price: soldDetail ? (soldDetail.price || prod.price) : prod.price,
          terjual_fisik: soldDetail ? (soldDetail.terjual_fisik || 0) : 0,
          terjual_pure: soldDetail ? (soldDetail.terjual_pure || 0) : 0,
          porsi_terpakai: soldDetail ? (soldDetail.porsi_terpakai || 0) : 0
        };
      });

      const s1Setoran = shift1Report.details?.find(d => d._is_meta)?.setoran_aktual ?? shift1Report.setoran_aktual;
      const s1Data = {
        date: shift1Report.date,
        staffName: shift1Report.staff_name,
        cashAwal: shift1Report.cash_awal || 0,
        products: s1Products,
        expenses: shift1Report.expenses || [],
        note: shift1Report.note || '',
        setoranAktual: s1Setoran
      };
      const wsS1 = createSalesSheetData(s1Data, branchName);
      XLSX.utils.book_append_sheet(wb, wsS1, 'Shift 1');
    }

    // 1.5. GENERATE SHIFT 2 ONLY SHEET (IF SHIFT 2)
    if (isShift2) {
      const s2Data = {
        date: formData.date,
        staffName: formData.staffName,
        cashAwal: parseInt(formData.cashAwal) || 0,
        products: formData.products,
        expenses: formData.expenses || [],
        note: formData.note || '',
        setoranAktual: formData.setoranAktual
      };
      const wsS2 = createSalesSheetData(s2Data, branchName);
      XLSX.utils.book_append_sheet(wb, wsS2, 'Shift 2');
    }

    // 2. GENERATE CONSOLIDATED SHEET (PENJUALAN)
    // Build consolidated product list
    const shift1DetailsMap = {};
    const shift1PorsiMap = {}; // Bubble dijual per PORSI terpakai, bukan qty bungkus
    if (isShift2 && shift1Report?.details) {
      shift1Report.details.filter(d => !d._is_meta && !d._is_inventory_snapshot).forEach(d => {
        const stdName = d.name;
        const key = d.variant && d.variant !== 'Standar' ? `${stdName} ${d.variant}` : stdName;
        shift1DetailsMap[key] = (shift1DetailsMap[key] || 0) + (d.qty || 0);
        shift1PorsiMap[key] = (shift1PorsiMap[key] || 0) + (parseInt(d.porsi_terpakai) || 0);
      });
    }

    const consolidatedProducts = (formData.products || []).map(prod => {
      const variant = prod.variant || 'Standar';
      const key = variant !== 'Standar' ? `${prod.name} ${variant}` : prod.name;
      const s1Qty = isShift2 ? (shift1DetailsMap[key] || 0) : 0;
      return {
        ...prod,
        qty: prod.category === 'Bahan' ? (parseInt(prod.qty) || 0) : ((parseInt(prod.qty) || 0) + s1Qty),
        terjual_pure: (parseInt(prod.terjual_pure) || 0) + s1Qty,
        porsi_terpakai: (parseInt(prod.porsi_terpakai) || 0) + (isShift2 ? (shift1PorsiMap[key] || 0) : 0)
      };
    });

    const consolidatedExpenses = [...(formData.expenses || [])];
    if (isShift2 && shift1Report?.expenses) {
      shift1Report.expenses.forEach(exp => {
        consolidatedExpenses.push({ name: `(S1) ${exp.name}`, amount: exp.amount });
      });
    }

    let combinedNote = formData.note || '';
    if (isShift2 && shift1Report?.note) {
      combinedNote = `S1: ${shift1Report.note}\nS2: ${formData.note || ''}`;
    }

    const _s1SetoranAll = isShift2 ? (shift1Report?.details?.find(d => d._is_meta)?.setoran_aktual ?? shift1Report?.setoran_aktual) : null;
    const consolidatedData = {
      date: formData.date,
      staffName: isShift2 ? `${shift1Report.staff_name} / ${formData.staffName}` : formData.staffName,
      cashAwal: isShift2 ? (shift1Report.cash_awal || 0) : (parseInt(formData.cashAwal) || 0),
      products: consolidatedProducts,
      expenses: consolidatedExpenses,
      note: combinedNote,
      // Gabungan: setoran S1 + S2 — kalau setoran S1 ga ketemu, jangan tampilkan (bakal keliatan minus palsu).
      setoranAktual: !isShift2 ? formData.setoranAktual
        : (_s1SetoranAll == null || formData.setoranAktual == null ? null : Number(_s1SetoranAll) + Number(formData.setoranAktual))
    };

    const wsConsolidated = createSalesSheetData(consolidatedData, branchName, true);
    XLSX.utils.book_append_sheet(wb, wsConsolidated, isShift2 ? 'Gabungan S1+S2' : 'Penjualan');

    // ── KARTU STOK SHEET ──
    let stockData;
    if (!formData.skipKartuStok) {
      const shift1Map = {};
      const shift1SisaMap = {};
      const shift1AwalMap = {};
      if (isShift2) {
        // Gabungan uses Shift 1 data from shift1Report if available
        if (shift1Report?.details) {
          shift1Report.details.filter(d => !d._is_meta && !d._is_inventory_snapshot).forEach(d => {
            const variant = d.variant || 'Standar';
            const key = variant !== 'Standar' ? `${d.name} ${variant}` : d.name;
            shift1Map[key] = (shift1Map[key] || 0) + ((d.terjual_fisik || d.qty) || 0);
            // Sisa display saja — jangan fallback ke d.sisa (total inventory termasuk safety)
            if (d.sisa_input !== undefined && d.sisa_input !== '' && d.sisa_input !== null) {
              shift1SisaMap[key] = parseFloat(d.sisa_input);
            } else if (d.display_awal !== undefined && d.display_awal !== null && d.display_awal !== '') {
              shift1SisaMap[key] = (parseFloat(d.display_awal) || 0) + (parseFloat(d.tambah) || 0);
            }
            if (d.display_awal !== undefined) shift1AwalMap[key] = parseFloat(d.display_awal);
          });
        }
      }

      const shift1Tambah = {};
      const shift1Pindah = {};
      if (shift1Report?.details) {
        shift1Report.details.filter(d => !d._is_meta && !d._is_inventory_snapshot).forEach(d => {
          const stdName = d.name;
          const key = d.variant && d.variant !== 'Standar' ? `${stdName} ${d.variant}` : stdName;
          shift1Tambah[key] = (shift1Tambah[key] || 0) + (d.tambah || 0);
          if (d.pindah_display) shift1Pindah[key] = (shift1Pindah[key] || 0) + Number(d.pindah_display);
        });
      }

      const shift1OpMap = {};
      if (shift1Report?.stocks) {
        shift1Report.stocks.forEach(s => {
          const stdName = s.name;
          shift1OpMap[stdName] = parseFloat(s.used !== undefined ? s.used : ((parseFloat(s.porsi_terpakai) || 0) + (parseFloat(s.porsi_rusak) || 0))) || 0;
        });
      }

      stockData = {
        date: formData.date,
        products: formData.products,
        stocks: formData.stocks,
        inventoryMap: formData.inventoryMap,
        shift1Map: shift1Map,
        shift1SisaMap: shift1SisaMap,
        shift1Tambah: shift1Tambah,
        shift1Pindah: shift1Pindah,
        shift1AwalMap: shift1AwalMap,
        shift1OpMap: shift1OpMap,
        staff1: shift1Report?.staff_name,
        staff2: formData.staffName,
        shift: formData.shift,
        shiftLogs: formData.shiftLogs,
        koreksiLogs: formData.koreksiLogs
      };

      const wsStock = createDetailedStockSheetData(stockData, branchName);

      XLSX.utils.book_append_sheet(wb, wsStock, 'Kartu Stok');
    }


    // stockData cuma ada kalau Kartu Stok dihitung (blok di atas) — Laporan Selisih butuh
    // data yang sama, jadi digantung syarat yang sama juga. Tanpa ini, skipKartuStok:true +
    // role admin/owner di shift 2 bakal crash "stockData is not defined".
    if (!formData.skipKartuStok && (formData.userRole === 'admin' || formData.userRole === 'owner') && isShift2) {
      const wsVariance = createVarianceSheetData(stockData, consolidatedProducts);
      XLSX.utils.book_append_sheet(wb, wsVariance, 'Laporan Selisih (Waste)');
    }

    const fileNameRaw = `Laporan_${branchName || 'Teiko'}_Shift${formData.shift || 'X'}_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`;

    const fileName = fileNameRaw.replace(/[^a-zA-Z0-9._ -]/g, '_');

    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(out, fileName);

  } catch (err) {
    console.error('Error in exportShiftToExcel:', err);
    alert('Maaf, terjadi kesalahan saat membuat file Excel: ' + err.message);
  }
};

/**
 * Eksport hanya Sheet Stok saja tanpa tabel penjualan.
 */
export const exportStockOnlyToExcel = (formData, branchName) => {
  try {
    // Sanitize old data to match new capitalization
    if (formData && formData.products) {
      formData.products.forEach(p => {
        if (p.name === 'Cao jelly') p.name = 'Cao Jelly';
      });
    }

    const wb = XLSX.utils.book_new();
    const stockData = {
      products: formData.products,
      stocks: formData.stocks,
      inventoryMap: formData.inventoryMap,
      staffName: formData.staffName,
      shift: formData.shift
    };

    const ws = createDetailedStockSheetData(stockData, branchName);
    XLSX.utils.book_append_sheet(wb, ws, 'Kartu Stok');

    const fileNameRaw = `KartuStok_${branchName || 'Teiko'}_Shift${formData.shift || 'X'}_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`;
    const fileName = fileNameRaw.replace(/[^a-zA-Z0-9._ -]/g, '_');

    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(out, fileName);

  } catch (err) {
    console.error('Error in exportStockOnlyToExcel:', err);
    alert('Maaf, terjadi kesalahan saat membuat file Kartu Stok: ' + err.message);
  }
};

/**
 * Eksport Kartu Stok (FORM STOK BARANG) ke file Excel terpisah (*.xlsx).
 */
export const exportKartuStok = (formData, branchName) => {
  try {
    const wb = XLSX.utils.book_new();
    const stockData = {
      products: formData.products,
      stocks: formData.stocks,
      inventoryMap: formData.inventoryMap,
      staffName: formData.staffName,
      shift: formData.shift
    };

    const ws = createDetailedStockSheetData(stockData, branchName);
    XLSX.utils.book_append_sheet(wb, ws, 'Kartu Stok');

    const fileNameRaw = `KartuStok_${branchName || 'Teiko'}_Shift${formData.shift || 'X'}_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`;
    const fileName = fileNameRaw.replace(/[^a-zA-Z0-9._ -]/g, '_');

    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(out, fileName);

  } catch (err) {
    console.error('Error in exportKartuStok:', err);
    alert('Maaf, terjadi kesalahan saat membuat file Kartu Stok: ' + err.message);
  }
};

/**
 * ============================================================================
 * EKSPORT: FORM SURAT JALAN OUTLET
 * ============================================================================
 * Dibuat otomatis pas Gudang submit Mode Pengiriman — checklist barang yang
 * dikirim ke outlet, siap dicetak buat ditandatangani fisik (Gudang/Production/
 * Delivery/Team Outlet). items: [{ name, qty }] — cuma barang yang beneran
 * dikirim di batch itu yang keisi angkanya, sisanya kosong (kayak form kertas).
 */
const createSuratJalanSheetData = (items, branchName, dateStr, teamOutletName) => {
  const wsData = [];
  const qtyMap = {};
  items.forEach(i => { qtyMap[i.name] = (qtyMap[i.name] || 0) + i.qty; });

  const spacer = () => Array(4).fill({ v: '', s: STYLE_DEFAULT });

  wsData.push([{ v: 'FORM SURAT JALAN OUTLET', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }]);
  wsData.push([{ v: 'Tanggal', s: STYLE_BOLD }, { v: dateStr, s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }]);
  wsData.push([{ v: 'Outlet Tujuan', s: STYLE_BOLD }, { v: branchName, s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }]);
  wsData.push(spacer());

  wsData.push([{ v: 'No', s: STYLE_HEADER }, { v: 'Nama Produk', s: STYLE_HEADER }, { v: 'Jumlah', s: STYLE_HEADER }, { v: 'Ceklist', s: STYLE_HEADER }]);

  let no = 1;
  EXCEL_ORDER.forEach(name => {
    const qty = qtyMap[name] || 0;
    wsData.push([
      { v: no++, s: STYLE_DEFAULT },
      { v: name, s: STYLE_LEFT },
      { v: qty > 0 ? qty : '', s: qty > 0 ? STYLE_BOLD : STYLE_DEFAULT },
      { v: '', s: STYLE_DEFAULT }
    ]);
  });

  // Barang yang dikirim tapi belum ada di daftar baku — tetep ditampilin, ga hilang.
  Object.keys(qtyMap)
    .filter(n => !EXCEL_ORDER.some(e => e.toLowerCase() === n.toLowerCase()))
    .forEach(name => {
      wsData.push([
        { v: no++, s: STYLE_DEFAULT },
        { v: name, s: STYLE_LEFT },
        { v: qtyMap[name], s: STYLE_BOLD },
        { v: '', s: STYLE_DEFAULT }
      ]);
    });

  wsData.push(spacer());

  const sigLabel = (label) => [{ v: label, s: STYLE_BOLD }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }];
  const sigNameTtd = (prefillName) => [{ v: 'Nama:', s: STYLE_LEFT }, { v: prefillName || '', s: STYLE_BOLD }, { v: 'TTD:', s: STYLE_LEFT }, { v: '', s: STYLE_DEFAULT }];

  [
    { label: 'Penanggung Jawab Gudang', name: null },
    { label: 'Mengetahui Production', name: null },
    { label: 'Delivery', name: null },
    { label: `Team Outlet ${branchName}`, name: teamOutletName },
  ].forEach(({ label, name }) => {
    wsData.push(sigLabel(label));
    wsData.push(sigNameTtd(name));
    wsData.push(spacer());
  });

  const blankBlock = (title, rows) => {
    wsData.push([{ v: title, s: STYLE_BOLD }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }]);
    for (let i = 0; i < rows; i++) wsData.push(Array(4).fill({ v: '', s: { border: BORDER_ALL } }));
  };
  blankBlock('BARANG KURANG/LEBIH:', 4);
  blankBlock('SALAH KIRIM:', 2);
  blankBlock('LAIN-LAIN:', 2);

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{ wch: 6 }, { wch: 26 }, { wch: 10 }, { wch: 10 }];
  return ws;
};

/**
 * Eksport Form Surat Jalan Outlet buat sekali kirim (Mode Pengiriman di AdminInventory).
 * items: [{ name, qty }]
 */
export const exportSuratJalan = (items, branchName, teamOutletName) => {
  try {
    if (!items || items.length === 0) return;
    const wb = XLSX.utils.book_new();
    const dateStr = format(new Date(), 'dd MMMM yyyy', { locale: id });
    const ws = createSuratJalanSheetData(items, branchName || 'Outlet', dateStr, teamOutletName);
    XLSX.utils.book_append_sheet(wb, ws, 'Surat Jalan');

    const fileNameRaw = `SuratJalan_${branchName || 'Outlet'}_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`;
    const fileName = fileNameRaw.replace(/[^a-zA-Z0-9._ -]/g, '_');

    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(out, fileName);
  } catch (err) {
    console.error('Error in exportSuratJalan:', err);
    alert('Maaf, terjadi kesalahan saat membuat Surat Jalan: ' + err.message);
  }
};

/**
 * Eksport rekapitulasi banyak shift (laporan gabungan antar shift/tanggal) ke Excel.
 */
export const exportMultipleShiftsToExcel = (reports) => {
  try {
    const wb = XLSX.utils.book_new();
    const wsData = [
      [{ v: 'REKAPITULASI PENJUALAN KESELURUHAN', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }, { v: '', s: STYLE_HEADER }],
      [{ v: 'Tanggal Export', s: STYLE_BOLD }, { v: format(new Date(), 'dd MMMM yyyy HH:mm', { locale: id }), s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }, { v: '', s: STYLE_DEFAULT }],
      [],
      [{ v: 'ID', s: STYLE_HEADER }, { v: 'Tanggal Laporan', s: STYLE_HEADER }, { v: 'Cabang', s: STYLE_HEADER }, { v: 'Shift', s: STYLE_HEADER }, { v: 'Staff', s: STYLE_HEADER }, { v: 'Total Pemasukan (Rp)', s: STYLE_HEADER }, { v: 'Total Pengeluaran (Rp)', s: STYLE_HEADER }, { v: 'Sisa Cash Setor (Rp)', s: STYLE_HEADER }]
    ];

    if (Array.isArray(reports)) {
      reports.forEach(report => {
        wsData.push([
          { v: report.id, s: STYLE_DEFAULT },
          {
            v: (() => {
              const d = new Date(report.created_at || report.date);
              return isValidDate(d) ? format(d, 'dd MMMM yyyy HH:mm', { locale: id }) : '-';
            })(), s: STYLE_DEFAULT
          },
          { v: report.branch_name, s: STYLE_DEFAULT },
          { v: report.shift, s: STYLE_DEFAULT },
          { v: report.staff_name, s: STYLE_DEFAULT },
          { v: rp(report.total_revenue), s: STYLE_DEFAULT },
          { v: rp(report.total_expense), s: STYLE_DEFAULT },
          { v: rp(report.cash_akhir), s: STYLE_DEFAULT }
        ]);
      });
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [
      { wch: 10 }, { wch: 20 }, { wch: 20 }, { wch: 10 },
      { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 20 }
    ];
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }];

    XLSX.utils.book_append_sheet(wb, ws, 'Rekap Penjualan');
    const fileName = `Rekap_Seluruh_Penjualan_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`;

    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(out, fileName);

  } catch (err) {
    console.error('Error in exportMultipleShiftsToExcel:', err);
  }
};

/**
 * Eksport riwayat aktivitas stok (Audit Trail log perpindahan & perubahan stok) ke Excel.
 */
/**
 * Eksport tabel Penyesuaian Stok (Koreksi) apa adanya ke Excel — No, Nama Produk,
 * Stok Awal, Tambah, Stok Gudang. Dipakai admin biar hasil input opname kebaca
 * di luar sistem juga, tidak cuma tersimpan di DB.
 * rows: [{ key, oldAwal, oldTambah, oldGudang, awal, tambah, gudang }]
 */
export const exportPenyesuaianToExcel = (rows, branchName, petugas) => {
  try {
    const wb = XLSX.utils.book_new();
    const wsData = [];

    wsData.push([{ v: 'FORM PENYESUAIAN STOK', s: STYLE_HEADER }, ...Array(4).fill({ v: '', s: STYLE_HEADER })]);
    wsData.push([
      { v: 'Outlet', s: STYLE_BOLD }, { v: branchName || '-', s: STYLE_DEFAULT },
      { v: 'Petugas', s: STYLE_BOLD }, { v: petugas || '-', s: STYLE_DEFAULT },
      { v: format(new Date(), 'dd MMMM yyyy HH:mm', { locale: id }), s: STYLE_DEFAULT }
    ]);
    wsData.push([]);
    wsData.push([
      { v: 'No', s: STYLE_HEADER }, { v: 'Nama Produk', s: STYLE_HEADER },
      { v: 'Stok Awal', s: STYLE_HEADER }, { v: 'Tambah', s: STYLE_HEADER }, { v: 'Stok Gudang', s: STYLE_HEADER }
    ]);

    rows.forEach((r, i) => {
      const awal = sumExpr(r.awal) ?? r.oldAwal;
      const tambah = sumExpr(r.tambah) ?? r.oldTambah;
      const gudang = sumExpr(r.gudang) ?? r.oldGudang;
      wsData.push([
        { v: i + 1, s: STYLE_DEFAULT },
        { v: r.key, s: STYLE_LEFT },
        { v: formatFraction(awal), s: STYLE_DEFAULT },
        { v: formatFraction(tambah), s: STYLE_DEFAULT },
        { v: formatFraction(gudang), s: STYLE_DEFAULT }
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [{ wch: 5 }, { wch: 28 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Penyesuaian Stok');

    const fileName = `Penyesuaian_Stok_${branchName || 'Teiko'}_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`.replace(/[^a-zA-Z0-9._ -]/g, '_');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(out, fileName);
  } catch (err) {
    console.error('Error in exportPenyesuaianToExcel:', err);
    alert('Gagal membuat file Excel: ' + err.message);
  }
};

export const exportStockHistoryToExcel = async (stockHistory, branchName, startDate, endDate) => {
  try {
    const wb = XLSX.utils.book_new();
    const wsData = [];

    wsData.push([{ v: 'RIWAYAT AKTIVITAS STOK', s: STYLE_BOLD }]);
    wsData.push([{ v: 'Outlet:', s: STYLE_BOLD }, { v: branchName || 'Semua Cabang', s: STYLE_DEFAULT }]);
    wsData.push([{ v: 'Periode:', s: STYLE_BOLD }, { v: `${startDate || '-'} s/d ${endDate || '-'}`, s: STYLE_DEFAULT }]);
    wsData.push([]);

    wsData.push([
      { v: 'Waktu', s: STYLE_HEADER },
      { v: 'Item', s: STYLE_HEADER },
      { v: 'Cabang', s: STYLE_HEADER },
      { v: 'Aktivitas', s: STYLE_HEADER },
      { v: 'Petugas', s: STYLE_HEADER },
      { v: 'Awal', s: STYLE_HEADER },
      { v: 'Perubahan', s: STYLE_HEADER },
      { v: 'Akhir', s: STYLE_HEADER }
    ]);

    stockHistory.forEach(log => {
      const isAddition = log.qty_added > 0;
      wsData.push([
        { v: format(new Date(log.created_at), 'dd MMM yyyy HH:mm', { locale: id }), s: STYLE_DEFAULT },
        { v: log.item_name, s: STYLE_DEFAULT },
        { v: log.branch_name || '-', s: STYLE_DEFAULT },
        { v: log.petugas_name?.toLowerCase().includes('buka') ? 'Buka Outlet' : log.petugas_name?.toLowerCase().includes('tutup') ? 'Tutup Outlet' : 'Aktivitas', s: STYLE_DEFAULT },
        { v: log.petugas_name, s: STYLE_DEFAULT },
        { v: log.qty_before, s: STYLE_DEFAULT },
        { v: (isAddition ? '+' : '') + log.qty_added, s: STYLE_DEFAULT },
        { v: log.qty_after, s: STYLE_DEFAULT }
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [
      { wch: 18 }, { wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 20 }, { wch: 10 }, { wch: 12 }, { wch: 10 }
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Riwayat Stok');

    const fileName = `Riwayat_Stok_${branchName || 'Semua'}_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`;
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(out, fileName.replace(/[^a-zA-Z0-9._ -]/g, '_'));
  } catch (e) {
    console.error('Failed to export shift', e); alert('Gagal download excel: ' + e.message);
    alert('Gagal mendownload Excel: ' + e.message + '\n\nSilakan lapor ke tim teknis.');
  }
};





