import { useState, useCallback, useMemo, useRef, useEffect, Suspense, Component, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import type { LiveGameData, LiveGamePlayer, KillEvent, ChampionBasic, ItemInfo, PlayerPosition, ChampionStats } from '../types';
import { getModelUrl, getChampionDetail } from '../api';
import { ItemTooltip } from './ItemTooltip';
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
      { label: 'Magic Pen', key: 'magicPenetrationFlat', color: 'lg-stat-ap', showIf: (v) => v > 0 },
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

/** The 3D champion model with auto-sizing, idle animation, and slow auto-rotation */
function LiveChampionModel({ url }: { url: string }) {
  const { scene, animations } = useGLTF(url);
  const groupRef = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(animations, groupRef);
  const [ready, setReady] = useState(false);

  const animName = useMemo(() => findBestAnimName(names), [names]);

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
      }
    });

    // Reset transforms
    scene.scale.set(1, 1, 1);
    scene.position.set(0, 0, 0);
    scene.rotation.set(0, 0, 0);
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

    // Scale to target height
    const targetHeight = 3.4;
    const scale = targetHeight / Math.max(modelHeight, 0.01);
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
  }, [scene, actions, names, animName, url]);


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

/** Reusable 3D canvas that renders a champion model with lighting + shadows */
function ChampionModelCanvas({ url, fallbackUrl }: { url: string; fallbackUrl?: string }) {
  const [useFallback, setUseFallback] = useState(false);
  const activeUrl = useFallback && fallbackUrl ? fallbackUrl : url;

  // Reset fallback state when the primary URL changes
  useEffect(() => { setUseFallback(false); }, [url]);

  return (
    <ModelErrorBoundary
      resetKey={activeUrl}
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
          <LiveChampionModel key={activeUrl} url={activeUrl} />
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

  // Resolve model URL for a player by champion name + skin
  // Returns { url, fallbackUrl } — fallback is the base skin in case a chroma ID has no model
  const resolveModelUrl = useCallback((player: LiveGamePlayer | undefined) => {
    if (!player) return null;
    const match = champions.find(
      (c) => c.name.toLowerCase() === player.championName.toLowerCase(),
    );
    if (!match) return null;
    const championKey = parseInt(match.key);
    const skinId = `${championKey * 1000 + player.skinID}`;
    const baseSkinId = `${championKey * 1000}`;
    return {
      url: getModelUrl(match.id, skinId),
      fallbackUrl: skinId !== baseSkinId ? getModelUrl(match.id, baseSkinId) : undefined,
    };
  }, [champions]);

  // Active player's model
  const modelUrl = useMemo(
    () => resolveModelUrl(activePlayer),
    [activePlayer, resolveModelUrl],
  );

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

  // Find the enemy with the most kills
  const topEnemy = useMemo(() => {
    if (!activePlayer) return undefined;
    const enemyTeam = activePlayer.team === 'ORDER' ? 'CHAOS' : 'ORDER';
    const enemies = data.players.filter((p) => p.team === enemyTeam);
    if (enemies.length === 0) return undefined;
    return enemies.reduce((best, p) => (p.kills > best.kills ? p : best), enemies[0]);
  }, [data.players, activePlayer]);

  const enemyModelUrl = useMemo(
    () => resolveModelUrl(topEnemy),
    [topEnemy, resolveModelUrl],
  );

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

  // Estimate team gold from item prices (API doesn't expose per-player gold)
  const teamItemGold = (players: typeof blueTeam) =>
    players.reduce((total, p) => total + p.items.reduce((s, item) => s + item.price * item.count, 0), 0);
  const blueGold = teamItemGold(blueTeam);
  const redGold = teamItemGold(redTeam);

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

      {/* Champion models positioned by team: Blue (ORDER) left, Red (CHAOS) right */}
      {activePlayer?.team === 'ORDER' ? (
        <>
          {modelUrl && (
            <div className="lg-model-bg lg-model-bg--left">
              <ChampionModelCanvas url={modelUrl.url} fallbackUrl={modelUrl.fallbackUrl} />
            </div>
          )}
          {enemyModelUrl && (
            <div className="lg-model-bg lg-model-bg--right">
              <ChampionModelCanvas url={enemyModelUrl.url} fallbackUrl={enemyModelUrl.fallbackUrl} />
            </div>
          )}
        </>
      ) : (
        <>
          {enemyModelUrl && (
            <div className="lg-model-bg lg-model-bg--left">
              <ChampionModelCanvas url={enemyModelUrl.url} fallbackUrl={enemyModelUrl.fallbackUrl} />
            </div>
          )}
          {modelUrl && (
            <div className="lg-model-bg lg-model-bg--right">
              <ChampionModelCanvas url={modelUrl.url} fallbackUrl={modelUrl.fallbackUrl} />
            </div>
          )}
        </>
      )}

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
            return (
            <div key={i} className="lg-sb-match-row">
              {blueTeam[i] ? (
                <LgPlayerSide player={blueTeam[i]} side="blue" champions={champions} version={version} itemData={itemData} />
              ) : (
                <div className="lg-sb-side lg-sb-side--blue" />
              )}
              <div className="lg-sb-vs-divider">
                {rolePos && <RoleIcon position={rolePos as PlayerPosition} />}
              </div>
              {redTeam[i] ? (
                <LgPlayerSide player={redTeam[i]} side="red" champions={champions} version={version} itemData={itemData} />
              ) : (
                <div className="lg-sb-side lg-sb-side--red" />
              )}
            </div>
            );
          })}
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
            kills={data.killFeed}
            players={data.players}
            champions={champions}
            version={version}
          />
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
}: {
  isEntity: boolean;
  champ: string;
  displayName: string;
  side: string;
  version: string;
  champions: ChampionBasic[];
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
      <img
        className={`lg-kill-icon lg-kill-icon--${side}`}
        src={getChampionIconUrl(version, champ, champions)}
        alt={champ}
      />
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
  champions,
  version,
}: {
  kills: KillEvent[];
  players: LiveGamePlayer[];
  champions: ChampionBasic[];
  version: string;
}) {
  // Build a map from summoner name → team
  const nameToTeam = useMemo(() => {
    const map: Record<string, 'ORDER' | 'CHAOS'> = {};
    for (const p of players) {
      map[p.summonerName] = p.team;
    }
    return map;
  }, [players]);

  // All kills, most recent first
  const allKills = useMemo(() => [...kills].reverse(), [kills]);

  return (
    <div className="lg-killfeed">
      <div className="lg-killfeed-header">
        <span className="lg-killfeed-title">Kill Feed</span>
        <span className="lg-killfeed-count">{kills.length} kills</span>
      </div>
      <div className="lg-killfeed-list">
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

          return (
            <div key={`${kill.eventTime}-${i}`} className="lg-kill-entry">
              <span className="lg-kill-time">{formatTime(kill.eventTime)}</span>
              <KillFeedEntity
                isEntity={killerIsEntity}
                champ={kill.killerChamp}
                displayName={kill.killerName}
                side={killerSide}
                version={version}
                champions={champions}
              />
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
              />
              {kill.assisters.length > 0 && (
                <span className="lg-kill-assists">
                  + {kill.assisters.join(', ')}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Mirrored player side (blue = left, red = right) ────────────────── */

function LgPlayerSide({
  player,
  side,
  champions,
  version,
  itemData,
}: {
  player: LiveGamePlayer;
  side: 'blue' | 'red';
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
      <span className={`lg-sb-player-name ${isActive ? 'lg-sb-player-name--active' : ''}`}>
        {player.summonerName}
      </span>
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
    <div className={`lg-sb-portrait lg-sb-portrait--${side}`}>
      <img
        className="lg-sb-portrait-img"
        src={getChampionIconUrl(version, player.championName, champions)}
        alt={player.championName}
        loading="lazy"
      />
      <span className="lg-sb-portrait-level">{player.level}</span>
    </div>
  );

  const respawn = player.isDead && player.respawnTimer > 0 ? (
    <span className="lg-sb-respawn">{Math.ceil(player.respawnTimer)}s</span>
  ) : null;

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
        {respawn}
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
      {respawn}
    </div>
  );
}
