import type { KillEvent, MultiKillType, KillStreakType, KillEventPlayerSnapshot, LiveGamePlayer, LiveGameEvent } from '../types';

/** Fallback window when no Riot API Multikill events are available (e.g. post-game). */
const MULTI_KILL_WINDOW_SEC = 10;

/**
 * Build a lookup of Riot API Multikill events keyed by "killerName:eventTime".
 * The API fires a Multikill event alongside each qualifying ChampionKill,
 * with killStreak = 2 (double), 3 (triple), 4 (quadra), 5 (penta).
 */
function buildMultiKillLookup(liveEvents: LiveGameEvent[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const ev of liveEvents) {
    if (ev.eventName === 'Multikill' && ev.killerName && ev.killStreak) {
      map.set(`${ev.killerName}:${ev.eventTime}`, ev.killStreak);
    }
  }
  return map;
}

/**
 * Build a set of "killerName:eventTime" keys from Riot API Ace events.
 */
function buildAceLookup(liveEvents: LiveGameEvent[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const ev of liveEvents) {
    if (ev.eventName === 'Ace' && ev.acer) {
      map.set(ev.eventTime, ev.acer);
    }
  }
  return map;
}

/**
 * Computes announcer-style labels from raw kill events:
 * - multi-kill (double/triple/quadra/penta)
 * - kill streak (killing_spree/rampage/unstoppable/godlike/legendary)
 * - first blood, shutdown, ace, execute
 *
 * When liveEvents are provided (live game), authoritative Multikill / Ace /
 * FirstBlood events from the Riot API are used instead of heuristics.
 */
export function enrichKillFeed(
  kills: KillEvent[],
  players?: LiveGamePlayer[],
  killFeedSnapshots?: Record<number, KillEventPlayerSnapshot>,
  liveEvents?: LiveGameEvent[],
): KillEvent[] {
  if (kills.length === 0) return [];

  // Sort by eventTime ascending for chronological processing.
  const sorted = [...kills].sort((a, b) => a.eventTime - b.eventTime);

  // Build lookups from Riot API announcer events when available.
  const hasApiEvents = liveEvents && liveEvents.length > 0;
  const multiKillLookup = hasApiEvents ? buildMultiKillLookup(liveEvents) : null;
  const aceLookup = hasApiEvents ? buildAceLookup(liveEvents) : null;
  const apiFirstBloodRecipient = hasApiEvents
    ? liveEvents.find((ev) => ev.eventName === 'FirstBlood')?.recipient ?? null
    : null;

  // Track current "kills without dying" streak per player.
  const currentKillStreakByPlayer: Record<string, number> = {};
  // Track rolling multi-kill chain state per player (fallback heuristic).
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
      // First blood: use Riot API event when available, else first PvP kill.
      if (!firstBloodAssigned) {
        if (apiFirstBloodRecipient) {
          if (kill.killerName === apiFirstBloodRecipient) {
            kill.firstBlood = true;
            firstBloodAssigned = true;
          }
        } else {
          kill.firstBlood = true;
          firstBloodAssigned = true;
        }
      }

      // Shutdown: victim had an active kill streak of 3+ before this death.
      const victimStreakBeforeDeath = currentKillStreakByPlayer[kill.victimName] ?? 0;
      if (victimStreakBeforeDeath >= 3) {
        kill.shutdown = true;
      }

      // Multi-kill: prefer Riot API Multikill event, fall back to time-window heuristic.
      const apiMultiCount = multiKillLookup?.get(`${kill.killerName}:${kill.eventTime}`);
      let multiCount: number;
      if (apiMultiCount !== undefined) {
        multiCount = apiMultiCount;
        // Keep fallback chain in sync so it stays correct if API events stop.
        multiKillChainByPlayer[kill.killerName] = { count: multiCount, lastKillTime: kill.eventTime };
      } else {
        const chain = multiKillChainByPlayer[kill.killerName];
        multiCount = chain && (kill.eventTime - chain.lastKillTime) <= MULTI_KILL_WINDOW_SEC
          ? chain.count + 1
          : 1;
        multiKillChainByPlayer[kill.killerName] = { count: multiCount, lastKillTime: kill.eventTime };
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

      // Ace: prefer Riot API Ace event, fall back to snapshot heuristic.
      const acePlayer = aceLookup?.get(kill.eventTime);
      if (acePlayer && acePlayer === kill.killerName) {
        kill.ace = true;
      } else if (!aceLookup) {
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
    }

    if (isPlayerVictim) {
      // Death resets streak tracking for that player.
      currentKillStreakByPlayer[kill.victimName] = 0;
    }

    enriched.push(kill);
  }

  return enriched;
}
