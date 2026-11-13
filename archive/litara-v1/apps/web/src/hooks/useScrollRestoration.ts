import { useCallback } from 'react';
import { useLocation } from 'react-router-dom';

export function useScrollRestoration() {
  const location = useLocation();
  const storageKey = `scroll:${location.pathname}`;

  const saveScroll = useCallback(() => {
    sessionStorage.setItem(storageKey, String(window.scrollY));
  }, [storageKey]);

  const restoreScroll = useCallback(() => {
    const saved = sessionStorage.getItem(storageKey);
    if (!saved) return;
    const y = parseInt(saved, 10);
    sessionStorage.removeItem(storageKey);
    requestAnimationFrame(() => {
      window.scrollTo({ top: y, behavior: 'instant' });
    });
  }, [storageKey]);

  return { saveScroll, restoreScroll, pathname: location.pathname };
}
