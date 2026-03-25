import { useEffect, useState } from 'react';
import type { AppSnapshot } from '../types.js';
import { Store } from '../state/store.js';

export function useStoreSnapshot(store: Store): AppSnapshot {
  const [snapshot, setSnapshot] = useState(() => store.snapshot());

  useEffect(() => store.subscribe((nextSnapshot) => {
    setSnapshot(nextSnapshot);
  }), [store]);

  return snapshot;
}
