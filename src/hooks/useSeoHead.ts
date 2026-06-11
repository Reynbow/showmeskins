/**
 * Updates document head for SEO (meta tags, title).
 * Invisible to users; for search engines and bots only.
 */
import { useEffect } from 'react';

const SITE_NAME = 'x9report.com';
const BASE_DESCRIPTION = '3D League of Legends skin viewer.';
const DEFAULT_OG_IMAGE_PATH = '/og.png';

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
  imageUrl,
}: {
  title: string;
  description: string;
  path?: string;
  imageUrl?: string;
}) {
  useEffect(() => {
    document.title = title;
    setMeta('description', description);
    setMeta('og:title', title, true);
    setMeta('og:description', description, true);
    setMeta('og:type', 'website', true);

    const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://x9report.com';
    setMeta('og:url', `${baseUrl}${path}`, true);

    const resolvedImage = imageUrl
      ? (imageUrl.startsWith('http') ? imageUrl : `${baseUrl}${imageUrl}`)
      : `${baseUrl}${DEFAULT_OG_IMAGE_PATH}`;

    setMeta('og:image', resolvedImage, true);
    setMeta('twitter:card', 'summary_large_image');
    setMeta('twitter:title', title);
    setMeta('twitter:description', description);
    setMeta('twitter:image', resolvedImage);

    setJsonLd({
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: SITE_NAME,
      description: BASE_DESCRIPTION,
      url: baseUrl ? `${baseUrl}${path}` : undefined,
      image: resolvedImage,
    });
  }, [title, description, path, imageUrl]);
}
