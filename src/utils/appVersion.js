// Tab HP yang tak pernah di-refresh bisa jalan pakai app versi lama berhari-hari (CS 9 Okt:
// Tutup Shift dari build pra-29 Sep, potong stok terlewat). Bandingkan bundle yang sedang jalan
// dengan yang dirujuk index.html di server; beda = ada deploy baru.
const myBundle = document.querySelector('script[type="module"][src*="/assets/index-"]')?.getAttribute('src');

export const isStaleBuild = async () => {
  if (!myBundle) return false; // dev server — tak ada bundle hash
  try {
    const html = await (await fetch('/', { cache: 'no-store' })).text();
    return !html.includes(myBundle);
  } catch {
    return false; // offline — biar pre-flight koneksi yang menangani
  }
};

// Tiap tab aktif lagi (HP dibuka dari layar kunci), muat ulang kalau versinya basi.
// Draft isian tersimpan otomatis di localStorage, jadi aman.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && await isStaleBuild()) window.location.reload();
});
