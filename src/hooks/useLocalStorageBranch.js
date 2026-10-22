import { useState, useEffect } from 'react';

export function useLocalStorageBranch(defaultValue = '') {
  // Try to load from localStorage first
  const [selectedBranch, setSelectedBranchState] = useState(() => {
    const saved = localStorage.getItem('lastSelectedBranch');
    return saved || defaultValue;
  });

  // Whenever selectedBranch changes, save it to localStorage
  useEffect(() => {
    if (selectedBranch) {
      localStorage.setItem('lastSelectedBranch', selectedBranch);
    }
  }, [selectedBranch]);

  return [selectedBranch, setSelectedBranchState];
}
