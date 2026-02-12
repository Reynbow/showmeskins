import type { KillEvent, MultiKillType, KillStreakType } from '../types';

/** League uses ~10 seconds for multi-kill timing */
const MULTI_KILL_WINDOW_SEC = 10;

/**
 * Computes multi-kill (double/triple/quadra/penta) and kill-streak
 * (killing_spree/rampage/unstoppable/godlike/legendary) from raw kill events.
 * Only applies to player kills (skips turrets, minions, monsters).
 */
export function enrichKillFeed(kills: KillEvent[]): KillEvent[] {
  if (kills.length === 0) return [];

  // Sort by eventTime ascending for chronological processing
  const sorted = [...kills].sort((a, b) => a.eventTime - b.eventTime);

  // Track kills/deaths per player (summoner name) as we process
  const killsByPlayer: Record<string, number> = {};
  const deathsByPlayer: Record<string, number> = {};
  // Track how many times each (player, tag) has occurred this game
  const multiKillCountByPlayer: Record<string, number> = {};
  const killStreakCountByPlayer: Record<string, number> = {};

  const enriched: KillEvent[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const kill = { ...sorted[i] };

    const isPlayerKill = !kill.killerChamp.startsWith('_');
    const isPlayerVictim = !kill.victimChamp.startsWith('_');

    if (isPlayerKill) {
      // Initialize if needed
      killsByPlayer[kill.killerName] ??= 0;
      deathsByPlayer[kill.killerName] ??= 0;
      killsByPlayer[kill.killerName]++;

      // Multi-kill: how many kills did this player get in the last MULTI_KILL_WINDOW_SEC?
      let multiCount = 1;
      for (let j = i - 1; j >= 0 && sorted[j].eventTime >= kill.eventTime - MULTI_KILL_WINDOW_SEC; j--) {
        const prev = sorted[j];
        if (prev.killerName === kill.killerName && !prev.killerChamp.startsWith('_')) {
          multiCount++;
        }
      }

      const multiKillMap: Record<number, MultiKillType> = {
        2: 'double',
        3: 'triple',
        4: 'quadra',
        5: 'penta',
      };
      if (multiCount >= 2 && multiCount <= 5) {
        kill.multiKill = multiKillMap[multiCount];
        const key = `${kill.killerName}:${kill.multiKill}`;
        multiKillCountByPlayer[key] = (multiKillCountByPlayer[key] ?? 0) + 1;
        kill.multiKillCount = multiKillCountByPlayer[key];
      }

      // Kill streak: total kills minus deaths at time of this kill (before victim's death is counted)
      const totalKills = killsByPlayer[kill.killerName];
      const totalDeaths = deathsByPlayer[kill.killerName];
      const streak = totalKills - totalDeaths; // kills without dying

      const streakMap: Record<number, KillStreakType> = {
        3: 'killing_spree',
        4: 'rampage',
        5: 'unstoppable',
        6: 'godlike',
        7: 'legendary',
      };
      if (streak >= 3) {
        kill.killStreak = streakMap[Math.min(streak, 7)] ?? 'legendary';
        const key = `${kill.killerName}:${kill.killStreak}`;
        killStreakCountByPlayer[key] = (killStreakCountByPlayer[key] ?? 0) + 1;
        kill.killStreakCount = killStreakCountByPlayer[key];
      }
    }

    if (isPlayerVictim) {
      deathsByPlayer[kill.victimName] ??= 0;
      deathsByPlayer[kill.victimName]++;
    }

    enriched.push(kill);
  }

  return enriched;
}
