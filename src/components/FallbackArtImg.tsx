import { useState, useCallback, useRef, useEffect, useMemo } from 'react';

/** Timeout (ms) before advancing to the next fallback URL */
const ART_LOAD_TIMEOUT = 4000;

/**
 * Art image with timeout-based fallback chain.
 * Cycles through `urls` on error or if an image takes too long to load.
 * Duplicate URLs are automatically removed so the browser never silently
 * skips a re-load attempt (React won't update `src` if the value is unchanged).
 * When all URLs are exhausted (error or timeout on the last one), the
 * component calls `onLoaded` so the parent can dismiss any loading state.
 */
export function FallbackArtImg({
  urls,
  alt,
  className,
  onLoaded,
}: {
  urls: string[];
  alt: string;
  className: string;
  onLoaded?: () => void;
}) {
  // Stabilise the url list so a new array reference with identical entries
  // doesn't reset the fallback state. Also deduplicate so that identical
  // consecutive (or non-consecutive) URLs don't cause silent skips when
  // React declines to update the DOM `src` attribute.
  const urlKey = urls.join('\n');
  const stableUrls = useMemo(() => {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const u of urls) {
      if (!seen.has(u)) {
        seen.add(u);
        unique.push(u);
      }
    }
    return unique;
  }, [urlKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [urlIdx, setUrlIdx] = useState(0);
  const loadedRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Reset when the actual URL values change (not just the array reference)
  useEffect(() => {
    setUrlIdx(0);
    loadedRef.current = false;
  }, [urlKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Mark as done (loaded or exhausted) and notify parent */
  const finish = useCallback(() => {
    if (loadedRef.current) return;
    clearTimeout(timeoutRef.current);
    loadedRef.current = true;
    onLoaded?.();
  }, [onLoaded]);

  // Timeout: advance to next URL, or finish if all URLs are exhausted
  useEffect(() => {
    if (loadedRef.current) return;
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (loadedRef.current) return;
      if (urlIdx >= stableUrls.length - 1) {
        finish();
      } else {
        setUrlIdx(urlIdx + 1);
      }
    }, ART_LOAD_TIMEOUT);
    return () => clearTimeout(timeoutRef.current);
  }, [urlIdx, stableUrls.length, stableUrls, alt, finish]);

  const advance = useCallback(() => {
    if (loadedRef.current) return;
    clearTimeout(timeoutRef.current);
    if (urlIdx >= stableUrls.length - 1) {
      finish();
      return;
    }
    setUrlIdx(urlIdx + 1);
  }, [urlIdx, stableUrls.length, finish]);

  return (
    <img
      className={className}
      src={stableUrls[urlIdx]}
      alt={alt}
      loading="eager"
      onError={advance}
      onLoad={finish}
    />
  );
}
