import { useMemo, useRef, useState, useEffect, useCallback, Suspense, Component, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import type { LiveGameData, LiveGamePlayer, LiveGameStats, ChampionBasic } from '../types';
import { getModelUrl } from '../api';
import './PostGamePage.css';

interface Props {
  data: LiveGameData;
  champions: ChampionBasic[];
  version: string;
  onBack: () => void;
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

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

function getChampionIconUrl(version: string, championName: string, champions: ChampionBasic[]): string {
  const match = champions.find((c) => c.name.toLowerCase() === championName.toLowerCase());
  if (match) return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${match.id}.png`;
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${championName}.png`;
}

function getItemIconUrl(version: string, itemId: number): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${itemId}.png`;
}

/** MVP score: weighted formula favouring kills, assists, low deaths, and CS */
function mvpScore(p: LiveGamePlayer): number {
  return p.kills * 3 + p.assists * 1.5 - p.deaths * 1.2 + p.creepScore * 0.012;
}

/** KDA ratio as a string */
function kdaRatio(p: LiveGamePlayer): string {
  const kda = (p.kills + p.assists) / Math.max(p.deaths, 1);
  return kda.toFixed(2);
}

const MAX_ITEMS = 7;

/* ── 3D Model (same as LiveGamePage — static idle pose) ──────────── */

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

function PostGameChampionModel({ url }: { url: string }) {
  const { scene, animations } = useGLTF(url);
  const groupRef = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(animations, groupRef);

  const idleName = useMemo(() => findBestIdleName(names), [names]);

  useEffect(() => {
    scene.visible = false;
    if (!groupRef.current) return;

    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        const m = mat as THREE.MeshStandardMaterial & { userData?: Record<string, unknown> };
        if (m.userData?.visible === false) { mesh.visible = false; mesh.castShadow = false; }
        if (m.transparent) { m.alphaTest = m.alphaTest || 0.1; m.depthWrite = true; m.needsUpdate = true; }
      }
    });

    scene.scale.set(1, 1, 1);
    scene.position.set(0, 0, 0);
    scene.rotation.set(0, 0, 0);
    scene.traverse((child) => {
      if (child.scale.x < 0) child.scale.x = Math.abs(child.scale.x);
      if (child.scale.y < 0) child.scale.y = Math.abs(child.scale.y);
      if (child.scale.z < 0) child.scale.z = Math.abs(child.scale.z);
    });

    if (idleName && actions[idleName]) {
      const idle = actions[idleName]!;
      idle.reset().play();
      idle.getMixer().update(0);
      idle.paused = true;
    }
    scene.updateMatrixWorld(true);

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
      modelHeight = Math.abs(overheadY! - groundY!);
    } else {
      const box = new THREE.Box3();
      scene.traverse((child) => { if ((child as THREE.Mesh).isMesh && child.visible) box.expandByObject(child); });
      const size = new THREE.Vector3();
      box.getSize(size);
      modelHeight = size.y || 3;
    }

    const targetHeight = 3.4;
    const scale = targetHeight / Math.max(modelHeight, 0.01);
    scene.scale.setScalar(scale);
    scene.updateMatrixWorld(true);

    let footY = 0, centerX = 0, centerZ = 0;
    const _gp: { v: THREE.Vector3 | null } = { v: null };
    scene.traverse((child) => {
      if (_gp.v === null && (child as THREE.Bone).isBone && /^buffbone_glb_ground_loc$/i.test(child.name)) {
        _gp.v = new THREE.Vector3();
        child.getWorldPosition(_gp.v);
      }
    });
    if (_gp.v) { centerX = _gp.v.x; footY = _gp.v.y; centerZ = _gp.v.z; }
    else {
      const box = new THREE.Box3();
      scene.traverse((child) => { if ((child as THREE.Mesh).isMesh && child.visible) box.expandByObject(child); });
      const center = new THREE.Vector3();
      box.getCenter(center);
      centerX = center.x; centerZ = center.z; footY = box.min.y;
    }

    scene.position.set(-centerX, -footY - 1.7, -centerZ);
    scene.visible = true;
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

class ModelErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode; resetKey?: string }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey) this.setState({ hasError: false });
  }
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}

function ChampionModelCanvas({ url }: { url: string }) {
  return (
    <ModelErrorBoundary resetKey={url} fallback={null}>
      <Canvas
        shadows
        camera={{ position: [0, 0.5, 5.5], fov: 45 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.2, alpha: true }}
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
          <PostGameChampionModel key={url} url={url} />
        </Suspense>
        <OrbitControls enableRotate enablePan={false} enableZoom={false} enableDamping dampingFactor={0.05} target={[0, -0.3, 0]} />
      </Canvas>
    </ModelErrorBoundary>
  );
}

/* ================================================================
   Main PostGamePage component
   ================================================================ */

export function PostGamePage({ data, champions, version, onBack }: Props) {
  const [enterAnim, setEnterAnim] = useState(false);
  useEffect(() => {
    requestAnimationFrame(() => setEnterAnim(true));
  }, []);

  // Find the active (local) player
  const activePlayer = useMemo(
    () => data.players.find((p) => p.isActivePlayer),
    [data.players],
  );

  // Find the overall game MVP (highest mvpScore across ALL players)
  const gameMvp = useMemo(() => {
    if (data.players.length === 0) return undefined;
    return data.players.reduce((best, p) => (mvpScore(p) > mvpScore(best) ? p : best), data.players[0]);
  }, [data.players]);

  // Are you the MVP?
  const youAreMvp = activePlayer && gameMvp && activePlayer.summonerName === gameMvp.summonerName;

  // Resolve model URLs
  const resolveModelUrl = useCallback((player: LiveGamePlayer | undefined) => {
    if (!player) return null;
    const match = champions.find((c) => c.name.toLowerCase() === player.championName.toLowerCase());
    if (!match) return null;
    const skinId = `${parseInt(match.key) * 1000 + player.skinID}`;
    return getModelUrl(match.id, skinId);
  }, [champions]);

  const activeModelUrl = useMemo(() => resolveModelUrl(activePlayer), [activePlayer, resolveModelUrl]);
  const mvpModelUrl = useMemo(() => resolveModelUrl(gameMvp), [gameMvp, resolveModelUrl]);

  // Team results
  const blueTeam = useMemo(() => data.players.filter((p) => p.team === 'ORDER'), [data.players]);
  const redTeam = useMemo(() => data.players.filter((p) => p.team === 'CHAOS'), [data.players]);
  const blueKills = blueTeam.reduce((s, p) => s + p.kills, 0);
  const redKills = redTeam.reduce((s, p) => s + p.kills, 0);

  // Estimate team gold from item prices
  const teamItemGold = (players: typeof blueTeam) =>
    players.reduce((total, p) => total + p.items.reduce((s, item) => s + item.price * item.count, 0), 0);
  const blueGold = teamItemGold(blueTeam);
  const redGold = teamItemGold(redTeam);

  return (
    <div className={`pg-page ${enterAnim ? 'pg-page--enter' : ''}`}>
      <div className="cs-bg-glow" />
      <div className="cs-bg-lines" />

      {/* Header */}
      <div className="pg-top-bar">
        <button className="pg-back" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Continue
        </button>
      </div>

      <div className="pg-header">
        <div className="pg-game-mode">{formatGameMode(data.gameMode)}</div>
        <div className={`pg-title ${data.gameResult === 'Win' ? 'pg-title--victory' : data.gameResult === 'Lose' ? 'pg-title--defeat' : ''}`}>
          {data.gameResult === 'Win' ? 'Victory' : data.gameResult === 'Lose' ? 'Defeat' : 'Game Over'}
        </div>
        <div className="pg-game-info">
          <span className="pg-game-time">{formatTime(data.gameTime)}</span>
          <span className="pg-score-badge">
            <span className="pg-score-blue">{blueKills}</span>
            <span className="pg-score-dash">&ndash;</span>
            <span className="pg-score-red">{redKills}</span>
          </span>
        </div>
      </div>

      {/* 3D models flanking the showcase — left (your champion) and right (MVP) */}
      {activeModelUrl && (
        <div className="pg-model-bg pg-model-bg--left">
          <ChampionModelCanvas url={activeModelUrl} />
        </div>
      )}
      {mvpModelUrl && (
        <div className="pg-model-bg pg-model-bg--right">
          <ChampionModelCanvas url={mvpModelUrl} />
        </div>
      )}

      {/* Two-panel MVP showcase */}
      <div className="pg-showcase">
        {/* LEFT — Your stats */}
        <div className="pg-card pg-card--you">
          <div className="pg-card-label">Your Performance</div>
          {activePlayer && (
            <PlayerCard
              player={activePlayer}
              champions={champions}
              version={version}
              isMvp={!!youAreMvp}
              stats={data.activePlayer.stats}
            />
          )}
        </div>

        {/* Divider */}
        <div className="pg-divider">
          <span className="pg-vs">VS</span>
        </div>

        {/* RIGHT — Game MVP */}
        <div className="pg-card pg-card--mvp">
          <div className="pg-card-label">
            {youAreMvp ? 'You Are the MVP!' : 'Game MVP'}
          </div>
          {gameMvp && (
            <PlayerCard
              player={gameMvp}
              champions={champions}
              version={version}
              isMvp={true}
            />
          )}
        </div>
      </div>

      {/* ── Full Scoreboard (side-by-side mirrored layout) ────────── */}
      <div className="pg-scoreboard-section">
        <div className="pg-scoreboard-title">Final Scoreboard</div>

        <div className="pg-scoreboard">
          {/* Central score header */}
          <div className="pg-sb-header">
            <span className="pg-sb-header-blue">Blue Team</span>
            <div className="pg-sb-header-score">
              <span className="pg-score-blue">{blueKills}</span>
              <svg className="pg-sb-swords" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 7l4-4h4v4l-4 4M8 14l-3 3-2 1 1-2 3-3" />
              </svg>
              <span className="pg-score-red">{redKills}</span>
            </div>
            <span className="pg-sb-header-red">Red Team</span>
          </div>

          {/* Team gold */}
          <div className="pg-sb-gold-bar">
            <span className={`pg-sb-gold-team pg-sb-gold-team--blue${blueGold > redGold ? ' pg-sb-gold-team--leading' : ''}`}>
              <svg className="pg-sb-gold-icon" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="6" /></svg>
              {formatGold(blueGold)}
            </span>
            <span className="pg-sb-gold-label">Team Gold</span>
            <span className={`pg-sb-gold-team pg-sb-gold-team--red${redGold > blueGold ? ' pg-sb-gold-team--leading' : ''}`}>
              {formatGold(redGold)}
              <svg className="pg-sb-gold-icon" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="6" /></svg>
            </span>
          </div>

          {/* Rows: blue player (left) | red player (right) */}
          {Array.from({ length: Math.max(blueTeam.length, redTeam.length) }).map((_, i) => (
            <div key={i} className="pg-sb-match-row">
              {blueTeam[i] ? (
                <PgPlayerSide player={blueTeam[i]} side="blue" champions={champions} version={version} />
              ) : (
                <div className="pg-sb-side pg-sb-side--blue" />
              )}
              <div className="pg-sb-vs-divider" />
              {redTeam[i] ? (
                <PgPlayerSide player={redTeam[i]} side="red" champions={champions} version={version} />
              ) : (
                <div className="pg-sb-side pg-sb-side--red" />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="cs-bottom-border" />
    </div>
  );
}

/* ── Mirrored player side (blue = left, red = right) ────────────────── */

function PgPlayerSide({
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

  const items = (
    <div className="pg-sb-items">
      {itemSlots.map((item, i) => (
        <div key={i} className={`pg-sb-item-slot ${!item ? 'empty' : ''}`}>
          {item && (
            <>
              <img
                className="pg-sb-item-img"
                src={getItemIconUrl(version, item.itemID)}
                alt={item.displayName}
                loading="lazy"
              />
              {item.count > 1 && <span className="pg-sb-item-count">{item.count}</span>}
            </>
          )}
        </div>
      ))}
    </div>
  );

  const info = (
    <div className="pg-sb-player-info">
      <span className={`pg-sb-player-name ${isActive ? 'pg-sb-player-name--active' : ''}`}>
        {player.summonerName}
      </span>
    </div>
  );

  const kda = (
    <div className="pg-sb-kda">
      <span className="pg-kda-k">{player.kills}</span>
      <span className="pg-kda-slash">/</span>
      <span className="pg-kda-d">{player.deaths}</span>
      <span className="pg-kda-slash">/</span>
      <span className="pg-kda-a">{player.assists}</span>
    </div>
  );

  const cs = <div className="pg-sb-cs">{player.creepScore}</div>;

  const portrait = (
    <div className={`pg-sb-portrait pg-sb-portrait--${side}`}>
      <img
        className="pg-sb-portrait-img"
        src={getChampionIconUrl(version, player.championName, champions)}
        alt={player.championName}
        loading="lazy"
      />
      <span className="pg-sb-portrait-level">{player.level}</span>
    </div>
  );

  // Blue reads: items → name → KDA → CS → portrait (left to right)
  // Red reads:  portrait → CS → KDA → name → items (left to right, mirrored)
  if (side === 'blue') {
    return (
      <div className={`pg-sb-side pg-sb-side--blue ${isActive ? 'pg-sb-side--active' : ''}`}>
        {items}
        {info}
        {kda}
        {cs}
        {portrait}
      </div>
    );
  }

  return (
    <div className={`pg-sb-side pg-sb-side--red ${isActive ? 'pg-sb-side--active' : ''}`}>
      {portrait}
      {cs}
      {kda}
      {info}
      {items}
    </div>
  );
}

/* ── Player card sub-component ──────────────────────────────────────── */

function PlayerCard({
  player,
  champions,
  version,
  isMvp,
  stats,
}: {
  player: LiveGamePlayer;
  champions: ChampionBasic[];
  version: string;
  isMvp: boolean;
  stats?: LiveGameStats;
}) {
  const itemSlots: (LiveGamePlayer['items'][number] | null)[] = [];
  for (let i = 0; i < MAX_ITEMS; i++) {
    itemSlots.push(player.items.find((item) => item.slot === i) ?? null);
  }

  return (
    <div className="pg-player-card">
      {/* Champion portrait + name */}
      <div className="pg-player-header">
        <div className="pg-portrait">
          <img
            className="pg-portrait-img"
            src={getChampionIconUrl(version, player.championName, champions)}
            alt={player.championName}
          />
          <span className="pg-portrait-level">{player.level}</span>
        </div>
        <div className="pg-player-identity">
          <span className="pg-player-name">{player.summonerName}</span>
          <span className="pg-player-champ">{player.championName}</span>
        </div>
        {isMvp && <span className="pg-mvp-badge">MVP</span>}
      </div>

      {/* KDA big display */}
      <div className="pg-kda-display">
        <div className="pg-kda-numbers">
          <span className="pg-kda-k">{player.kills}</span>
          <span className="pg-kda-slash">/</span>
          <span className="pg-kda-d">{player.deaths}</span>
          <span className="pg-kda-slash">/</span>
          <span className="pg-kda-a">{player.assists}</span>
        </div>
        <div className="pg-kda-ratio">{kdaRatio(player)} KDA</div>
      </div>

      {/* Stats row */}
      <div className="pg-stats-row">
        <div className="pg-stat">
          <span className="pg-stat-val">{player.creepScore}</span>
          <span className="pg-stat-lbl">CS</span>
        </div>
        <div className="pg-stat">
          <span className="pg-stat-val">{player.level}</span>
          <span className="pg-stat-lbl">Level</span>
        </div>
        <div className="pg-stat">
          <span className="pg-stat-val pg-stat-gold">{player.kills + player.assists}</span>
          <span className="pg-stat-lbl">K+A</span>
        </div>
        <div className="pg-stat">
          <span className="pg-stat-val">{mvpScore(player).toFixed(0)}</span>
          <span className="pg-stat-lbl">Score</span>
        </div>
      </div>

      {/* Detailed stats (only for your own card, since we have the stats object) */}
      {stats && (
        <div className="pg-detail-stats">
          <StatRow label="Attack Damage" value={Math.round(stats.attackDamage)} className="pg-c-ad" />
          <StatRow label="Ability Power" value={Math.round(stats.abilityPower)} className="pg-c-ap" />
          <StatRow label="Armor" value={Math.round(stats.armor)} className="pg-c-armor" />
          <StatRow label="Magic Resist" value={Math.round(stats.magicResist)} className="pg-c-mr" />
          <StatRow label="Attack Speed" value={stats.attackSpeed.toFixed(2)} className="pg-c-as" />
          <StatRow label="Ability Haste" value={Math.round(stats.abilityHaste)} className="pg-c-ah" />
          <StatRow label="Move Speed" value={Math.round(stats.moveSpeed)} className="pg-c-ms" />
          {stats.critChance > 0 && <StatRow label="Crit Chance" value={`${Math.round(stats.critChance * 100)}%`} className="pg-c-crit" />}
          {stats.lifeSteal > 0 && <StatRow label="Life Steal" value={`${Math.round(stats.lifeSteal * 100)}%`} className="pg-c-ls" />}
        </div>
      )}

      {/* Items */}
      <div className="pg-items">
        {itemSlots.map((item, i) => (
          <div key={i} className={`pg-item-slot ${!item ? 'empty' : ''}`}>
            {item && (
              <>
                <img className="pg-item-img" src={getItemIconUrl(version, item.itemID)} alt={item.displayName} />
                {item.count > 1 && <span className="pg-item-count">{item.count}</span>}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatRow({ label, value, className }: { label: string; value: string | number; className?: string }) {
  return (
    <div className="pg-detail-row">
      <span className="pg-detail-label">{label}</span>
      <span className={`pg-detail-value ${className ?? ''}`}>{value}</span>
    </div>
  );
}
