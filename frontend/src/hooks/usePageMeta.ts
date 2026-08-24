import { useEffect } from 'react';

const APP_NAME = import.meta.env.VITE_APP_NAME || 'VinaX';
const DEFAULT_DESCRIPTION = 'Music tuned to you. No login, private by design.';

function setMeta(attr: 'name' | 'property', key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setCanonical(href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.rel = 'canonical';
    document.head.appendChild(el);
  }
  el.href = href;
}

/**
 * Per-page SEO + social meta. Sets the document title, description, canonical,
 * and Open Graph / Twitter tags so each song (and other entity) page is
 * shareable and indexable. Resets the title on unmount.
 */
export function usePageMeta(opts: {
  title?: string;
  description?: string;
  image?: string;
  type?: string;
  /** Site-absolute canonical path (e.g. from songPath()) — overrides the current URL. */
  canonicalPath?: string;
}): void {
  const { title, description, image, type, canonicalPath } = opts;
  useEffect(() => {
    const fullTitle = title ? `${title} · ${APP_NAME}` : APP_NAME;
    const desc = description || DEFAULT_DESCRIPTION;
    const url = canonicalPath ? `https://www.sirimillavinay.online${canonicalPath}` : window.location.href.split('?')[0];
    document.title = fullTitle;
    setMeta('name', 'description', desc);
    setMeta('property', 'og:title', fullTitle);
    setMeta('property', 'og:description', desc);
    setMeta('property', 'og:type', type || 'website');
    setMeta('property', 'og:url', url);
    setMeta('name', 'twitter:card', image ? 'summary_large_image' : 'summary');
    setMeta('name', 'twitter:title', fullTitle);
    setMeta('name', 'twitter:description', desc);
    if (image) {
      setMeta('property', 'og:image', image);
      setMeta('name', 'twitter:image', image);
    }
    setCanonical(url);
    return () => {
      document.title = APP_NAME;
    };
  }, [title, description, image, type, canonicalPath]);
}
