import { useEffect } from 'react';
import { useUiStore } from '@/store/uiStore';

const APP_NAME = import.meta.env.VITE_APP_NAME || 'VinaX';

export function usePageTitle(title?: string): void {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
    // 1.15 — the sticky top bar shows the page's name once it scrolls.
    useUiStore.getState().setPage({ pageTitle: title || null });
    return () => {
      document.title = APP_NAME;
      useUiStore.getState().setPage({ pageTitle: null });
    };
  }, [title]);
}
