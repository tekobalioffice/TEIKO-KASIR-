import { useState, useEffect } from 'react';

// Sama pola kayak useLocalStorageBranch — tanggal yang dipilih admin ga boleh balik
// ke hari ini pas reload, ikut kesimpen per-key (biar beda halaman ga rebutan).
export function useLocalStorageDate(storageKey, defaultValue = '') {
  const [selectedDate, setSelectedDateState] = useState(() => {
    const saved = localStorage.getItem(storageKey);
    return saved || defaultValue;
  });

  useEffect(() => {
    if (selectedDate) {
      localStorage.setItem(storageKey, selectedDate);
    }
  }, [storageKey, selectedDate]);

  return [selectedDate, setSelectedDateState];
}
