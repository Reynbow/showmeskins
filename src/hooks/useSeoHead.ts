/**
 * Updates document head for SEO (meta tags, title).
 * Invisible to users; for search engines and bots only.
 */
import { useEffect } from 'react';

const SITE_NAME = 'Show Me Skins';
const BASE_DESCRIPTION = 'Browse and view League of Legends champion skins in 3D.';

function setMeta(name: string, content: string, isProperty = false) {
  const attr = isProperty ? 'property' : 'name';
  let el = document.querySelector(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setJsonLd(data: object) {
  let el = document.getElementById('seo-json-ld') as HTMLScriptElement | null;
  if (!el) {
    el = document.createElement('script');
    el.id = 'seo-json-ld';
    el.type = 'application/ld+json';
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

export function useSeoHead({
  title,
  description,
  path = '/',
}: {
  title: string;
  description: string;
  path?: string;
}) {
  useEffect(() => {
    document.title = title;
    setMeta('description', description);
    setMeta('og:title', title, true);
    setMeta('og:description', description, true);
    setMeta('og:type', 'website', true);

    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    if (baseUrl) {
      setMeta('og:url', `${baseUrl}${path}`, true);
    }

    setJsonLd({
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: SITE_NAME,
      description: BASE_DESCRIPTION,
      url: baseUrl ? `${baseUrl}${path}` : undefined,
    });
  }, [title, description, path]);
}
