import { useState, useEffect } from 'react';
import type { ChampionBasic, LiveGamePlayer } from '../types';
import {
  getModelUrl,
  resolveLcuSkinNum,
  resolveChromaTextureUrl,
} from '../api';

/**
 * Resolves model URL and chroma texture for a live game player.
 * Uses resolveLcuSkinNum to detect chromas and always loads the base skin's
 * 3D model (chromas share the base skin's geometry, only the texture differs).
 */
export function usePlayerModelInfo(
  player: LiveGamePlayer | undefined,
  champions: ChampionBasic[],
): {
  modelUrl: string;
  fallbackUrl: string;
  chromaTextureUrl: string | undefined;
  championId: string;
} | null {
  const [result, setResult] = useState<{
    modelUrl: string;
    fallbackUrl: string;
    chromaTextureUrl: string | undefined;
    championId: string;
  } | null>(null);

  useEffect(() => {
    if (!player) {
      setResult(null);
      return;
    }
    const match = champions.find(
      (c) => c.name.toLowerCase() === player.championName.toLowerCase(),
    );
    if (!match) {
      setResult(null);
      return;
    }

    let cancelled = false;
    const championKey = match.key;
    const championId = match.id;
    const championKeyNum = parseInt(championKey, 10);
    const baseChampSkinId = `${championKeyNum * 1000}`;

    resolveLcuSkinNum(championKey, player.skinID)
      .then((resolution) => {
        if (cancelled) return;
        const baseSkinId = resolution?.baseSkinId ?? `${championKeyNum * 1000 + player.skinID}`;
        const modelUrl = getModelUrl(championId, baseSkinId);
        const fallbackUrl = baseSkinId !== baseChampSkinId ? getModelUrl(championId, baseChampSkinId) : modelUrl;

        if (resolution?.chromaId) {
          resolveChromaTextureUrl(championId, resolution.chromaId).then(
            (chromaUrl) => {
              if (cancelled) return;
              setResult({
                modelUrl,
                fallbackUrl,
                chromaTextureUrl: chromaUrl ?? undefined,
                championId,
              });
            },
          );
        } else {
          setResult({
            modelUrl,
            fallbackUrl,
            chromaTextureUrl: undefined,
            championId,
          });
        }
      })
      .catch(() => {
        if (cancelled) return;
        const skinId = `${championKeyNum * 1000 + player.skinID}`;
        setResult({
          modelUrl: getModelUrl(championId, skinId),
          fallbackUrl: skinId !== baseChampSkinId ? getModelUrl(championId, baseChampSkinId) : getModelUrl(championId, baseChampSkinId),
          chromaTextureUrl: undefined,
          championId,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [player?.championName, player?.skinID, champions]);

  return result;
}
