import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Inject page-scoped JSON-LD structured data (schema.org) into <head>.
 * Pass a falsy value while data loads; the block is removed on unmount.
 * Keyed on the serialized JSON so re-renders with equal data are free.
 */
export function useJsonLd(data: object | null | undefined | false): void {
  const json = data ? JSON.stringify(data) : null;
  useEffect(() => {
    if (!json) return;
    let el = document.head.querySelector<HTMLScriptElement>('script[data-page-jsonld]');
    if (!el) {
      el = document.createElement('script');
      el.type = 'application/ld+json';
      el.setAttribute('data-page-jsonld', '1');
      document.head.appendChild(el);
    }
    el.textContent = json;
    return () => {
      document.head.querySelector('script[data-page-jsonld]')?.remove();
    };
  }, [json]);
}

/**
 * Normalize the address bar to the entity's canonical slugged path
 * (e.g. /song/abc123 → /song/pretty-title-abc123) once the entity is known.
 * History-replace: back button, query params and player state are unaffected.
 */
export function useCanonicalRedirect(path: string | null | undefined): void {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (path && location.pathname !== path) {
      navigate({ pathname: path, search: location.search, hash: location.hash }, { replace: true });
    }
  }, [path, location.pathname, location.search, location.hash, navigate]);
}
