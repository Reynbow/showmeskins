import { useState, useCallback, useMemo, useRef, useEffect, Suspense, Component, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import type { LiveGameData, LiveGamePlayer, ChampionBasic } from '../types';
import { getModelUrl } from '../api';
import './LiveGamePage.css';

interface Props {
  data: LiveGameData;
  champions: ChampionBasic[];
  version: string;
  onBack: () => void;
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

/** Readable game mode names */
function formatGameMode(mode: string): string {
  const map: Record<string, string> = {
    CLASSIC: 'Summoner\'s Rift',
    ARAM: 'ARAM',
    URF: 'URF',
    ONEFORALL: 'One for All',
    TUTORIAL: 'Tutorial',
    PRACTICETOOL: 'Practice Tool',
    NEXUSBLITZ: 'Nexus Blitz',
    CHERRY: 'Arena',
  };
  return map[mode] ?? mode;
}

/** Max item slots per player */
const MAX_ITEMS = 7;

/** Stats we display in the panel */
const STAT_CONFIG: {
  label: string;
  key: keyof LiveGameData['activePlayer']['stats'];
  color: string;
  format?: (v: number) => string;
  showIf?: (v: number) => boolean;
}[] = [
  { label: 'Attack Damage', key: 'attackDamage', color: 'lg-stat-ad' },
  { label: 'Ability Power', key: 'abilityPower', color: 'lg-stat-ap' },
  { label: 'Armor', key: 'armor', color: 'lg-stat-armor' },
  { label: 'Magic Resist', key: 'magicResist', color: 'lg-stat-mr' },
  { label: 'Attack Speed', key: 'attackSpeed', color: 'lg-stat-as', format: (v) => v.toFixed(2) },
  { label: 'Ability Haste', key: 'abilityHaste', color: 'lg-stat-ah' },
  { label: 'Max Health', key: 'maxHealth', color: 'lg-stat-hp' },
  { label: 'Move Speed', key: 'moveSpeed', color: 'lg-stat-ms' },
  { label: 'Crit Chance', key: 'critChance', color: 'lg-stat-crit', format: (v) => `${Math.round(v * 100)}%`, showIf: (v) => v > 0 },
  { label: 'Life Steal', key: 'lifeSteal', color: 'lg-stat-ls', format: (v) => `${Math.round(v * 100)}%`, showIf: (v) => v > 0 },
  { label: 'Omnivamp', key: 'omnivamp', color: 'lg-stat-ls', format: (v) => `${Math.round(v * 100)}%`, showIf: (v) => v > 0 },
  { label: 'Phys. Lethality', key: 'physicalLethality', color: 'lg-stat-lethality', showIf: (v) => v > 0 },
  { label: 'Magic Pen', key: 'magicPenetrationFlat', color: 'lg-stat-ap', showIf: (v) => v > 0 },
  { label: 'Tenacity', key: 'tenacity', color: 'lg-stat-ms', format: (v) => `${Math.round(v)}%`, showIf: (v) => v > 0 },
  { label: 'Heal & Shield', key: 'healShieldPower', color: 'lg-stat-ls', showIf: (v) => v > 0 },
];

/* ================================================================
   Simplified 3D Model — Idle animation, auto-sizing, auto-rotate
   ================================================================ */

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

function findBestIdleName(names: string[]): string | undefined {
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

  const idleName = useMemo(() => findBestIdleName(names), [names]);

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

    // Play idle animation, tick one frame to pose the skeleton, then pause
    if (idleName && actions[idleName]) {
      const idle = actions[idleName]!;
      idle.reset().play();
      idle.getMixer().update(0);
      idle.paused = true;
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
  }, [scene, actions, names, idleName, url]);

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
class ModelErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode; resetKey?: string }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey) this.setState({ hasError: false });
  }
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}

/** Reusable 3D canvas that renders a champion model with lighting + shadows */
function ChampionModelCanvas({ url }: { url: string }) {
  return (
    <ModelErrorBoundary resetKey={url} fallback={null}>
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
          <LiveChampionModel key={url} url={url} />
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

export function LiveGamePage({ data, champions, version, onBack }: Props) {
  const [showStats, setShowStats] = useState(true);
  const toggleStats = useCallback(() => setShowStats((s) => !s), []);

  // Find the active player
  const activePlayer = useMemo(
    () => data.players.find((p) => p.isActivePlayer),
    [data.players],
  );

  // Resolve model URL for a player by champion name + skin
  const resolveModelUrl = useCallback((player: LiveGamePlayer | undefined) => {
    if (!player) return null;
    const match = champions.find(
      (c) => c.name.toLowerCase() === player.championName.toLowerCase(),
    );
    if (!match) return null;
    const skinId = `${parseInt(match.key) * 1000 + player.skinID}`;
    return getModelUrl(match.id, skinId);
  }, [champions]);

  // Active player's model
  const modelUrl = useMemo(
    () => resolveModelUrl(activePlayer),
    [activePlayer, resolveModelUrl],
  );

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

  // Split players into teams
  const blueTeam = useMemo(
    () => data.players.filter((p) => p.team === 'ORDER'),
    [data.players],
  );
  const redTeam = useMemo(
    () => data.players.filter((p) => p.team === 'CHAOS'),
    [data.players],
  );

  const blueKills = blueTeam.reduce((sum, p) => sum + p.kills, 0);
  const redKills = redTeam.reduce((sum, p) => sum + p.kills, 0);

  const visibleStats = STAT_CONFIG.filter((s) => {
    const val = data.activePlayer.stats[s.key] as number;
    return s.showIf ? s.showIf(val) : true;
  });

  return (
    <div className="live-game-page">
      <div className="cs-bg-glow" />
      <div className="cs-bg-lines" />

      {/* Your champion model — left of scoreboard */}
      {modelUrl && (
        <div className="lg-model-bg lg-model-bg--left">
          <ChampionModelCanvas url={modelUrl} />
        </div>
      )}

      {/* Enemy top-killer model — right of scoreboard, mirrored */}
      {enemyModelUrl && (
        <div className="lg-model-bg lg-model-bg--right">
          <ChampionModelCanvas url={enemyModelUrl} />
        </div>
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

        {/* Active player gold */}
        <div className="lg-gold-bar">
          <svg className="lg-gold-icon" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="8" cy="8" r="6" />
          </svg>
          {formatGold(data.activePlayer.currentGold)} Gold
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

          {/* Rows: blue player (left) | red player (right) */}
          {Array.from({ length: Math.max(blueTeam.length, redTeam.length) }).map((_, i) => (
            <div key={i} className="lg-sb-match-row">
              {blueTeam[i] ? (
                <LgPlayerSide player={blueTeam[i]} side="blue" champions={champions} version={version} />
              ) : (
                <div className="lg-sb-side lg-sb-side--blue" />
              )}
              <div className="lg-sb-vs-divider" />
              {redTeam[i] ? (
                <LgPlayerSide player={redTeam[i]} side="red" champions={champions} version={version} />
              ) : (
                <div className="lg-sb-side lg-sb-side--red" />
              )}
            </div>
          ))}
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
            <div className="lg-stats-grid">
              <div className="lg-stat-item">
                <span className="lg-stat-label">Gold</span>
                <span className="lg-stat-value lg-stat-gold">
                  {formatGold(data.activePlayer.currentGold)}
                </span>
              </div>
              {visibleStats.map((stat) => {
                const val = data.activePlayer.stats[stat.key] as number;
                const formatted = stat.format ? stat.format(val) : Math.round(val).toString();
                return (
                  <div key={stat.key} className="lg-stat-item">
                    <span className="lg-stat-label">{stat.label}</span>
                    <span className={`lg-stat-value ${stat.color}`}>{formatted}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="cs-bottom-border" />
    </div>
  );
}

/* ── Mirrored player side (blue = left, red = right) ────────────────── */

function LgPlayerSide({
  player,
  side,
  champions,
  version,
}: {
  player: LiveGamePlayer;
  side: 'blue' | 'red';
  champions: ChampionBasic[];
  version: string;
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
      {itemSlots.map((item, i) => (
        <div key={i} className={`lg-sb-item-slot ${!item ? 'empty' : ''}`}>
          {item && (
            <>
              <img
                className="lg-sb-item-img"
                src={getItemIconUrl(version, item.itemID)}
                alt={item.displayName}
                loading="lazy"
              />
              {item.count > 1 && <span className="lg-sb-item-count">{item.count}</span>}
            </>
          )}
        </div>
      ))}
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
