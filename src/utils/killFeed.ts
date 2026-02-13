import type { KillEvent, MultiKillType, KillStreakType, KillEventPlayerSnapshot, LiveGamePlayer } from '../types';

/** League uses ~10 seconds for multi-kill timing */
const MULTI_KILL_WINDOW_SEC = 10;

/**
 * Computes announcer-style labels from raw kill events:
 * - multi-kill (double/triple/quadra/penta)
 * - kill streak (killing_spree/rampage/unstoppable/godlike/legendary)
 * - first blood, shutdown, ace, execute
 */
export function enrichKillFeed(
  kills: KillEvent[],
  players?: LiveGamePlayer[],
  killFeedSnapshots?: Record<number, KillEventPlayerSnapshot>,
): KillEvent[] {
  if (kills.length === 0) return [];

  // Sort by eventTime ascending for chronological processing.
  const sorted = [...kills].sort((a, b) => a.eventTime - b.eventTime);

  // Track current "kills without dying" streak per player.
  const currentKillStreakByPlayer: Record<string, number> = {};
  // Track rolling multi-kill chain state per player.
  const multiKillChainByPlayer: Record<string, { count: number; lastKillTime: number }> = {};
  // Track how many times each (player, tag) has occurred this game.
  const multiKillCountByPlayer: Record<string, number> = {};
  const killStreakCountByPlayer: Record<string, number> = {};

  const teamByPlayer: Record<string, 'ORDER' | 'CHAOS'> = {};
  for (const p of players ?? []) teamByPlayer[p.summonerName] = p.team;

  let firstBloodAssigned = false;
  const enriched: KillEvent[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const kill = { ...sorted[i] };

    const isPlayerKill = !kill.killerChamp.startsWith('_');
    const isPlayerVictim = !kill.victimChamp.startsWith('_');
    const isPlayerPvPKill = isPlayerKill && isPlayerVictim;

    // Execute: champion died to non-player source with no assisting champions.
    if (!isPlayerKill && isPlayerVictim && kill.assisters.length === 0) {
      kill.execute = true;
    }

    if (isPlayerPvPKill) {
      if (!firstBloodAssigned) {
        kill.firstBlood = true;
        firstBloodAssigned = true;
      }

      // Shutdown: victim had an active kill streak of 3+ before this death.
      const victimStreakBeforeDeath = currentKillStreakByPlayer[kill.victimName] ?? 0;
      if (victimStreakBeforeDeath >= 3) {
        kill.shutdown = true;
      }

      // Multi-kill chain: compare with THIS killer's previous kill time.
      const chain = multiKillChainByPlayer[kill.killerName];
      const multiCount = chain && (kill.eventTime - chain.lastKillTime) <= MULTI_KILL_WINDOW_SEC
        ? chain.count + 1
        : 1;
      multiKillChainByPlayer[kill.killerName] = { count: multiCount, lastKillTime: kill.eventTime };

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

      // True kill streak (kills without dying).
      currentKillStreakByPlayer[kill.killerName] = (currentKillStreakByPlayer[kill.killerName] ?? 0) + 1;
      const streak = currentKillStreakByPlayer[kill.killerName];
      const streakMap: Record<number, KillStreakType> = {
        3: 'killing_spree',
        4: 'rampage',
        5: 'unstoppable',
        6: 'godlike',
        7: 'legendary',
      };
      if (streakMap[streak]) {
        kill.killStreak = streakMap[streak];
        const key = `${kill.killerName}:${kill.killStreak}`;
        killStreakCountByPlayer[key] = (killStreakCountByPlayer[key] ?? 0) + 1;
        kill.killStreakCount = killStreakCountByPlayer[key];
      }

      // Ace: requires team mapping and a snapshot taken at this kill time.
      const snapshot = killFeedSnapshots?.[kill.eventTime];
      const victimTeam = teamByPlayer[kill.victimName];
      if (snapshot && victimTeam) {
        const enemyPlayers = (players ?? []).filter((p) => p.team === victimTeam);
        if (enemyPlayers.length > 0) {
          const allEnemyDead = enemyPlayers.every((p) => snapshot.byName[p.summonerName]?.isDead === true);
          if (allEnemyDead) kill.ace = true;
        }
      }
    }

    if (isPlayerVictim) {
      // Death resets streak tracking for that player.
      currentKillStreakByPlayer[kill.victimName] = 0;
    }

    enriched.push(kill);
  }

  return enriched;
}
