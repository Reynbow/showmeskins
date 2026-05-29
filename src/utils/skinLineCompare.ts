import type { SkinLineCategory, SkinLineMember } from '../types';

export function buildSkinIdToLineIds(catalog: SkinLineCategory[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const line of catalog) {
    for (const member of line.members) {
      const existing = map.get(member.skinId) ?? [];
      if (!existing.includes(line.id)) {
        map.set(member.skinId, [...existing, line.id]);
      }
    }
  }
  return map;
}

export function lineIdsForSkinIds(skinIds: Iterable<string>, skinIdToLines: Map<string, number[]>): Set<number> {
  const out = new Set<number>();
  for (const skinId of skinIds) {
    for (const lineId of skinIdToLines.get(skinId) ?? []) {
      out.add(lineId);
    }
  }
  return out;
}

export function intersectSets<T>(sets: Set<T>[]): Set<T> {
  if (sets.length === 0) return new Set();
  const [first, ...rest] = sets;
  const result = new Set<T>();
  for (const value of first) {
    if (rest.every((s) => s.has(value))) result.add(value);
  }
  return result;
}

export interface TeamLineMatch {
  line: SkinLineCategory;
  /** Per-player skins in this line (from their owned/seen set) */
  byPlayer: SkinLineMember[][];
}

export function computeSharedSkinLines(
  catalog: SkinLineCategory[],
  playerSkinIds: string[][],
): { fullTeam: TeamLineMatch[]; nearTeam: { line: SkinLineCategory; count: number; total: number }[] } {
  const skinIdToLines = buildSkinIdToLineIds(catalog);
  const memberBySkinId = new Map<string, SkinLineMember>();
  for (const line of catalog) {
    for (const m of line.members) {
      memberBySkinId.set(m.skinId, m);
    }
  }

  const playerLineSets = playerSkinIds.map((ids) => lineIdsForSkinIds(ids, skinIdToLines));
  const sharedLineIds = intersectSets(playerLineSets);
  const totalPlayers = playerSkinIds.length;

  const fullTeam: TeamLineMatch[] = [];
  for (const line of catalog) {
    if (!sharedLineIds.has(line.id)) continue;
    const byPlayer: SkinLineMember[][] = playerSkinIds.map((ids) => {
      const idSet = new Set(ids);
      return line.members.filter((m) => idSet.has(m.skinId));
    });
    fullTeam.push({ line, byPlayer });
  }
  fullTeam.sort((a, b) => b.line.members.length - a.line.members.length);

  const nearTeam: { line: SkinLineCategory; count: number; total: number }[] = [];
  if (totalPlayers > 1) {
    for (const line of catalog) {
      let count = 0;
      for (const lineSet of playerLineSets) {
        if (lineSet.has(line.id)) count++;
      }
      if (count >= totalPlayers - 1 && count < totalPlayers) {
        nearTeam.push({ line, count, total: totalPlayers });
      }
    }
    nearTeam.sort((a, b) => b.count - a.count || b.line.members.length - a.line.members.length);
  }

  return { fullTeam, nearTeam };
}
