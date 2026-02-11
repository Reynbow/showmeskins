import { useMemo, useRef, useState, useEffect, useCallback, Suspense, Component, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import type { LiveGameData, LiveGamePlayer, ChampionBasic, ItemInfo, PlayerPosition } from '../types';
import { ItemTooltip } from './ItemTooltip';
import { usePlayerModelInfo } from '../hooks/usePlayerModelInfo';
import { getChampionScale } from '../api';
import './PostGamePage.css';

interface Props {
  data: LiveGameData;
  champions: ChampionBasic[];
  version: string;
  itemData: Record<number, ItemInfo>;
  onBack: () => void;
  backLabel?: string;
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
  if (!src) return <span className="pg-role-icon" />;
  return <img className="pg-role-icon" src={src} alt={label} />;
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

/* ── 3D Model — Taunt animation (fallback to idle), auto-sizing ───── */

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

function PostGameChampionModel({ url, chromaTextureUrl }: { url: string; chromaTextureUrl?: string | null }) {
  const { scene, animations } = useGLTF(url);
  const groupRef = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(animations, groupRef);
  const originalTexturesRef = useRef<Map<THREE.MeshStandardMaterial, THREE.Texture | null>>(new Map());
  const loadedChromaTexRef = useRef<THREE.Texture | null>(null);

  const animName = useMemo(() => findBestAnimName(names), [names]);

  /* ── Chroma texture overlay (same logic as LiveGamePage's LiveChampionModel) ── */
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
              if (size > maxSize) { maxSize = size; primaryMats.length = 0; primaryMats.push(m); }
              else if (size === maxSize && size > 0) primaryMats.push(m);
            }
          }
        });
        if (primaryMats.length > 0) {
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
  }, [scene, chromaTextureUrl]);

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

    if (animName && actions[animName]) {
      const anim = actions[animName]!;
      anim.reset().play();
      anim.getMixer().update(0);
      anim.paused = true;
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
    const urlMatch = url.match(/\/models\/([^/]+)\//);
    const alias = urlMatch?.[1] ?? '';
    const scaleMult = getChampionScale(alias);
    const scale = (targetHeight / Math.max(modelHeight, 0.01)) * scaleMult;
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

class ModelErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode; resetKey?: string; onError?: () => void }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch() { this.props.onError?.(); }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey) this.setState({ hasError: false });
  }
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}

function ChampionModelCanvas({ url, fallbackUrl, chromaTextureUrl }: { url: string; fallbackUrl?: string; chromaTextureUrl?: string | null }) {
  const [useFallback, setUseFallback] = useState(false);
  const activeUrl = useFallback && fallbackUrl ? fallbackUrl : url;

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
          <PostGameChampionModel key={activeUrl} url={activeUrl} chromaTextureUrl={chromaTextureUrl} />
        </Suspense>
        <OrbitControls enableRotate enablePan={false} enableZoom={false} enableDamping dampingFactor={0.05} target={[0, -0.3, 0]} />
      </Canvas>
    </ModelErrorBoundary>
  );
}

/* ================================================================
   Main PostGamePage component
   ================================================================ */

export function PostGamePage({ data, champions, version, itemData, onBack, backLabel = 'Continue' }: Props) {
  const [enterAnim, setEnterAnim] = useState(false);
  useEffect(() => {
    requestAnimationFrame(() => setEnterAnim(true));
  }, []);

  // Selected players for the showcase panels (null = default view)
  const [selectedBlue, setSelectedBlue] = useState<LiveGamePlayer | null>(null);
  const [selectedRed, setSelectedRed] = useState<LiveGamePlayer | null>(null);
  const isCustomView = selectedBlue !== null || selectedRed !== null;
  const resetView = () => { setSelectedBlue(null); setSelectedRed(null); };

  const handlePlayerClick = (player: LiveGamePlayer) => {
    if (player.team === 'ORDER') {
      setSelectedBlue((prev) => prev?.summonerName === player.summonerName ? null : player);
    } else {
      setSelectedRed((prev) => prev?.summonerName === player.summonerName ? null : player);
    }
  };

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

  // Top 3 players by MVP score (for the congrats panel)
  const topPlayers = useMemo(() => {
    return [...data.players].sort((a, b) => mvpScore(b) - mvpScore(a)).slice(0, 3);
  }, [data.players]);

  // Determine which players to show in the panels
  const defaultLeftPlayer = youAreMvp ? activePlayer : activePlayer;
  const defaultRightPlayer = youAreMvp ? activePlayer : gameMvp;
  const leftPlayer = selectedBlue ?? defaultLeftPlayer;
  const rightPlayer = selectedRed ?? defaultRightPlayer;

  // Resolve model URLs + chroma textures (uses resolveLcuSkinNum for chroma detection)
  const leftModelInfo = usePlayerModelInfo(leftPlayer, champions);
  const rightModelInfo = usePlayerModelInfo(rightPlayer, champions);

  // Team results
  const blueTeam = useMemo(() => sortByRole(data.players.filter((p) => p.team === 'ORDER')), [data.players]);
  const redTeam = useMemo(() => sortByRole(data.players.filter((p) => p.team === 'CHAOS')), [data.players]);
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
          {backLabel}
        </button>
      </div>

      <div className="pg-header">
        <div className="pg-game-mode">{formatGameMode(data.gameMode)}</div>
        <div className={`pg-title ${data.gameResult === 'Win' ? 'pg-title--victory' : data.gameResult === 'Lose' ? 'pg-title--defeat' : ''}`}>
          {data.gameResult === 'Win' ? 'Victory' : data.gameResult === 'Lose' ? 'Defeat' : 'Game Over'}
        </div>
        <div className="pg-game-info">
          <span className="pg-game-time">{formatTime(data.gameTime)}</span>
        </div>
      </div>

      {/* 3D models flanking the showcase — left and right */}
      {leftModelInfo?.modelUrl && (
        <div className="pg-model-bg pg-model-bg--left">
          <ChampionModelCanvas
            url={leftModelInfo.modelUrl}
            fallbackUrl={leftModelInfo.fallbackUrl}
            chromaTextureUrl={leftModelInfo.chromaTextureUrl}
          />
        </div>
      )}
      {rightModelInfo?.modelUrl && (
        <div className="pg-model-bg pg-model-bg--right">
          <ChampionModelCanvas
            url={rightModelInfo.modelUrl}
            fallbackUrl={rightModelInfo.fallbackUrl}
            chromaTextureUrl={rightModelInfo.chromaTextureUrl}
          />
        </div>
      )}

      {/* Two-panel showcase */}
      <div className="pg-showcase">

        {/* LEFT — team border based on left player's team */}
        <div className={`pg-card pg-card--${(leftPlayer ?? activePlayer)?.team === 'ORDER' ? 'blue' : 'red'}`}>
          <div className="pg-card-label">
            {!isCustomView && youAreMvp
              ? 'Most Valuable Player'
              : selectedBlue
                ? selectedBlue.summonerName
                : 'Your Performance'}
          </div>
          {!isCustomView && youAreMvp && activePlayer ? (
            <div className="pg-mvp-congrats">
              <div className="pg-mvp-congrats-badge">MVP</div>
              <div className="pg-mvp-congrats-name">{activePlayer.summonerName}</div>
              <div className="pg-mvp-congrats-champ">{activePlayer.championName}</div>

              <div className="pg-mvp-congrats-msg">
                {data.gameResult === 'Win'
                  ? 'You carried your team to victory. Outstanding performance!'
                  : 'The best player in the game. Incredible effort despite the loss.'}
              </div>

              <div className="pg-mvp-congrats-divider" />

              <div className="pg-mvp-congrats-standings-label">Top Players</div>
              <div className="pg-mvp-congrats-standings">
                {topPlayers.map((p, i) => (
                  <div key={p.summonerName} className={`pg-mvp-standing ${p.isActivePlayer ? 'pg-mvp-standing--you' : ''}`}>
                    <span className="pg-mvp-standing-rank">#{i + 1}</span>
                    <img
                      className="pg-mvp-standing-icon"
                      src={getChampionIconUrl(version, p.championName, champions)}
                      alt={p.championName}
                    />
                    <div className="pg-mvp-standing-info">
                      <span className="pg-mvp-standing-name">{p.summonerName}</span>
                      <span className="pg-mvp-standing-kda">
                        {p.kills}/{p.deaths}/{p.assists}
                      </span>
                    </div>
                    <span className="pg-mvp-standing-score">{mvpScore(p).toFixed(0)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            leftPlayer && (
              <PlayerCard
                player={leftPlayer}
                champions={champions}
                version={version}
                isMvp={gameMvp?.summonerName === leftPlayer.summonerName}
                teamPlayers={leftPlayer.team === 'ORDER' ? blueTeam : redTeam}
                gameTime={data.gameTime}
                itemData={itemData}
              />
            )
          )}
        </div>

        {/* Divider */}
        <div className="pg-divider">
          <span className="pg-vs">VS</span>
        </div>

        {/* RIGHT — team border based on right player's team */}
        <div className={`pg-card pg-card--${rightPlayer?.team === 'ORDER' ? 'blue' : 'red'}`}>
          <div className="pg-card-label">
            {!isCustomView && youAreMvp
              ? 'Your Stats'
              : selectedRed
                ? selectedRed.summonerName
                : 'Game MVP'}
          </div>
          {rightPlayer && (
            <PlayerCard
              player={rightPlayer}
              champions={champions}
              version={version}
              isMvp={gameMvp?.summonerName === rightPlayer.summonerName}
              teamPlayers={rightPlayer.team === 'ORDER' ? blueTeam : redTeam}
              gameTime={data.gameTime}
              itemData={itemData}
            />
          )}
        </div>
      </div>

      {/* ── Full Scoreboard (side-by-side mirrored layout) ────────── */}
      <div className="pg-scoreboard-section">
        {isCustomView && (
          <button className="pg-reset-view" onClick={resetView}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
            </svg>
            Reset View
          </button>
        )}
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

          {/* Rows: blue player (left) | role icon | red player (right) */}
          {Array.from({ length: Math.max(blueTeam.length, redTeam.length) }).map((_, i) => {
            const rolePos = blueTeam[i]?.position || redTeam[i]?.position || '';
            return (
            <div key={i} className="pg-sb-match-row">
              {blueTeam[i] ? (
                <PgPlayerSide
                  player={blueTeam[i]}
                  side="blue"
                  champions={champions}
                  version={version}
                  itemData={itemData}
                  onClick={() => handlePlayerClick(blueTeam[i])}
                  selected={selectedBlue?.summonerName === blueTeam[i].summonerName}
                />
              ) : (
                <div className="pg-sb-side pg-sb-side--blue" />
              )}
              <div className="pg-sb-vs-divider">
                {rolePos && <RoleIcon position={rolePos as PlayerPosition} />}
              </div>
              {redTeam[i] ? (
                <PgPlayerSide
                  player={redTeam[i]}
                  side="red"
                  champions={champions}
                  version={version}
                  itemData={itemData}
                  onClick={() => handlePlayerClick(redTeam[i])}
                  selected={selectedRed?.summonerName === redTeam[i].summonerName}
                />
              ) : (
                <div className="pg-sb-side pg-sb-side--red" />
              )}
            </div>
            );
          })}
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
  itemData,
  onClick,
  selected,
}: {
  player: LiveGamePlayer;
  side: 'blue' | 'red';
  champions: ChampionBasic[];
  version: string;
  itemData: Record<number, ItemInfo>;
  onClick?: () => void;
  selected?: boolean;
}) {
  const isActive = player.isActivePlayer;

  const itemSlots: (LiveGamePlayer['items'][number] | null)[] = [];
  for (let i = 0; i < MAX_ITEMS; i++) {
    itemSlots.push(player.items.find((item) => item.slot === i) ?? null);
  }

  const items = (
    <div className="pg-sb-items">
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
            className="pg-sb-item-slot item-tooltip-wrap"
          >
            <img
              className="pg-sb-item-img"
              src={getItemIconUrl(version, item.itemID)}
              alt={item.displayName}
              loading="lazy"
            />
            {item.count > 1 && <span className="pg-sb-item-count">{item.count}</span>}
          </ItemTooltip>
        ) : (
          <div key={i} className="pg-sb-item-slot empty" />
        );
      })}
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

  const sideClass = `pg-sb-side pg-sb-side--${side} ${isActive ? 'pg-sb-side--active' : ''} ${selected ? 'pg-sb-side--selected' : ''} pg-sb-side--clickable`;

  // Blue reads: items → name → KDA → CS → portrait (left to right)
  // Red reads:  portrait → CS → KDA → name → items (left to right, mirrored)
  if (side === 'blue') {
    return (
      <div className={sideClass} onClick={onClick}>
        {items}
        {info}
        {kda}
        {cs}
        {portrait}
      </div>
    );
  }

  return (
    <div className={sideClass} onClick={onClick}>
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
  teamPlayers,
  gameTime,
  itemData,
}: {
  player: LiveGamePlayer;
  champions: ChampionBasic[];
  version: string;
  isMvp: boolean;
  teamPlayers: LiveGamePlayer[];
  gameTime: number;
  itemData: Record<number, ItemInfo>;
}) {
  const itemSlots: (LiveGamePlayer['items'][number] | null)[] = [];
  for (let i = 0; i < MAX_ITEMS; i++) {
    itemSlots.push(player.items.find((item) => item.slot === i) ?? null);
  }

  // Derived comparative stats
  const teamKills = teamPlayers.reduce((s, p) => s + p.kills, 0);
  const teamDeaths = teamPlayers.reduce((s, p) => s + p.deaths, 0);
  const killParticipation = teamKills > 0 ? ((player.kills + player.assists) / teamKills) * 100 : 0;
  const deathShare = teamDeaths > 0 ? (player.deaths / teamDeaths) * 100 : 0;
  const estimatedGold = player.items.reduce((s, item) => s + item.price * item.count, 0);
  const minutes = Math.max(gameTime / 60, 1);
  const csPerMin = player.creepScore / minutes;

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

      {/* Comparative stats (available for all players) */}
      <div className="pg-detail-stats">
        <StatRow label="Kill Participation" value={`${Math.round(killParticipation)}%`} className="pg-c-ad" />
        <StatRow label="CS / min" value={csPerMin.toFixed(1)} className="pg-c-as" />
        <StatRow label="Gold (est.)" value={formatGold(estimatedGold)} className="pg-c-gold" />
        <StatRow label="Death Share" value={`${Math.round(deathShare)}%`} className="pg-c-mr" />
      </div>

      {/* Items */}
      <div className="pg-items">
        {itemSlots.map((item, i) => {
          const tip = item ? itemData[item.itemID] : undefined;
          return item ? (
            <ItemTooltip
              key={i}
              itemId={item.itemID}
              itemDisplayName={item.displayName}
              itemPrice={item.price}
              itemCount={item.count}
              info={tip}
              version={version}
              getItemIconUrl={getItemIconUrl}
              className="pg-item-slot item-tooltip-wrap"
            >
              <img className="pg-item-img" src={getItemIconUrl(version, item.itemID)} alt={item.displayName} />
              {item.count > 1 && <span className="pg-item-count">{item.count}</span>}
            </ItemTooltip>
          ) : (
            <div key={i} className="pg-item-slot empty" />
          );
        })}
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
