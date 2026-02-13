import { useState, useCallback, useMemo, useRef, useEffect, Suspense, Component, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import type { LiveGameData, LiveGamePlayer, KillEvent, KillEventPlayerSnapshot, ChampionBasic, ItemInfo, PlayerPosition, ChampionStats } from '../types';
import { getChampionDetail, getChampionScale, FRIGHT_NIGHT_BASE_SKIN_IDS, getLoadingArt, getLoadingArtFallback } from '../api';
import { enrichKillFeed } from '../utils/killFeed';
import { usePlayerModelInfo } from '../hooks/usePlayerModelInfo';
import { ItemTooltip } from './ItemTooltip';
import { TextTooltip } from './TextTooltip';
import './LiveGamePage.css';

interface Props {
  data: LiveGameData;
  champions: ChampionBasic[];
  version: string;
  itemData: Record<number, ItemInfo>;
  onBack: () => void;
}

/* ── Role ordering & icons ───────────────────────────────────────────── */

const ROLE_ORDER: Record<string, number> = {
  TOP: 0, JUNGLE: 1, MIDDLE: 2, BOTTOM: 3, UTILITY: 4,
};

function sortByRole<T extends { position: PlayerPosition }>(players: T[]): T[] {
  return [...players].sort((a, b) => (ROLE_ORDER[a.position] ?? 99) - (ROLE_ORDER[b.position] ?? 99));
}

const ROLE_ICON_URL: Record<string, string> = {
  TOP: 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-top-hover.png',
  JUNGLE: 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-jungle-hover.png',
  MIDDLE: 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-middle-hover.png',
  BOTTOM: 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-bottom-hover.png',
  UTILITY: 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-utility-hover.png',
};

const ROLE_LABELS: Record<string, string> = {
  TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'Bot', UTILITY: 'Support',
};

const MULTI_KILL_TOOLTIPS: Record<string, string> = {
  double: '2 kills within ~10 seconds',
  triple: '3 kills within ~10 seconds',
  quadra: '4 kills within ~10 seconds',
  penta: '5 kills within ~10 seconds (Ace)',
};

const KILL_STREAK_TOOLTIPS: Record<string, string> = {
  killing_spree: '3 kills without dying',
  rampage: '4 kills without dying',
  unstoppable: '5 kills without dying',
  godlike: '6 kills without dying',
  legendary: '7+ kills without dying',
};

const SPECIAL_KILL_TOOLTIPS: Record<string, string> = {
  first_blood: 'First champion-vs-champion kill of the match',
  shutdown: 'Ended a 3+ kill streak',
  ace: 'All 5 enemy champions are dead',
  execute: 'Killed by a non-player source with no assisters',
};

function RoleIcon({ position }: { position: PlayerPosition }) {
  const src = ROLE_ICON_URL[position];
  const label = ROLE_LABELS[position] ?? '';
  if (!src) return <span className="lg-role-icon" />;
  return <img className="lg-role-icon" src={src} alt={label} />;
}

/** Format seconds → MM:SS */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Format gold with K suffix */
function formatGold(gold: number): string {
  if (gold >= 1000) return `${(gold / 1000).toFixed(1)}k`;
  return Math.floor(gold).toString();
}

function normalizePlayerName(name: string): string {
  return name.trim().toLowerCase();
}

/** Get Data Dragon champion icon URL from display name */
function getChampionIconUrl(
  version: string,
  championName: string,
  champions: ChampionBasic[],
): string {
  const match = champions.find(
    (c) => c.name.toLowerCase() === championName.toLowerCase(),
  );
  if (match) {
    return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${match.id}.png`;
  }
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${championName}.png`;
}

/** Get Data Dragon item icon URL */
function getItemIconUrl(version: string, itemId: number): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${itemId}.png`;
}

/** MVP score: weighted formula favouring kills, assists, low deaths, and CS */
function mvpScore(p: LiveGamePlayer): number {
  return p.kills * 3 + p.assists * 1.5 - p.deaths * 1.2 + p.creepScore * 0.012;
}

function getMvpScoreBreakdown(p: LiveGamePlayer): ReactNode {
  const killScore = p.kills * 3;
  const assistScore = p.assists * 1.5;
  const deathPenalty = p.deaths * 1.2;
  const csScore = p.creepScore * 0.012;
  const total = killScore + assistScore - deathPenalty + csScore;
  return (
    <div className="mvp-breakdown">
      <div className="mvp-breakdown-header">
        <span className="mvp-breakdown-title">MVP Score</span>
        <span className="mvp-breakdown-total">{total.toFixed(1)}</span>
      </div>
      <div className="mvp-breakdown-rows">
        <div className="mvp-breakdown-row">
          <span className="mvp-breakdown-key">Kills</span>
          <span className="mvp-breakdown-calc">
            <span className="mvp-breakdown-calc-value">{p.kills}</span>
            <span className="mvp-breakdown-calc-op"> x </span>
            <span className="mvp-breakdown-calc-mult">3</span>
          </span>
          <span className="mvp-breakdown-value">+{killScore.toFixed(1)}</span>
        </div>
        <div className="mvp-breakdown-row">
          <span className="mvp-breakdown-key">Assists</span>
          <span className="mvp-breakdown-calc">
            <span className="mvp-breakdown-calc-value">{p.assists}</span>
            <span className="mvp-breakdown-calc-op"> x </span>
            <span className="mvp-breakdown-calc-mult">1.5</span>
          </span>
          <span className="mvp-breakdown-value">+{assistScore.toFixed(1)}</span>
        </div>
        <div className="mvp-breakdown-row">
          <span className="mvp-breakdown-key">Deaths</span>
          <span className="mvp-breakdown-calc">
            <span className="mvp-breakdown-calc-value">{p.deaths}</span>
            <span className="mvp-breakdown-calc-op"> x </span>
            <span className="mvp-breakdown-calc-mult">1.2</span>
          </span>
          <span className="mvp-breakdown-value mvp-breakdown-value--penalty">-{deathPenalty.toFixed(1)}</span>
        </div>
        <div className="mvp-breakdown-row">
          <span className="mvp-breakdown-key">CS</span>
          <span className="mvp-breakdown-calc">
            <span className="mvp-breakdown-calc-value">{p.creepScore}</span>
            <span className="mvp-breakdown-calc-op"> x </span>
            <span className="mvp-breakdown-calc-mult">0.012</span>
          </span>
          <span className="mvp-breakdown-value">+{csScore.toFixed(1)}</span>
        </div>
      </div>
    </div>
  );
}

/** Readable game mode names (Riot uses fruit codenames for rotating modes) */
function formatGameMode(mode: string): string {
  const map: Record<string, string> = {
    CLASSIC: "Summoner's Rift",
    ARAM: 'ARAM',
    URF: 'URF',
    ARURF: 'AR URF',
    ONEFORALL: 'One for All',
    TUTORIAL: 'Tutorial',
    PRACTICETOOL: 'Practice Tool',
    NEXUSBLITZ: 'Nexus Blitz',
    CHERRY: 'Arena',
    STRAWBERRY: 'Swarm',
    KIWI: 'ARAM: Mayhem',
  };
  if (map[mode]) return map[mode];
  // Fallback: title-case the raw string (e.g. "NEWMODE" → "Newmode")
  return mode.charAt(0).toUpperCase() + mode.slice(1).toLowerCase();
}

/** Max item slots per player */
const MAX_ITEMS = 7;

/** Compute champion base stat at a given level (Data Dragon formulas) */
function getBaseStatAtLevel(
  baseStats: ChampionStats,
  level: number,
  key: keyof LiveGameData['activePlayer']['stats'],
): number | null {
  const l = Math.max(1, Math.min(18, level));
  const m = l - 1;
  switch (key) {
    case 'attackDamage':
      return baseStats.attackdamage + (baseStats.attackdamageperlevel ?? 0) * m;
    case 'armor':
      return baseStats.armor + (baseStats.armorperlevel ?? 0) * m;
    case 'magicResist':
      return baseStats.spellblock + (baseStats.spellblockperlevel ?? 0) * m;
    case 'maxHealth':
      return baseStats.hp + (baseStats.hpperlevel ?? 0) * m;
    case 'moveSpeed':
      return baseStats.movespeed;
    case 'attackRange':
      return baseStats.attackrange;
    case 'attackSpeed': {
      const baseAS = baseStats.attackspeed;
      const perLevel = baseStats.attackspeedperlevel ?? 0;
      return baseAS * (1 + m * perLevel / 100);
    }
    case 'abilityPower':
      return 0; // No base AP
    default:
      return null;
  }
}

/** Stats we display in the panel, grouped into categories */
type StatEntry = {
  label: string;
  key: keyof LiveGameData['activePlayer']['stats'];
  color: string;
  format?: (v: number) => string;
  showIf?: (v: number) => boolean;
};

const STAT_GROUPS: { groupLabel: string; stats: StatEntry[] }[] = [
  {
    groupLabel: 'Offense',
    stats: [
      { label: 'Attack Damage', key: 'attackDamage', color: 'lg-stat-ad' },
      { label: 'Ability Power', key: 'abilityPower', color: 'lg-stat-ap' },
      { label: 'Attack Speed', key: 'attackSpeed', color: 'lg-stat-as', format: (v) => v.toFixed(2) },
      { label: 'Crit Chance', key: 'critChance', color: 'lg-stat-crit', format: (v) => `${Math.round(v * 100)}%`, showIf: (v) => v > 0 },
    ],
  },
  {
    groupLabel: 'Defense',
    stats: [
      { label: 'Max Health', key: 'maxHealth', color: 'lg-stat-hp' },
      { label: 'Armor', key: 'armor', color: 'lg-stat-armor' },
      { label: 'Magic Resist', key: 'magicResist', color: 'lg-stat-mr' },
    ],
  },
  {
    groupLabel: 'Utility',
    stats: [
      { label: 'Ability Haste', key: 'abilityHaste', color: 'lg-stat-ah' },
      { label: 'Attack Range', key: 'attackRange', color: 'lg-stat-as' },
      { label: 'Move Speed', key: 'moveSpeed', color: 'lg-stat-ms' },
      { label: 'Life Steal', key: 'lifeSteal', color: 'lg-stat-ls', format: (v) => `${Math.round(v * 100)}%`, showIf: (v) => v > 0 },
      { label: 'Omnivamp', key: 'omnivamp', color: 'lg-stat-ls', format: (v) => `${Math.round(v * 100)}%`, showIf: (v) => v > 0 },
      { label: 'Tenacity', key: 'tenacity', color: 'lg-stat-ms', format: (v) => `${Math.round(v)}%`, showIf: (v) => v > 0 },
      { label: 'Heal & Shield', key: 'healShieldPower', color: 'lg-stat-ls', showIf: (v) => v > 0 },
    ],
  },
  {
    groupLabel: 'Penetration',
    stats: [
      { label: 'Phys. Lethality', key: 'physicalLethality', color: 'lg-stat-lethality', showIf: (v) => v > 0 },
      { label: 'Armor Pen (Flat)', key: 'armorPenetrationFlat', color: 'lg-stat-lethality', showIf: (v) => v > 0 },
      { label: 'Armor Pen (%)', key: 'armorPenetrationPercent', color: 'lg-stat-lethality', format: (v) => `${Math.round(v < 1 ? (1 - v) * 100 : v)}%`, showIf: (v) => v > 0 && v < 1 },
      { label: 'Magic Pen (Flat)', key: 'magicPenetrationFlat', color: 'lg-stat-ap', showIf: (v) => v > 0 },
      { label: 'Magic Pen (%)', key: 'magicPenetrationPercent', color: 'lg-stat-ap', format: (v) => `${Math.round(v < 1 ? (1 - v) * 100 : v)}%`, showIf: (v) => v > 0 && v < 1 },
    ],
  },
];

/* ================================================================
   Simplified 3D Model — Taunt animation (fallback to idle), auto-sizing
   ================================================================ */

/** Check if an animation name is an attack animation */
function isAttackAnim(name: string): boolean {
  const n = name.replace(/\.anm$/i, '');
  if (/_to_/i.test(n) || /to_attack/i.test(n)) return false;
  return /attack/i.test(n);
}

const ATTACK_PATTERNS: RegExp[] = [
  /^attack1(\.anm)?$/i,
  /^attack_?1(\.anm)?$/i,
  /^attack(\.anm)?$/i,
  /^attack\d?(\.anm)?$/i,
  /(?:^|_)attack(?:\d{0,2})?(\.anm)?$/i,
  /attack/i,
];

/** Check if an animation name is a valid idle animation */
function isIdleAnim(name: string): boolean {
  const n = name.replace(/\.anm$/i, '');
  if (!/idle/i.test(n)) return false;
  if (/idle_?in(?:_|$)/i.test(n)) return false;
  if (/_to_/i.test(n)) return false;
  if (/to_idle/i.test(n)) return false;
  return true;
}

const IDLE_PATTERNS: RegExp[] = [
  /^idle_?base(\.anm)?$/i,
  /^idle\d?_base(\.anm)?$/i,
  /^idle_?1(\.anm)?$/i,
  /^idle_?01(\.anm)?$/i,
  /idle_loop(\.anm)?$/i,
  /(?:^|_)idle(?:\d{0,2})?(\.anm)?$/i,
  /idle/i,
];

/** Find the best attack animation, falling back to idle */
function findBestAnimName(names: string[]): string | undefined {
  // Try attack first
  const attacks = names.filter(isAttackAnim);
  if (attacks.length > 0) {
    for (const pattern of ATTACK_PATTERNS) {
      const match = attacks.find((n) => pattern.test(n));
      if (match) return match;
    }
    return attacks[0];
  }
  // Fallback to idle
  const idles = names.filter(isIdleAnim);
  if (idles.length > 0) {
    for (const pattern of IDLE_PATTERNS) {
      const match = idles.find((n) => pattern.test(n));
      if (match) return match;
    }
    return idles[0];
  }
  for (const pattern of IDLE_PATTERNS) {
    const match = names.find((n) => pattern.test(n));
    if (match) return match;
  }
  return names[0];
}

/** Find the best idle animation only (for hero formation pose) */
function findBestIdleAnimName(names: string[]): string | undefined {
  const idles = names.filter(isIdleAnim);
  if (idles.length > 0) {
    for (const pattern of IDLE_PATTERNS) {
      const match = idles.find((n) => pattern.test(n));
      if (match) return match;
    }
    return idles[0];
  }
  for (const pattern of IDLE_PATTERNS) {
    const match = names.find((n) => pattern.test(n));
    if (match) return match;
  }
  return names[0];
}

/** The 3D champion model with auto-sizing, optional chroma texture. preferIdle=true uses idle pose (hero formation). */
function LiveChampionModel({ url, chromaTextureUrl, preferIdle = false, modelRotationY = 0 }: { url: string; chromaTextureUrl?: string | null; preferIdle?: boolean; modelRotationY?: number }) {
  const { scene, animations } = useGLTF(url);
  const groupRef = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(animations, groupRef);
  const [ready, setReady] = useState(false);
  const originalTexturesRef = useRef<Map<THREE.MeshStandardMaterial, THREE.Texture | null>>(new Map());
  const loadedChromaTexRef = useRef<THREE.Texture | null>(null);

  const isFrightNight = useMemo(() => {
    const m = url.match(/\/models\/([^/]+)\/([^/]+)\//);
    return m != null && FRIGHT_NIGHT_BASE_SKIN_IDS.has(m[2]);
  }, [url]);

  const animName = useMemo(
    () => (preferIdle ? findBestIdleAnimName(names) : findBestAnimName(names)),
    [names, preferIdle],
  );

  /* ── Chroma texture overlay (same logic as ModelViewer's ChampionModel) ── */
  useEffect(() => {
    const originals = originalTexturesRef.current;
    let cancelled = false;

    async function loadTextureWithRetry(url: string, retries = 3, timeoutMs = 15_000): Promise<THREE.Texture> {
      for (let attempt = 0; attempt < retries; attempt++) {
        if (cancelled) throw new Error('cancelled');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetch(url, { signal: controller.signal });
          clearTimeout(timer);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          if (cancelled) throw new Error('cancelled');
          const bitmap = await createImageBitmap(blob, { imageOrientation: 'none' });
          if (cancelled) { bitmap.close(); throw new Error('cancelled'); }
          const texture = new THREE.CanvasTexture(bitmap as unknown as HTMLCanvasElement);
          texture.flipY = false;
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.needsUpdate = true;
          return texture;
        } catch (err) {
          clearTimeout(timer);
          if ((err as Error).message === 'cancelled') throw err;
          if (attempt < retries - 1) await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
          throw err;
        }
      }
      throw new Error('failed');
    }

    if (!chromaTextureUrl) {
      for (const [mat, origTex] of originals) {
        mat.map = origTex;
        mat.needsUpdate = true;
      }
      if (loadedChromaTexRef.current) {
        loadedChromaTexRef.current.dispose();
        loadedChromaTexRef.current = null;
      }
      return;
    }

    loadTextureWithRetry(chromaTextureUrl, 3, 15_000)
      .then((texture) => {
        if (cancelled) { texture.dispose(); return; }
        if (loadedChromaTexRef.current) loadedChromaTexRef.current.dispose();
        loadedChromaTexRef.current = texture;
        let maxSize = 0;
        let maxTexRef: THREE.Texture | null = null;
        const primaryMats: THREE.MeshStandardMaterial[] = [];
        scene.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh || !mesh.visible) return;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of mats) {
            const m = mat as THREE.MeshStandardMaterial;
            const tex = originals.has(m) ? originals.get(m) : m.map;
            if (tex?.image) {
              const img = tex.image as { width?: number; height?: number };
              const size = (img.width ?? 0) * (img.height ?? 0);
              if (size > maxSize) { maxSize = size; maxTexRef = tex; primaryMats.length = 0; primaryMats.push(m); }
              else if (size === maxSize && size > 0 && (isFrightNight || tex === maxTexRef)) primaryMats.push(m);
            }
          }
        });
        if (primaryMats.length > 0) {
          const firstOrig = originals.get(primaryMats[0]) ?? primaryMats[0].map;
          if (firstOrig) {
            texture.offset.copy(firstOrig.offset);
            texture.repeat.copy(firstOrig.repeat);
            texture.wrapS = firstOrig.wrapS;
            texture.wrapT = firstOrig.wrapT;
          }
          for (const m of primaryMats) {
            if (!originals.has(m)) originals.set(m, m.map);
            m.map = texture;
            m.needsUpdate = true;
          }
        } else {
          texture.dispose();
          loadedChromaTexRef.current = null;
        }
      })
      .catch(() => {
        for (const [mat, origTex] of originals) { mat.map = origTex; mat.needsUpdate = true; }
      });

    return () => {
      cancelled = true;
      for (const [mat, origTex] of originals) { mat.map = origTex; mat.needsUpdate = true; }
      originals.clear();
      if (loadedChromaTexRef.current) {
        loadedChromaTexRef.current.dispose();
        loadedChromaTexRef.current = null;
      }
    };
  }, [scene, chromaTextureUrl, isFrightNight]);

  /* Unmount: restore original textures so useGLTF cache is never left with stale chroma */
  useEffect(() => {
    return () => {
      const originals = originalTexturesRef.current;
      for (const [mat, origTex] of originals) {
        mat.map = origTex;
        mat.needsUpdate = true;
      }
      originals.clear();
      if (loadedChromaTexRef.current) {
        loadedChromaTexRef.current.dispose();
        loadedChromaTexRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setReady(false);
    scene.visible = false;
    if (!groupRef.current) return;

    // Fix materials
    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        const m = mat as THREE.MeshStandardMaterial & { userData?: Record<string, unknown> };
        if (m.userData?.visible === false) {
          mesh.visible = false;
          mesh.castShadow = false;
        }
        if (m.transparent) {
          m.alphaTest = m.alphaTest || 0.1;
          m.depthWrite = true;
          m.needsUpdate = true;
        }
        // Fright Night: ClampToEdgeWrapping prevents atlas bleed from UV overshoot
        if (isFrightNight && m.map) {
          m.map.wrapS = THREE.ClampToEdgeWrapping;
          m.map.wrapT = THREE.ClampToEdgeWrapping;
          m.map.needsUpdate = true;
        }
      }
    });

    // Reset transforms
    scene.scale.set(1, 1, 1);
    scene.position.set(0, 0, 0);
    scene.rotation.set(0, modelRotationY, 0);
    scene.traverse((child) => {
      if (child.scale.x < 0) child.scale.x = Math.abs(child.scale.x);
      if (child.scale.y < 0) child.scale.y = Math.abs(child.scale.y);
      if (child.scale.z < 0) child.scale.z = Math.abs(child.scale.z);
    });

    // Play taunt (or idle fallback), tick one frame to pose the skeleton, then pause
    if (animName && actions[animName]) {
      const anim = actions[animName]!;
      anim.reset().play();
      anim.getMixer().update(0);
      anim.paused = true;
    }
    scene.updateMatrixWorld(true);

    // Measure height via Riot's reference bones
    const _pos = new THREE.Vector3();
    let groundY: number | null = null;
    let overheadY: number | null = null;
    scene.traverse((child) => {
      if (!(child as THREE.Bone).isBone) return;
      const name = child.name.toLowerCase();
      if (name === 'buffbone_glb_ground_loc') { child.getWorldPosition(_pos); groundY = _pos.y; }
      else if (name === 'c_buffbone_glb_overhead_loc') { child.getWorldPosition(_pos); overheadY = _pos.y; }
    });

    let modelHeight: number;
    if (groundY !== null && overheadY !== null) {
      modelHeight = Math.abs(overheadY - groundY);
    } else {
      // Fallback: mesh bounding box
      const box = new THREE.Box3();
      scene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh && child.visible) box.expandByObject(child);
      });
      const size = new THREE.Vector3();
      box.getSize(size);
      modelHeight = size.y || 3;
    }

    // Scale to target height (with per-champion overrides for models that size incorrectly)
    const targetHeight = 3.4;
    const urlMatch = url.match(/\/models\/([^/]+)\//);
    const alias = urlMatch?.[1] ?? '';
    const scaleMult = getChampionScale(alias);
    const scale = (targetHeight / Math.max(modelHeight, 0.01)) * scaleMult;
    scene.scale.setScalar(scale);
    scene.updateMatrixWorld(true);

    // Position: use ground bone if available
    let footY = 0;
    let centerX = 0;
    let centerZ = 0;
    const _gp: { v: THREE.Vector3 | null } = { v: null };
    scene.traverse((child) => {
      if (_gp.v === null && (child as THREE.Bone).isBone && /^buffbone_glb_ground_loc$/i.test(child.name)) {
        _gp.v = new THREE.Vector3();
        child.getWorldPosition(_gp.v);
      }
    });
    if (_gp.v) {
      centerX = _gp.v.x;
      footY = _gp.v.y;
      centerZ = _gp.v.z;
    } else {
      const box = new THREE.Box3();
      scene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh && child.visible) box.expandByObject(child);
      });
      const center = new THREE.Vector3();
      box.getCenter(center);
      centerX = center.x;
      centerZ = center.z;
      footY = box.min.y;
    }

    scene.position.set(-centerX, -footY - 1.7, -centerZ);

    // Reveal
    scene.visible = true;
    setReady(true);
  }, [scene, actions, names, animName, url, isFrightNight, modelRotationY]);


  return (
    <group ref={groupRef}>
      <primitive object={scene} />
    </group>
  );
}

function ModelLoadingIndicator() {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = state.clock.elapsedTime * 1.5;
      meshRef.current.rotation.x = state.clock.elapsedTime * 0.7;
      meshRef.current.position.y = Math.sin(state.clock.elapsedTime * 2) * 0.15;
    }
  });
  return (
    <mesh ref={meshRef}>
      <octahedronGeometry args={[0.6, 0]} />
      <meshStandardMaterial color="#c8aa6e" wireframe emissive="#c8aa6e" emissiveIntensity={0.8} toneMapped={false} />
    </mesh>
  );
}

/** Error boundary for 3D model loading failures */
class ModelErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode; resetKey?: string; onError?: () => void }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch() { this.props.onError?.(); }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey) this.setState({ hasError: false });
  }
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}

/* ── Pregame hero formation (all 10 champs, loading art row) ─────── */

/** Single champion loading-art card for the pregame hero row */
function HeroArtCard({ player, champions, side }: { player: LiveGamePlayer; champions: ChampionBasic[]; side: 'blue' | 'red' }) {
  const match = champions.find((c) => c.name.toLowerCase() === player.championName.toLowerCase());
  const championId = match?.id ?? player.championName;
  const championKey = match?.key ?? '0';
  const skinNum = player.skinID;
  const artUrl = getLoadingArt(championId, skinNum);
  const fallbackUrl = getLoadingArtFallback(championKey, skinNum);
  const baseFallbackUrl = getLoadingArt(championId, 0);

  return (
    <div className={`lg-hero-card lg-hero-card--${side}`}>
      <img
        className="lg-hero-card-img"
        src={artUrl}
        alt={player.championName}
        loading="eager"
        onError={(e) => {
          const img = e.currentTarget;
          if (img.src !== fallbackUrl && img.src !== baseFallbackUrl) {
            img.src = fallbackUrl;
          } else if (img.src === fallbackUrl) {
            img.src = baseFallbackUrl;
          }
        }}
      />
      <div className="lg-hero-card-overlay" />
      <span className="lg-hero-card-name">{player.championName}</span>
    </div>
  );
}

export function PregameHeroFormation({
  blueTeam,
  redTeam,
  champions,
}: {
  blueTeam: LiveGamePlayer[];
  redTeam: LiveGamePlayer[];
  champions: ChampionBasic[];
}) {
  const blueByRole = useMemo(() => sortByRole(blueTeam), [blueTeam]);
  const redByRole = useMemo(() => sortByRole(redTeam), [redTeam]);

  return (
    <div className="lg-hero-formation">
      <div className="lg-hero-row">
        <div className="lg-hero-team lg-hero-team--blue">
          {blueByRole.slice(0, 5).map((player) => (
            <HeroArtCard
              key={`blue-${player.summonerName}-${player.championName}`}
              player={player}
              champions={champions}
              side="blue"
            />
          ))}
        </div>
        <div className="lg-hero-vs">VS</div>
        <div className="lg-hero-team lg-hero-team--red">
          {redByRole.slice(0, 5).map((player) => (
            <HeroArtCard
              key={`red-${player.summonerName}-${player.championName}`}
              player={player}
              champions={champions}
              side="red"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Reusable 3D canvas that renders a champion model with lighting + shadows */
function ChampionModelCanvas({ url, fallbackUrl, chromaTextureUrl, modelRotationY = 0 }: { url: string; fallbackUrl?: string; chromaTextureUrl?: string; modelRotationY?: number }) {
  const [useFallback, setUseFallback] = useState(false);
  const activeUrl = useFallback && fallbackUrl ? fallbackUrl : url;

  // Reset fallback state when the primary URL changes
  useEffect(() => { setUseFallback(false); }, [url]);

  return (
    <ModelErrorBoundary
      resetKey={`${activeUrl}:${chromaTextureUrl ?? ''}`}
      fallback={null}
      onError={() => { if (fallbackUrl && !useFallback) setUseFallback(true); }}
    >
      <Canvas
        shadows
        camera={{ position: [0, 0.5, 5.5], fov: 45 }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.2,
          alpha: true,
        }}
        style={{ background: 'transparent' }}
      >
        <fog attach="fog" args={['#010a13', 14, 30]} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[8, 8, -2]} intensity={1.2} color="#f0e6d2" />
        <directionalLight position={[0, 4, -6]} intensity={0.4} color="#0ac8b9" />
        <pointLight position={[1, 3, -5]} intensity={0.6} color="#0ac8b9" />
        <pointLight position={[5, 3, 2]} intensity={0.6} color="#c8aa6e" />
        <pointLight position={[-5, 4, 4]} intensity={0.5} color="#ff69b4" />
        <spotLight position={[0, 8, 0]} intensity={0.8} color="#f0e6d2" angle={0.5} penumbra={0.8} />
        <directionalLight
          position={[-5, 10, 5]}
          intensity={0.25}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-left={-6}
          shadow-camera-right={6}
          shadow-camera-top={6}
          shadow-camera-bottom={-6}
          shadow-bias={-0.002}
          shadow-radius={50}
        />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.69, 0]} receiveShadow>
          <planeGeometry args={[20, 20]} />
          <shadowMaterial opacity={0.3} />
        </mesh>
        <Suspense fallback={<ModelLoadingIndicator />}>
          <LiveChampionModel key={activeUrl} url={activeUrl} chromaTextureUrl={chromaTextureUrl} modelRotationY={modelRotationY} />
        </Suspense>
        <OrbitControls
          enableRotate
          enablePan={false}
          enableZoom={false}
          enableDamping
          dampingFactor={0.05}
          target={[0, -0.3, 0]}
        />
      </Canvas>
    </ModelErrorBoundary>
  );
}

/* ================================================================
   Main LiveGamePage component
   ================================================================ */

export function LiveGamePage({ data, champions, version, itemData, onBack }: Props) {
  const [showStats, setShowStats] = useState(true);
  const [championBaseStats, setChampionBaseStats] = useState<ChampionStats | null>(null);
  const toggleStats = useCallback(() => setShowStats((s) => !s), []);

  // Track the highest observed gold total (items + current) so it never dips on purchase
  const peakGoldRef = useRef(0);

  // Find the active player
  const activePlayer = useMemo(
    () => data.players.find((p) => p.isActivePlayer),
    [data.players],
  );

  // Lane opponent: enemy in same position (e.g. support vs support)
  const laneOpponent = useMemo(() => {
    if (!activePlayer) return undefined;
    const enemyTeam = activePlayer.team === 'ORDER' ? 'CHAOS' : 'ORDER';
    const match = data.players.find(
      (p) => p.team === enemyTeam && p.position === activePlayer.position,
    );
    return match;
  }, [data.players, activePlayer]);

  const partyNameSet = useMemo(() => {
    const set = new Set<string>();
    for (const rawName of data.partyMembers ?? []) {
      const normalized = normalizePlayerName(rawName);
      if (!normalized) continue;
      set.add(normalized);
      const hashIdx = normalized.indexOf('#');
      if (hashIdx > 0) {
        set.add(normalized.slice(0, hashIdx));
      }
    }
    return set;
  }, [data.partyMembers]);

  const isPartyMember = useCallback((player: LiveGamePlayer): boolean => {
    if (!activePlayer || player.isActivePlayer || player.team !== activePlayer.team) {
      return false;
    }
    const normalized = normalizePlayerName(player.summonerName);
    if (partyNameSet.has(normalized)) return true;
    const hashIdx = normalized.indexOf('#');
    if (hashIdx > 0 && partyNameSet.has(normalized.slice(0, hashIdx))) return true;
    return false;
  }, [activePlayer, partyNameSet]);

  // Resolve model URL + chroma texture for each player (uses resolveLcuSkinNum for chroma detection)
  const activeModelInfo = usePlayerModelInfo(activePlayer, champions);
  const enemyModelInfo = usePlayerModelInfo(laneOpponent, champions);

  // Fetch champion base stats for the active player
  useEffect(() => {
    if (!activePlayer) {
      setChampionBaseStats(null);
      return;
    }
    const match = champions.find(
      (c) => c.name.toLowerCase() === activePlayer.championName.toLowerCase(),
    );
    if (!match) {
      setChampionBaseStats(null);
      return;
    }
    let cancelled = false;
    getChampionDetail(match.id).then((detail) => {
      if (!cancelled && detail.stats) setChampionBaseStats(detail.stats);
    }).catch(() => {
      if (!cancelled) setChampionBaseStats(null);
    });
    return () => { cancelled = true; };
  }, [activePlayer?.championName, champions]);

  // Split players into teams, sorted by role
  const blueTeam = useMemo(
    () => sortByRole(data.players.filter((p) => p.team === 'ORDER')),
    [data.players],
  );
  const redTeam = useMemo(
    () => sortByRole(data.players.filter((p) => p.team === 'CHAOS')),
    [data.players],
  );

  const blueKills = blueTeam.reduce((sum, p) => sum + p.kills, 0);
  const redKills = redTeam.reduce((sum, p) => sum + p.kills, 0);

  // Active player row index and side (for floating "you" chevron)
  const activePlayerRow = useMemo(() => {
    if (!activePlayer) return null;
    const blueIdx = blueTeam.findIndex((p) => p.summonerName === activePlayer.summonerName);
    if (blueIdx >= 0) return { index: blueIdx, side: 'blue' as const };
    const redIdx = redTeam.findIndex((p) => p.summonerName === activePlayer.summonerName);
    if (redIdx >= 0) return { index: redIdx, side: 'red' as const };
    return null;
  }, [activePlayer, blueTeam, redTeam]);

  // Refs for chevron positioning
  const scoreboardRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLDivElement | null>(null);
  const mvpRowRef = useRef<HTMLDivElement | null>(null);
  const [chevronTop, setChevronTop] = useState<number | null>(null);
  const [mvpTop, setMvpTop] = useState<number | null>(null);

  // MVP: highest mvpScore across all players
  const gameMvp = useMemo(() => {
    if (data.players.length === 0) return undefined;
    const totalKills = data.players.reduce((sum, p) => sum + p.kills, 0);
    if (totalKills === 0) return undefined;
    return data.players.reduce((best, p) => (mvpScore(p) > mvpScore(best) ? p : best), data.players[0]);
  }, [data.players]);

  // MVP row index and side (for floating MVP badge)
  const mvpRow = useMemo(() => {
    if (!gameMvp) return null;
    const blueIdx = blueTeam.findIndex((p) => p.summonerName === gameMvp.summonerName);
    if (blueIdx >= 0) return { index: blueIdx, side: 'blue' as const };
    const redIdx = redTeam.findIndex((p) => p.summonerName === gameMvp.summonerName);
    if (redIdx >= 0) return { index: redIdx, side: 'red' as const };
    return null;
  }, [gameMvp, blueTeam, redTeam]);

  useEffect(() => {
    if ((!activePlayerRow && !mvpRow) || !scoreboardRef.current) {
      setChevronTop(null);
      setMvpTop(null);
      return;
    }
    const update = () => {
      if (!scoreboardRef.current) return;
      const sbRect = scoreboardRef.current.getBoundingClientRect();
      if (activePlayerRow && activeRowRef.current) {
        const rowRect = activeRowRef.current.getBoundingClientRect();
        setChevronTop(rowRect.top - sbRect.top + rowRect.height / 2 - 10);
      } else {
        setChevronTop(null);
      }
      if (mvpRow && mvpRowRef.current) {
        const rowRect = mvpRowRef.current.getBoundingClientRect();
        setMvpTop(rowRect.top - sbRect.top + rowRect.height / 2 - 10);
      } else {
        setMvpTop(null);
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(scoreboardRef.current);
    return () => ro.disconnect();
  }, [activePlayerRow, mvpRow]);

  // Estimate team gold from item prices (API doesn't expose per-player gold)
  const teamItemGold = (players: typeof blueTeam) =>
    players.reduce((total, p) => total + p.items.reduce((s, item) => s + item.price * item.count, 0), 0);
  const blueGold = teamItemGold(blueTeam);
  const redGold = teamItemGold(redTeam);

  // Show hero formation during pre-game (loading / fountain before minions); clear once match starts
  // Use both gameTime and items: Riot's gameTime format can vary; "no items" = true fountain phase
  const noOneHasItems = data.players.every((p) => p.items.length === 0);
  const gameTime = data.gameTime ?? 0;
  const isPregame = noOneHasItems || gameTime < 180;

  // Hide hero models and pane early when kill feed has 5+ kills (give more space to the feed)
  const killFeedCount = data.killFeed?.length ?? 0;
  const showHeroModels = killFeedCount < 5;

  // Filter groups to only include stats that pass showIf, and exclude empty groups
  const visibleGroups = useMemo(() => {
    return STAT_GROUPS
      .map((group) => ({
        ...group,
        stats: group.stats.filter((s) => {
          const val = data.activePlayer.stats[s.key] as number;
          return s.showIf ? s.showIf(val) : true;
        }),
      }))
      .filter((group) => group.stats.length > 0);
  }, [data.activePlayer.stats]);

  return (
    <div className="live-game-page">
      <div className="cs-bg-glow" />
      <div className="cs-bg-lines" />

      {/* Champion models positioned by team: Blue (ORDER) left, Red (CHAOS) right — hidden during pregame, hidden when kill feed has 5+ kills */}
      {!isPregame && showHeroModels && activePlayer?.team === 'ORDER' ? (
        <>
          {activeModelInfo?.modelUrl && (
            <div className="lg-model-bg lg-model-bg--left">
              <ChampionModelCanvas
                url={activeModelInfo.modelUrl}
                fallbackUrl={activeModelInfo.fallbackUrl}
                chromaTextureUrl={activeModelInfo.chromaTextureUrl}
                modelRotationY={Math.PI / 4}
              />
            </div>
          )}
          {enemyModelInfo?.modelUrl && (
            <div className="lg-model-bg lg-model-bg--right">
              <ChampionModelCanvas
                url={enemyModelInfo.modelUrl}
                fallbackUrl={enemyModelInfo.fallbackUrl}
                chromaTextureUrl={enemyModelInfo.chromaTextureUrl}
                modelRotationY={-Math.PI / 4}
              />
            </div>
          )}
        </>
      ) : !isPregame && showHeroModels ? (
        <>
          {enemyModelInfo?.modelUrl && (
            <div className="lg-model-bg lg-model-bg--left">
              <ChampionModelCanvas
                url={enemyModelInfo.modelUrl}
                fallbackUrl={enemyModelInfo.fallbackUrl}
                chromaTextureUrl={enemyModelInfo.chromaTextureUrl}
                modelRotationY={Math.PI / 4}
              />
            </div>
          )}
          {activeModelInfo?.modelUrl && (
            <div className="lg-model-bg lg-model-bg--right">
              <ChampionModelCanvas
                url={activeModelInfo.modelUrl}
                fallbackUrl={activeModelInfo.fallbackUrl}
                chromaTextureUrl={activeModelInfo.chromaTextureUrl}
                modelRotationY={-Math.PI / 4}
              />
            </div>
          )}
        </>
      ) : null}

      {/* Scoreboard content — centered between the two models */}
      <div className="live-game-content">
        {/* Top bar */}
        <div className="lg-top-bar">
          <button className="lg-back" onClick={onBack}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back
          </button>
        </div>

        {/* Game header */}
        <div className="lg-header">
          <div className="lg-game-mode">{formatGameMode(data.gameMode)}</div>
          <div className="lg-game-timer">{formatTime(data.gameTime)}</div>
          <div className="lg-live-badge">
            <span className="lg-live-dot" />
            Live
          </div>
        </div>

        {/* Team gold comparison */}
        <div className="lg-gold-bar">
          <span className={`lg-gold-team lg-gold-team--blue${blueGold > redGold ? ' lg-gold-team--leading' : ''}`}>
            <svg className="lg-gold-icon" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="6" /></svg>
            {formatGold(blueGold)}
          </span>
          <span className="lg-gold-label">Team Gold</span>
          <span className={`lg-gold-team lg-gold-team--red${redGold > blueGold ? ' lg-gold-team--leading' : ''}`}>
            {formatGold(redGold)}
            <svg className="lg-gold-icon" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="6" /></svg>
          </span>
        </div>

        {/* Scoreboard (mirrored side-by-side) */}
        <div className="lg-scoreboard-wrap" ref={scoreboardRef}>
          {/* Floating chevron pointing to active player */}
          {activePlayerRow && chevronTop != null && (
            <div
              className={`lg-sb-you-chevron lg-sb-you-chevron--${activePlayerRow.side}${activePlayerRow.index === mvpRow?.index && activePlayerRow.side === mvpRow?.side ? ' lg-sb-you-chevron--with-mvp' : ''}`}
              style={{ top: chevronTop }}
              aria-hidden
            />
          )}
          {/* Floating MVP badge */}
          {mvpRow && mvpTop != null && gameMvp && (
            <TextTooltip
              content={getMvpScoreBreakdown(gameMvp)}
              variant="mvp"
            >
              <div
                className={`lg-sb-mvp-float lg-sb-mvp-float--${mvpRow.side}`}
                style={{ top: mvpTop }}
                aria-hidden
              >
                MVP
              </div>
            </TextTooltip>
          )}
          <div className="lg-scoreboard">
          {/* Central score header */}
          <div className="lg-sb-header">
            <span className="lg-sb-header-blue">Blue Team</span>
            <div className="lg-sb-header-score">
              <span className="lg-sb-score-blue">{blueKills}</span>
              <svg className="lg-sb-swords" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 7l4-4h4v4l-4 4M8 14l-3 3-2 1 1-2 3-3" />
              </svg>
              <span className="lg-sb-score-red">{redKills}</span>
            </div>
            <span className="lg-sb-header-red">Red Team</span>
          </div>

          {/* Rows: blue player (left) | role icon | red player (right) */}
          {Array.from({ length: Math.max(blueTeam.length, redTeam.length) }).map((_, i) => {
            const rolePos = blueTeam[i]?.position || redTeam[i]?.position || '';
            const isActiveRow = activePlayerRow?.index === i;
            const isMvpRow = mvpRow?.index === i;
            return (
            <div
              key={i}
              className="lg-sb-match-row"
              ref={(el) => {
                if (isActiveRow) activeRowRef.current = el;
                if (isMvpRow) mvpRowRef.current = el;
              }}
            >
              {blueTeam[i] ? (
                <LgPlayerSide player={blueTeam[i]} side="blue" isMvp={gameMvp?.summonerName === blueTeam[i].summonerName} isPartyMember={isPartyMember(blueTeam[i])} champions={champions} version={version} itemData={itemData} />
              ) : (
                <div className="lg-sb-side lg-sb-side--blue" />
              )}
              <div className="lg-sb-vs-divider">
                {rolePos && <RoleIcon position={rolePos as PlayerPosition} />}
              </div>
              {redTeam[i] ? (
                <LgPlayerSide player={redTeam[i]} side="red" isMvp={gameMvp?.summonerName === redTeam[i].summonerName} isPartyMember={isPartyMember(redTeam[i])} champions={champions} version={version} itemData={itemData} />
              ) : (
                <div className="lg-sb-side lg-sb-side--red" />
              )}
            </div>
            );
          })}
        </div>
        </div>

        {/* Active player stats panel */}
        <div className="lg-stats-panel">
          <div className="lg-stats-header">
            <span className="lg-stats-title">Your Stats</span>
            <button className="lg-stats-toggle" onClick={toggleStats}>
              {showStats ? 'Hide' : 'Show'}
            </button>
          </div>
          {showStats && (
            <div className="lg-stats-groups">
              {/* Gold & CS (always shown) */}
              <div className="lg-stats-group">
                <div className="lg-stats-group-label">Gold &amp; CS</div>
                <div className="lg-stats-group-items">
                  <div className="lg-stat-item">
                    <span className="lg-stat-label">Current Gold</span>
                    <span className="lg-stat-value lg-stat-gold">
                      {Math.floor(data.activePlayer.currentGold).toLocaleString()}
                    </span>
                  </div>
                  <div className="lg-stat-item">
                    <span className="lg-stat-label">Total Earned</span>
                    <span className="lg-stat-value lg-stat-gold">
                      {(() => {
                        const current =
                          (activePlayer?.items.reduce((s, item) => s + item.price * item.count, 0) ?? 0)
                          + data.activePlayer.currentGold;
                        if (current > peakGoldRef.current) peakGoldRef.current = current;
                        return Math.floor(peakGoldRef.current).toLocaleString();
                      })()}
                    </span>
                  </div>
                  <div className="lg-stat-item">
                    <span className="lg-stat-label">Creep Score</span>
                    <span className="lg-stat-value lg-stat-ms">
                      {activePlayer?.creepScore ?? 0}
                    </span>
                  </div>
                </div>
              </div>
              {visibleGroups.map((group) => (
                <div key={group.groupLabel} className="lg-stats-group">
                  <div className="lg-stats-group-label">{group.groupLabel}</div>
                  <div className="lg-stats-group-items">
                    {group.stats.map((stat) => {
                      const val = data.activePlayer.stats[stat.key] as number;
                      const formatted = stat.format ? stat.format(val) : Math.round(val).toString();
                      const baseVal = championBaseStats && activePlayer
                        ? getBaseStatAtLevel(championBaseStats, activePlayer.level, stat.key)
                        : null;
                      const baseFormatted = baseVal != null
                        ? (stat.format ? stat.format(baseVal) : Math.round(baseVal).toString())
                        : null;
                      return (
                        <div key={stat.key} className="lg-stat-item">
                          <span className="lg-stat-label">{stat.label}</span>
                          <span className="lg-stat-values">
                            {baseFormatted != null && (
                              <>
                                <span className="lg-stat-base">{baseFormatted}</span>
                                <span className="lg-stat-base lg-stat-arrow">→</span>
                              </>
                            )}
                            <span className={`lg-stat-value ${stat.color}`}>{formatted}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Kill Feed */}
        {data.killFeed && data.killFeed.length > 0 && (
          <KillFeed
            kills={enrichKillFeed(data.killFeed, data.players, data.killFeedSnapshots)}
            players={data.players}
            killFeedSnapshots={data.killFeedSnapshots}
            champions={champions}
            version={version}
            itemData={itemData}
          />
        )}

        {/* Pregame hero formation: all 10 champions at bottom until match starts (hidden when kill feed has 5+ kills) */}
        {isPregame && showHeroModels && (
          <PregameHeroFormation blueTeam={blueTeam} redTeam={redTeam} champions={champions} />
        )}
      </div>

      <div className="cs-bottom-border" />
    </div>
  );
}

/* ── Kill Feed Entity (champion icon or entity placeholder) ──────────── */

const ENTITY_ICONS: Record<string, string> = {
  _turret: '🏰',
  _turret_blue: '🏰',
  _turret_red: '🏰',
  _baron: '👾',
  _dragon: '🐉',
  _herald: '👁',
  _voidgrub: '🪲',
  _minion: '⚔',
  _minion_blue: '⚔',
  _minion_red: '⚔',
  _jungle: '🌿',
  _unknown: '❓',
};

function KillFeedEntity({
  isEntity,
  champ,
  displayName,
  side,
  version,
  champions,
  level,
}: {
  isEntity: boolean;
  champ: string;
  displayName: string;
  side: string;
  version: string;
  champions: ChampionBasic[];
  level?: number;
}) {
  if (isEntity) {
    return (
      <>
        <span className={`lg-kill-entity-icon lg-kill-icon--${side}`}>
          {ENTITY_ICONS[champ] ?? '❓'}
        </span>
        <span className={`lg-kill-name lg-kill-name--${side}`}>
          {displayName}
        </span>
      </>
    );
  }
  return (
    <>
      <span className={`lg-kill-portrait lg-kill-icon--${side}`}>
        <img
          className="lg-kill-portrait-img"
          src={getChampionIconUrl(version, champ, champions)}
          alt={champ}
        />
        {level != null && <span className="lg-kill-portrait-level">{level}</span>}
      </span>
      <span className={`lg-kill-name lg-kill-name--${side}`}>
        {champ}
      </span>
    </>
  );
}

/* ── Kill Feed ────────────────────────────────────────────────────────── */

function KillFeed({
  kills,
  players,
  killFeedSnapshots,
  champions,
  version,
  itemData,
}: {
  kills: KillEvent[];
  players: LiveGamePlayer[];
  killFeedSnapshots?: Record<number, KillEventPlayerSnapshot>;
  champions: ChampionBasic[];
  version: string;
  itemData: Record<number, ItemInfo>;
}) {
  // Build a map from summoner name → team
  const nameToTeam = useMemo(() => {
    const map: Record<string, 'ORDER' | 'CHAOS'> = {};
    for (const p of players) {
      map[p.summonerName] = p.team;
    }
    return map;
  }, [players]);

  // Build a map from summoner name → player (live, for inline icons)
  const nameToPlayer = useMemo(() => {
    const map: Record<string, LiveGamePlayer> = {};
    for (const p of players) {
      map[p.summonerName] = p;
    }
    return map;
  }, [players]);

  // Build a map from champion name → player (live, for inline assister icons)
  const champToPlayer = useMemo(() => {
    const map: Record<string, LiveGamePlayer> = {};
    for (const p of players) {
      map[p.championName] = p;
    }
    return map;
  }, [players]);

  const activePlayerName = useMemo(
    () => players.find((p) => p.isActivePlayer)?.summonerName ?? null,
    [players],
  );

  // All kills, most recent first
  const allKills = useMemo(() => [...kills].reverse(), [kills]);

  // Track which kill is expanded using eventTime (stable across re-renders when new kills arrive)
  const [expandedTime, setExpandedTime] = useState<number | null>(null);

  // Ref for the scrollable list container
  const listRef = useRef<HTMLDivElement>(null);
  // Refs for each kill wrapper element, keyed by eventTime
  const wrapperRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // Scroll expanded entry to top of the killfeed viewport
  const handleExpand = useCallback((eventTime: number) => {
    const isAlreadyExpanded = expandedTime === eventTime;
    const newTime = isAlreadyExpanded ? null : eventTime;
    setExpandedTime(newTime);

    if (!isAlreadyExpanded && listRef.current) {
      // Use requestAnimationFrame so the DOM has updated
      requestAnimationFrame(() => {
        const wrapper = wrapperRefs.current[eventTime];
        if (wrapper && listRef.current) {
          const listTop = listRef.current.getBoundingClientRect().top;
          const wrapperTop = wrapper.getBoundingClientRect().top;
          listRef.current.scrollTop += wrapperTop - listTop;
        }
      });
    }
  }, [expandedTime]);

  return (
    <div className="lg-killfeed">
      <div className="lg-killfeed-header">
        <span className="lg-killfeed-title">Kill Feed</span>
        <span className="lg-killfeed-count">{kills.length} kills</span>
      </div>
      <div className="lg-killfeed-list" ref={listRef}>
        {allKills.map((kill, i) => {
          const killerIsEntity = kill.killerChamp.startsWith('_');
          const victimIsEntity = kill.victimChamp.startsWith('_');
          const killerTeam = nameToTeam[kill.killerName];
          const victimTeam = nameToTeam[kill.victimName];
          const killerSide = killerTeam === 'ORDER' ? 'blue'
            : killerTeam === 'CHAOS' ? 'red'
            : kill.killerChamp.includes('blue') ? 'blue'
            : kill.killerChamp.includes('red') ? 'red'
            : 'neutral';
          const victimSide = victimTeam === 'ORDER' ? 'blue'
            : victimTeam === 'CHAOS' ? 'red'
            : kill.victimChamp.includes('blue') ? 'blue'
            : kill.victimChamp.includes('red') ? 'red'
            : 'neutral';

          const isYourKill = activePlayerName != null && kill.killerName === activePlayerName;
          const isExpanded = expandedTime === kill.eventTime;
          const isPentaAnnouncement = kill.multiKill === 'penta';

          // Live player data (for inline assister icons in the row)
          const liveAssisterPlayers = kill.assisters
            .map((champName) => champToPlayer[champName])
            .filter(Boolean) as LiveGamePlayer[];

          // Snapshot data (frozen at time of kill) for the expanded detail panel
          const snapshot = killFeedSnapshots?.[kill.eventTime];
          const killerPlayer = snapshot?.byName[kill.killerName] ?? nameToPlayer[kill.killerName];
          const victimPlayer = snapshot?.byName[kill.victimName] ?? nameToPlayer[kill.victimName];
          const assisterPlayers = kill.assisters
            .map((champName) => snapshot?.byChamp[champName] ?? champToPlayer[champName])
            .filter(Boolean) as LiveGamePlayer[];

          return (
            <div
              key={`${kill.eventTime}-${i}`}
              className="lg-kill-wrapper"
              ref={(el) => { wrapperRefs.current[kill.eventTime] = el; }}
            >
              <div
                className={`lg-kill-entry${isYourKill ? ' lg-kill-entry--your-kill' : ''}${isExpanded ? ' lg-kill-entry--expanded' : ''}${isPentaAnnouncement ? ' lg-kill-entry--penta' : ''}`}
                onClick={() => handleExpand(kill.eventTime)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleExpand(kill.eventTime); } }}
              >
                <span className="lg-kill-time">{formatTime(kill.eventTime)}</span>
                <KillFeedEntity
                  isEntity={killerIsEntity}
                  champ={kill.killerChamp}
                  displayName={kill.killerName}
                  side={killerSide}
                  version={version}
                  champions={champions}
                  level={killerPlayer?.level}
                />
                {/* Assister icons inline next to the killer */}
                <span className={`lg-kill-assist-icons${liveAssisterPlayers.length === 0 ? ' lg-kill-assist-icons--empty' : ''}`}>
                  {liveAssisterPlayers.length > 0 && <span className="lg-kill-assist-plus">+</span>}
                  {liveAssisterPlayers.map((ap) => {
                    const apTeam = nameToTeam[ap.summonerName];
                    const apSide = apTeam === 'ORDER' ? 'blue' : apTeam === 'CHAOS' ? 'red' : 'neutral';
                    return (
                      <img
                        key={ap.summonerName}
                        className={`lg-kill-assist-mini-icon lg-kill-icon--${apSide}`}
                        src={getChampionIconUrl(version, ap.championName, champions)}
                        alt={ap.championName}
                        title={ap.championName}
                      />
                    );
                  })}
                </span>
                <span className="lg-kill-tab-spacer" aria-hidden />
                <svg className="lg-kill-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M13 5l6 7-6 7" />
                </svg>
                <KillFeedEntity
                  isEntity={victimIsEntity}
                  champ={kill.victimChamp}
                  displayName={kill.victimName}
                  side={victimSide}
                  version={version}
                  champions={champions}
                  level={victimPlayer?.level}
                />
                <span className="lg-kill-right">
                  {(kill.multiKill || kill.killStreak || kill.firstBlood || kill.shutdown || kill.ace || kill.execute) && (
                    <span className="lg-kill-badges">
                      {kill.firstBlood && (
                        <TextTooltip
                          text={SPECIAL_KILL_TOOLTIPS.first_blood}
                          variant="first_blood"
                          className="lg-kill-badge lg-kill-badge--special lg-kill-badge--first_blood"
                        >
                          First Blood
                        </TextTooltip>
                      )}
                      {kill.shutdown && (
                        <TextTooltip
                          text={SPECIAL_KILL_TOOLTIPS.shutdown}
                          variant="shutdown"
                          className="lg-kill-badge lg-kill-badge--special lg-kill-badge--shutdown"
                        >
                          Shutdown
                        </TextTooltip>
                      )}
                      {kill.ace && (
                        <TextTooltip
                          text={SPECIAL_KILL_TOOLTIPS.ace}
                          variant="ace"
                          className="lg-kill-badge lg-kill-badge--special lg-kill-badge--ace"
                        >
                          Ace
                        </TextTooltip>
                      )}
                      {kill.execute && (
                        <TextTooltip
                          text={SPECIAL_KILL_TOOLTIPS.execute}
                          variant="execute"
                          className="lg-kill-badge lg-kill-badge--special lg-kill-badge--execute"
                        >
                          Executed
                        </TextTooltip>
                      )}
                      {kill.multiKill && (
                        <TextTooltip
                          text={MULTI_KILL_TOOLTIPS[kill.multiKill]}
                          variant={kill.multiKill}
                          className={`lg-kill-badge lg-kill-badge--multikill lg-kill-badge--${kill.multiKill}`}
                        >
                          {kill.multiKill === 'double' && 'Double Kill'}
                          {kill.multiKill === 'triple' && 'Triple Kill'}
                          {kill.multiKill === 'quadra' && 'Quadra Kill'}
                          {kill.multiKill === 'penta' && 'Penta Kill'}
                          {kill.multiKillCount != null && kill.multiKillCount > 1 && (
                            <span className="lg-kill-badge-multiplier">x{kill.multiKillCount}</span>
                          )}
                        </TextTooltip>
                      )}
                      {kill.killStreak && (
                        <TextTooltip
                          text={KILL_STREAK_TOOLTIPS[kill.killStreak]}
                          variant={kill.killStreak}
                          className={`lg-kill-badge lg-kill-badge--streak lg-kill-badge--${kill.killStreak}`}
                        >
                          {kill.killStreak === 'killing_spree' && 'Killing Spree'}
                          {kill.killStreak === 'rampage' && 'Rampage'}
                          {kill.killStreak === 'unstoppable' && 'Unstoppable'}
                          {kill.killStreak === 'godlike' && 'Godlike'}
                          {kill.killStreak === 'legendary' && 'Legendary'}
                          {kill.killStreakCount != null && kill.killStreakCount > 1 && (
                            <span className="lg-kill-badge-multiplier">x{kill.killStreakCount}</span>
                          )}
                        </TextTooltip>
                      )}
                    </span>
                  )}
                </span>
                <svg className={`lg-kill-chevron${isExpanded ? ' lg-kill-chevron--open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </div>

              {/* Expanded detail breakdown */}
              {isExpanded && (
                <div className="lg-kill-detail">
                  <div className="lg-kill-detail-columns">
                    {/* Killer column */}
                    <KillDetailColumn
                      label="Killer"
                      player={killerPlayer}
                      champ={kill.killerChamp}
                      isEntity={killerIsEntity}
                      side={killerSide}
                      version={version}
                      champions={champions}
                      itemData={itemData}
                    />

                    {/* Assists column (between killer and VS) */}
                    {assisterPlayers.length > 0 && (
                      <div className="lg-kill-detail-col lg-kill-detail-col--assists">
                        <span className="lg-kill-detail-label">Assists</span>
                        <div className="lg-kill-detail-assist-list">
                          {assisterPlayers.map((ap) => {
                            const apTeam = nameToTeam[ap.summonerName];
                            const apSide = apTeam === 'ORDER' ? 'blue' : apTeam === 'CHAOS' ? 'red' : 'neutral';
                            return (
                              <div key={ap.summonerName} className="lg-kill-detail-assist-player">
                                <img
                                  className={`lg-kill-detail-assist-icon lg-kill-icon--${apSide}`}
                                  src={getChampionIconUrl(version, ap.championName, champions)}
                                  alt={ap.championName}
                                />
                                <div className="lg-kill-detail-assist-info">
                                  <span className={`lg-kill-detail-assist-name lg-kill-name--${apSide}`}>
                                    {ap.championName}
                                  </span>
                                  <span className="lg-kill-detail-assist-kda">
                                    {ap.kills}/{ap.deaths}/{ap.assists}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* VS divider */}
                    <div className="lg-kill-detail-vs">
                      <span className="lg-kill-detail-vs-text">VS</span>
                      <span className="lg-kill-detail-vs-time">{formatTime(kill.eventTime)}</span>
                    </div>

                    {/* Victim column */}
                    <KillDetailColumn
                      label="Killed"
                      player={victimPlayer}
                      champ={kill.victimChamp}
                      isEntity={victimIsEntity}
                      side={victimSide}
                      version={version}
                      champions={champions}
                      itemData={itemData}
                    />
                  </div>

                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Detail column for killer or victim in the expanded kill detail */
function KillDetailColumn({
  label,
  player,
  champ,
  isEntity,
  side,
  version,
  champions,
  itemData,
}: {
  label: string;
  player?: LiveGamePlayer;
  champ: string;
  isEntity: boolean;
  side: string;
  version: string;
  champions: ChampionBasic[];
  itemData: Record<number, ItemInfo>;
}) {
  if (isEntity) {
    return (
      <div className="lg-kill-detail-col">
        <span className="lg-kill-detail-label">{label}</span>
        <div className="lg-kill-detail-entity">
          <span className={`lg-kill-entity-icon lg-kill-icon--${side}`}>
            {ENTITY_ICONS[champ] ?? '❓'}
          </span>
          <span className={`lg-kill-name lg-kill-name--${side}`}>{champ.replace(/^_/, '')}</span>
        </div>
      </div>
    );
  }

  if (!player) {
    return (
      <div className="lg-kill-detail-col">
        <span className="lg-kill-detail-label">{label}</span>
        <span className="lg-kill-detail-unknown">Unknown</span>
      </div>
    );
  }

  const playerItems = player.items.filter((it) => it.itemID > 0);

  return (
    <div className="lg-kill-detail-col">
      <span className="lg-kill-detail-label">{label}</span>
      <div className="lg-kill-detail-champ">
        <img
          className={`lg-kill-detail-champ-icon lg-kill-icon--${side}`}
          src={getChampionIconUrl(version, player.championName, champions)}
          alt={player.championName}
        />
        <div className="lg-kill-detail-champ-info">
          <span className={`lg-kill-detail-champ-name lg-kill-name--${side}`}>
            {player.championName}
          </span>
          <span className="lg-kill-detail-summoner">{player.summonerName}</span>
        </div>
      </div>
      <div className="lg-kill-detail-stats">
        <div className="lg-kill-detail-stat">
          <span className="lg-kill-detail-stat-label">Level</span>
          <span className="lg-kill-detail-stat-value">{player.level}</span>
        </div>
        <div className="lg-kill-detail-stat">
          <span className="lg-kill-detail-stat-label">KDA</span>
          <span className="lg-kill-detail-stat-value">
            <span className="lg-kda-k">{player.kills}</span>
            <span className="lg-kda-slash">/</span>
            <span className="lg-kda-d">{player.deaths}</span>
            <span className="lg-kda-slash">/</span>
            <span className="lg-kda-a">{player.assists}</span>
          </span>
        </div>
        <div className="lg-kill-detail-stat">
          <span className="lg-kill-detail-stat-label">CS</span>
          <span className="lg-kill-detail-stat-value">{player.creepScore}</span>
        </div>
      </div>
      {playerItems.length > 0 && (
        <div className="lg-kill-detail-items">
          {playerItems.map((item, idx) => {
            const info = itemData[item.itemID];
            return (
              <ItemTooltip
                key={idx}
                itemId={item.itemID}
                itemDisplayName={item.displayName}
                itemPrice={item.price}
                itemCount={item.count}
                info={info}
                version={version}
                getItemIconUrl={getItemIconUrl}
                className="lg-kill-detail-item-slot"
              >
                <img
                  className="lg-kill-detail-item-img"
                  src={getItemIconUrl(version, item.itemID)}
                  alt={item.displayName}
                />
              </ItemTooltip>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Mirrored player side (blue = left, red = right) ────────────────── */

function LgPlayerSide({
  player,
  side,
  isMvp,
  isPartyMember,
  champions,
  version,
  itemData,
}: {
  player: LiveGamePlayer;
  side: 'blue' | 'red';
  isMvp?: boolean;
  isPartyMember?: boolean;
  champions: ChampionBasic[];
  version: string;
  itemData: Record<number, ItemInfo>;
}) {
  const isActive = player.isActivePlayer;

  const itemSlots: (LiveGamePlayer['items'][number] | null)[] = [];
  for (let i = 0; i < MAX_ITEMS; i++) {
    itemSlots.push(player.items.find((item) => item.slot === i) ?? null);
  }

  const sideClass = [
    'lg-sb-side',
    `lg-sb-side--${side}`,
    isActive ? 'lg-sb-side--active' : '',
    player.isDead ? 'lg-sb-side--dead' : '',
  ].filter(Boolean).join(' ');

  const items = (
    <div className="lg-sb-items">
      {itemSlots.map((item, i) => {
        const info = item ? itemData[item.itemID] : undefined;
        return item ? (
          <ItemTooltip
            key={i}
            itemId={item.itemID}
            itemDisplayName={item.displayName}
            itemPrice={item.price}
            itemCount={item.count}
            info={info}
            version={version}
            getItemIconUrl={getItemIconUrl}
            className="lg-sb-item-slot item-tooltip-wrap"
          >
            <img
              className="lg-sb-item-img"
              src={getItemIconUrl(version, item.itemID)}
              alt={item.displayName}
              loading="lazy"
            />
            {item.count > 1 && <span className="lg-sb-item-count">{item.count}</span>}
          </ItemTooltip>
        ) : (
          <div key={i} className="lg-sb-item-slot empty" />
        );
      })}
    </div>
  );

  const info = (
    <div className="lg-sb-player-info">
      {isPartyMember && side === 'blue' && <span className="lg-sb-party-chevron lg-sb-party-chevron--blue" aria-hidden />}
      <span className={`lg-sb-player-name ${isActive ? 'lg-sb-player-name--active' : ''}`}>
        {player.summonerName}
      </span>
      {isPartyMember && side === 'red' && <span className="lg-sb-party-chevron lg-sb-party-chevron--red" aria-hidden />}
    </div>
  );

  const kda = (
    <div className="lg-sb-kda">
      <span className="lg-kda-k">{player.kills}</span>
      <span className="lg-kda-slash">/</span>
      <span className="lg-kda-d">{player.deaths}</span>
      <span className="lg-kda-slash">/</span>
      <span className="lg-kda-a">{player.assists}</span>
    </div>
  );

  const cs = <div className="lg-sb-cs">{player.creepScore}</div>;

  const portrait = (
    <div className={`lg-sb-portrait lg-sb-portrait--${side}${isMvp ? ' lg-sb-portrait--mvp' : ''}`}>
      <img
        className="lg-sb-portrait-img"
        src={getChampionIconUrl(version, player.championName, champions)}
        alt={player.championName}
        loading="lazy"
      />
      {player.isDead && player.respawnTimer > 0 && (
        <span className="lg-sb-respawn">{Math.ceil(player.respawnTimer)}s</span>
      )}
      <span className="lg-sb-portrait-level">{player.level}</span>
    </div>
  );

  // Blue: items → name → KDA → CS → portrait
  // Red:  portrait → CS → KDA → name → items
  if (side === 'blue') {
    return (
      <div className={sideClass}>
        {items}
        {info}
        {kda}
        {cs}
        {portrait}
      </div>
    );
  }

  return (
    <div className={sideClass}>
      {portrait}
      {cs}
      {kda}
      {info}
      {items}
    </div>
  );
}
