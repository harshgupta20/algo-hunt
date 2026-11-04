'use client';

import { useEffect, useLayoutEffect, useState } from 'react';
import { DEFAULT_LOOK, readStoredLook, setLook, type Look } from './look';

/** Re-applies the stored look after hydration (React's dev-only StrictMode remount can reset <html> attributes). */
export function LookSync(): null {
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-look', readStoredLook());
  }, []);
  return null;
}

/** The look on screen and a setter (Settings → Appearance). */
export function useLook(): [Look, (look: Look) => void] {
  const [look, set] = useState<Look>(DEFAULT_LOOK);
  useEffect(() => set(readStoredLook()), []);
  return [
    look,
    (next: Look) => {
      setLook(next);
      set(next);
    },
  ];
}
