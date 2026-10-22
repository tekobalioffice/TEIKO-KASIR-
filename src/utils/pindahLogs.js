// Qty "Pindah Stok -> Display" bersih per item dari log stock_restock_log (dipakai Excel, laporan shift, Awal).
// Aturan:
//  - Log staff "(Pindah ke Display)" dihitung apa adanya, KECUALI item itu punya log admin [PERBAIKI]
//    (panel Perbaiki Stok ke Display di Penyesuaian Stok) -> yang dihitung hanya [PERBAIKI].
//  - [PERBAIKI] yang dibuat SEBELUM Koreksi terakhir item itu tidak dihitung: Koreksi (Ambil Stok Kemarin /
//    isi manual) mereset Display & Stok, jadi pindahan lamanya sudah terhapus dan perlu dipindah lagi.
// logs: [{ item_name, qty_added, petugas_name, created_at }]; koreksiLogs: log "(Koreksi)" (boleh terpisah dari logs).
export const pindahByItem = (logs = [], koreksiLogs = []) => {
  const t = l => new Date(l.created_at).getTime() || 0;
  const lastKor = {};
  [...logs, ...koreksiLogs].forEach(l => {
    if ((l.petugas_name || '').includes('(Koreksi)')) lastKor[l.item_name] = Math.max(lastKor[l.item_name] || 0, t(l));
  });
  const fixItems = new Set(logs.filter(l => (l.petugas_name || '').includes('[PERBAIKI]')).map(l => l.item_name));
  const out = {};
  logs.forEach(l => {
    const pet = l.petugas_name || '';
    const isFix = pet.includes('[PERBAIKI]');
    if (isFix ? t(l) > (lastKor[l.item_name] || 0) : (pet.includes('(Pindah ke Display)') && !fixItems.has(l.item_name))) {
      out[l.item_name] = (out[l.item_name] || 0) + Math.abs(Number(l.qty_added) || 0);
    }
  });
  return out;
};
