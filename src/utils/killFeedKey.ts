import type { KillEvent } from '../types';

function baseKillKey(kill: KillEvent): string {
  return [
    kill.eventTime,
    kill.killerName,
    kill.victimName,
    kill.killerChamp,
    kill.victimChamp,
    kill.assisters.join(','),
  ].join('|');
}

/**
 * Build stable keys for a full kill-feed list.
 * If multiple kills share the same base identity, append an occurrence index.
 */
export function buildKillEventKeys(kills: KillEvent[]): string[] {
  const seen: Record<string, number> = {};
  return kills.map((kill) => {
    const base = baseKillKey(kill);
    seen[base] = (seen[base] ?? 0) + 1;
    return `${base}|${seen[base]}`;
  });
}
