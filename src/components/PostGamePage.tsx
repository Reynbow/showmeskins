import { useMemo, useRef, useState, useEffect, useCallback, Suspense, Component, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import type { LiveGameData, LiveGamePlayer, KillEvent, KillEventPlayerSnapshot, ChampionBasic, ItemInfo, PlayerPosition } from '../types';
import { ItemTooltip } from './ItemTooltip';
import { TextTooltip } from './TextTooltip';
import { usePlayerModelInfo } from '../hooks/usePlayerModelInfo';
import { getChampionScale, FRIGHT_NIGHT_BASE_SKIN_IDS } from '../api';
import { enrichKillFeed } from '../utils/killFeed';
import { buildKillEventKeys } from '../utils/killFeedKey';
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

function normalizePlayerName(name: string): string {
  return name.trim().toLowerCase();
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

  const isFrightNight = useMemo(() => {
    const m = url.match(/\/models\/([^/]+)\/([^/]+)\//);
    return m != null && FRIGHT_NIGHT_BASE_SKIN_IDS.has(m[2]);
  }, [url]);

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
        if (isFrightNight && m.map) {
          m.map.wrapS = THREE.ClampToEdgeWrapping;
          m.map.wrapT = THREE.ClampToEdgeWrapping;
          m.map.needsUpdate = true;
        }
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
  }, [scene, actions, names, animName, url, isFrightNight]);


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
  let leftPlayer = selectedBlue ?? defaultLeftPlayer;
  let rightPlayer = selectedRed ?? defaultRightPlayer;

  // When showing one blue and one red, always place blue on left, red on right
  if (leftPlayer && rightPlayer && leftPlayer.team !== rightPlayer.team) {
    if (leftPlayer.team === 'CHAOS' && rightPlayer.team === 'ORDER') {
      [leftPlayer, rightPlayer] = [rightPlayer, leftPlayer];
    }
  }

  // Resolve model URLs + chroma textures (uses resolveLcuSkinNum for chroma detection)
  const leftModelInfo = usePlayerModelInfo(leftPlayer, champions);
  const rightModelInfo = usePlayerModelInfo(rightPlayer, champions);

  // Team results
  const blueTeam = useMemo(() => sortByRole(data.players.filter((p) => p.team === 'ORDER')), [data.players]);
  const redTeam = useMemo(() => sortByRole(data.players.filter((p) => p.team === 'CHAOS')), [data.players]);
  const blueKills = blueTeam.reduce((s, p) => s + p.kills, 0);
  const redKills = redTeam.reduce((s, p) => s + p.kills, 0);

  // Active player row index and side (for floating "you" chevron)
  const activePlayerRow = useMemo(() => {
    if (!activePlayer) return null;
    const blueIdx = blueTeam.findIndex((p) => p.summonerName === activePlayer.summonerName);
    if (blueIdx >= 0) return { index: blueIdx, side: 'blue' as const };
    const redIdx = redTeam.findIndex((p) => p.summonerName === activePlayer.summonerName);
    if (redIdx >= 0) return { index: redIdx, side: 'red' as const };
    return null;
  }, [activePlayer, blueTeam, redTeam]);

  // MVP row index and side (for floating MVP badge)
  const mvpRow = useMemo(() => {
    if (!gameMvp) return null;
    const blueIdx = blueTeam.findIndex((p) => p.summonerName === gameMvp.summonerName);
    if (blueIdx >= 0) return { index: blueIdx, side: 'blue' as const };
    const redIdx = redTeam.findIndex((p) => p.summonerName === gameMvp.summonerName);
    if (redIdx >= 0) return { index: redIdx, side: 'red' as const };
    return null;
  }, [gameMvp, blueTeam, redTeam]);

  const scoreboardRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLDivElement | null>(null);
  const mvpRowRef = useRef<HTMLDivElement | null>(null);
  const [chevronTop, setChevronTop] = useState<number | null>(null);
  const [mvpTop, setMvpTop] = useState<number | null>(null);

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
            {isCustomView && selectedBlue
              ? selectedBlue.summonerName
              : youAreMvp && leftPlayer?.summonerName === activePlayer?.summonerName
                ? 'Most Valuable Player'
                : leftPlayer?.summonerName === activePlayer?.summonerName
                  ? 'Your Performance'
                  : leftPlayer?.summonerName === gameMvp?.summonerName
                    ? 'Game MVP'
                    : leftPlayer?.summonerName ?? 'Your Performance'}
          </div>
          {!isCustomView && youAreMvp && activePlayer ? (
            <div className="pg-mvp-congrats">
              <TextTooltip content={getMvpScoreBreakdown(activePlayer)} variant="mvp" className="pg-mvp-congrats-badge-wrap">
                <div className="pg-mvp-congrats-badge">MVP</div>
              </TextTooltip>
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

        {/* Divider (spacing only) */}
        <div className="pg-divider" />

        {/* RIGHT — team border based on right player's team */}
        <div className={`pg-card pg-card--${rightPlayer?.team === 'ORDER' ? 'blue' : 'red'}`}>
          <div className="pg-card-label">
            {isCustomView && selectedRed
              ? selectedRed.summonerName
              : youAreMvp && rightPlayer?.summonerName === activePlayer?.summonerName
                ? 'Your Stats'
                : rightPlayer?.summonerName === activePlayer?.summonerName
                  ? 'Your Performance'
                  : rightPlayer?.summonerName === gameMvp?.summonerName
                    ? 'Game MVP'
                    : rightPlayer?.summonerName ?? 'Game MVP'}
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

        <div className="pg-scoreboard-wrap" ref={scoreboardRef}>
          {activePlayerRow && chevronTop != null && (
            <div
              className={`pg-sb-you-chevron pg-sb-you-chevron--${activePlayerRow.side}${activePlayerRow.index === mvpRow?.index && activePlayerRow.side === mvpRow?.side ? ' pg-sb-you-chevron--with-mvp' : ''}`}
              style={{ top: chevronTop }}
              aria-hidden
            />
          )}
          {mvpRow && mvpTop != null && gameMvp && (
            <TextTooltip content={getMvpScoreBreakdown(gameMvp)} variant="mvp">
              <div
                className={`pg-sb-mvp-float pg-sb-mvp-float--${mvpRow.side}`}
                style={{ top: mvpTop }}
                aria-hidden
              >
                MVP
              </div>
            </TextTooltip>
          )}
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
            const isActiveRow = activePlayerRow?.index === i;
            const isMvpRow = mvpRow?.index === i;
            return (
            <div
              key={i}
              className="pg-sb-match-row"
              ref={(el) => {
                if (isActiveRow) activeRowRef.current = el;
                if (isMvpRow) mvpRowRef.current = el;
              }}
            >
              {blueTeam[i] ? (
                <PgPlayerSide
                  player={blueTeam[i]}
                  side="blue"
                  isMvp={gameMvp?.summonerName === blueTeam[i].summonerName}
                  isPartyMember={isPartyMember(blueTeam[i])}
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
                  isMvp={gameMvp?.summonerName === redTeam[i].summonerName}
                  isPartyMember={isPartyMember(redTeam[i])}
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
      </div>

      {/* ── Full Kill Feed ────────────────────────────────────────── */}
      {data.killFeed && data.killFeed.length > 0 && (
        <div className="pg-killfeed-section">
          <PostGameKillFeed
            kills={enrichKillFeed(data.killFeed)}
            players={data.players}
            killFeedSnapshots={data.killFeedSnapshots}
            champions={champions}
            version={version}
            itemData={itemData}
          />
        </div>
      )}

      <div className="cs-bottom-border" />
    </div>
  );
}

/* ── Mirrored player side (blue = left, red = right) ────────────────── */

function PgPlayerSide({
  player,
  side,
  isMvp,
  isPartyMember,
  champions,
  version,
  itemData,
  onClick,
  selected,
}: {
  player: LiveGamePlayer;
  side: 'blue' | 'red';
  isMvp?: boolean;
  isPartyMember?: boolean;
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
      {isPartyMember && side === 'blue' && <span className="pg-sb-party-chevron pg-sb-party-chevron--blue" aria-hidden />}
      <span className={`pg-sb-player-name ${isActive ? 'pg-sb-player-name--active' : ''}`}>
        {player.summonerName}
      </span>
      {isPartyMember && side === 'red' && <span className="pg-sb-party-chevron pg-sb-party-chevron--red" aria-hidden />}
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
    <div className={`pg-sb-portrait pg-sb-portrait--${side}${isMvp ? ' pg-sb-portrait--mvp' : ''}`}>
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
        {isMvp && (
          <TextTooltip content={getMvpScoreBreakdown(player)} variant="mvp">
            <span className="pg-mvp-badge">MVP</span>
          </TextTooltip>
        )}
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

/* ── Post-Game Kill Feed ─────────────────────────────────────────────── */

const ENTITY_ICONS: Record<string, string> = {
  _turret: '\u{1F3F0}', _turret_blue: '\u{1F3F0}', _turret_red: '\u{1F3F0}',
  _baron: '\u{1F47E}', _dragon: '\u{1F409}', _herald: '\u{1F441}',
  _voidgrub: '\u{1FAB2}', _minion: '\u2694', _minion_blue: '\u2694',
  _minion_red: '\u2694', _jungle: '\u{1F33F}', _unknown: '\u2753',
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

function PgKillFeedEntity({
  isEntity, champ, displayName, side, version: ver, champions: champs, level,
}: {
  isEntity: boolean; champ: string; displayName: string;
  side: string; version: string; champions: ChampionBasic[]; level?: number;
}) {
  if (isEntity) {
    return (
      <>
        <span className={`pg-kf-entity-icon pg-kf-icon--${side}`}>{ENTITY_ICONS[champ] ?? '\u2753'}</span>
        <span className={`pg-kf-name pg-kf-name--${side}`}>{displayName}</span>
      </>
    );
  }
  return (
    <>
      <span className={`pg-kf-portrait pg-kf-icon--${side}`}>
        <img className="pg-kf-portrait-img" src={getChampionIconUrl(ver, champ, champs)} alt={champ} />
        {level != null && <span className="pg-kf-portrait-level">{level}</span>}
      </span>
      <span className={`pg-kf-name pg-kf-name--${side}`}>{champ}</span>
    </>
  );
}

function PgKillDetailColumn({
  label, player, champ, isEntity, side, version: ver, champions: champs, itemData: items,
}: {
  label: string; player?: LiveGamePlayer; champ: string; isEntity: boolean;
  side: string; version: string; champions: ChampionBasic[]; itemData: Record<number, ItemInfo>;
}) {
  if (isEntity) {
    return (
      <div className="pg-kf-detail-col">
        <span className="pg-kf-detail-label">{label}</span>
        <div className="pg-kf-detail-entity">
          <span className={`pg-kf-entity-icon pg-kf-icon--${side}`}>{ENTITY_ICONS[champ] ?? '\u2753'}</span>
          <span className={`pg-kf-name pg-kf-name--${side}`}>{champ.replace(/^_/, '')}</span>
        </div>
      </div>
    );
  }
  if (!player) {
    return (
      <div className="pg-kf-detail-col">
        <span className="pg-kf-detail-label">{label}</span>
        <span className="pg-kf-detail-unknown">Unknown</span>
      </div>
    );
  }
  const playerItems = player.items.filter((it) => it.itemID > 0);
  return (
    <div className="pg-kf-detail-col">
      <span className="pg-kf-detail-label">{label}</span>
      <div className="pg-kf-detail-champ">
        <img className={`pg-kf-detail-champ-icon pg-kf-icon--${side}`} src={getChampionIconUrl(ver, player.championName, champs)} alt={player.championName} />
        <div className="pg-kf-detail-champ-info">
          <span className={`pg-kf-detail-champ-name pg-kf-name--${side}`}>{player.championName}</span>
          <span className="pg-kf-detail-summoner">{player.summonerName}</span>
        </div>
      </div>
      <div className="pg-kf-detail-stats">
        <div className="pg-kf-detail-stat"><span className="pg-kf-detail-stat-label">Level</span><span className="pg-kf-detail-stat-value">{player.level}</span></div>
        <div className="pg-kf-detail-stat">
          <span className="pg-kf-detail-stat-label">KDA</span>
          <span className="pg-kf-detail-stat-value">
            <span className="pg-kda-k">{player.kills}</span><span className="pg-kda-slash">/</span>
            <span className="pg-kda-d">{player.deaths}</span><span className="pg-kda-slash">/</span>
            <span className="pg-kda-a">{player.assists}</span>
          </span>
        </div>
        <div className="pg-kf-detail-stat"><span className="pg-kf-detail-stat-label">CS</span><span className="pg-kf-detail-stat-value">{player.creepScore}</span></div>
      </div>
      {playerItems.length > 0 && (
        <div className="pg-kf-detail-items">
          {playerItems.map((item, idx) => {
            const info = items[item.itemID];
            return (
              <ItemTooltip key={idx} itemId={item.itemID} itemDisplayName={item.displayName} itemPrice={item.price} itemCount={item.count} info={info} version={ver} getItemIconUrl={getItemIconUrl} className="pg-kf-detail-item-slot">
                <img className="pg-kf-detail-item-img" src={getItemIconUrl(ver, item.itemID)} alt={item.displayName} />
              </ItemTooltip>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PostGameKillFeed({
  kills, players, killFeedSnapshots, champions: champs, version: ver, itemData: items,
}: {
  kills: KillEvent[]; players: LiveGamePlayer[]; champions: ChampionBasic[];
  killFeedSnapshots?: Record<number, KillEventPlayerSnapshot>;
  version: string; itemData: Record<number, ItemInfo>;
}) {
  const nameToTeam = useMemo(() => {
    const map: Record<string, 'ORDER' | 'CHAOS'> = {};
    for (const p of players) map[p.summonerName] = p.team;
    return map;
  }, [players]);

  const nameToPlayer = useMemo(() => {
    const map: Record<string, LiveGamePlayer> = {};
    for (const p of players) map[p.summonerName] = p;
    return map;
  }, [players]);

  const champToPlayer = useMemo(() => {
    const map: Record<string, LiveGamePlayer> = {};
    for (const p of players) map[p.championName] = p;
    return map;
  }, [players]);

  const activePlayerName = useMemo(
    () => players.find((p) => p.isActivePlayer)?.summonerName ?? null,
    [players],
  );

  const killKeys = useMemo(() => buildKillEventKeys(kills), [kills]);
  const allKillEntries = useMemo(
    () => kills.map((kill, idx) => ({ kill, key: killKeys[idx] })).reverse(),
    [kills, killKeys],
  );

  const [expandedKillKey, setExpandedKillKey] = useState<string | null>(null);

  const handleExpand = useCallback((killKey: string) => {
    setExpandedKillKey((prev) => (prev === killKey ? null : killKey));
  }, []);

  return (
    <div className="pg-killfeed">
      <div className="pg-killfeed-header">
        <span className="pg-killfeed-title">Kill Feed</span>
        <span className="pg-killfeed-count">{kills.length} kills</span>
      </div>
      <div className="pg-killfeed-list">
        {allKillEntries.map(({ kill, key }, i) => {
          const killerIsEntity = kill.killerChamp.startsWith('_');
          const victimIsEntity = kill.victimChamp.startsWith('_');
          const killerTeam = nameToTeam[kill.killerName];
          const victimTeam = nameToTeam[kill.victimName];
          const killerSide = killerTeam === 'ORDER' ? 'blue'
            : killerTeam === 'CHAOS' ? 'red'
            : kill.killerChamp.includes('blue') ? 'blue'
            : kill.killerChamp.includes('red') ? 'red' : 'neutral';
          const victimSide = victimTeam === 'ORDER' ? 'blue'
            : victimTeam === 'CHAOS' ? 'red'
            : kill.victimChamp.includes('blue') ? 'blue'
            : kill.victimChamp.includes('red') ? 'red' : 'neutral';

          const isYourKill = activePlayerName != null && kill.killerName === activePlayerName;
          const isExpanded = expandedKillKey === key;
          const snapshot = killFeedSnapshots?.[kill.eventTime];

          const liveAssisterPlayers = kill.assisters
            .map((champName) => champToPlayer[champName])
            .filter(Boolean) as LiveGamePlayer[];

          const assisterPlayers = kill.assisters
            .map((champName) => snapshot?.byChamp[champName] ?? champToPlayer[champName])
            .filter(Boolean) as LiveGamePlayer[];

          const killerPlayer = snapshot?.byName[kill.killerName] ?? nameToPlayer[kill.killerName];
          const victimPlayer = snapshot?.byName[kill.victimName] ?? nameToPlayer[kill.victimName];

          return (
            <div
              key={`${key}-${i}`}
              className="pg-kf-wrapper"
            >
              <div
                className={`pg-kf-entry${isYourKill ? ' pg-kf-entry--your-kill' : ''}${isExpanded ? ' pg-kf-entry--expanded' : ''}`}
                onClick={() => handleExpand(key)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleExpand(key); } }}
              >
                <span className="pg-kf-time">{formatTime(kill.eventTime)}</span>
                <PgKillFeedEntity isEntity={killerIsEntity} champ={kill.killerChamp} displayName={kill.killerName} side={killerSide} version={ver} champions={champs} level={killerPlayer?.level} />
                {liveAssisterPlayers.length > 0 && (
                  <span className="pg-kf-assist-icons">
                    <span className="pg-kf-assist-plus">+</span>
                    {liveAssisterPlayers.map((ap) => {
                      const apSide = nameToTeam[ap.summonerName] === 'ORDER' ? 'blue' : nameToTeam[ap.summonerName] === 'CHAOS' ? 'red' : 'neutral';
                      return (
                        <img key={ap.summonerName} className={`pg-kf-assist-mini-icon pg-kf-icon--${apSide}`} src={getChampionIconUrl(ver, ap.championName, champs)} alt={ap.championName} title={ap.championName} />
                      );
                    })}
                  </span>
                )}
                <svg className="pg-kf-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M13 5l6 7-6 7" />
                </svg>
                <PgKillFeedEntity isEntity={victimIsEntity} champ={kill.victimChamp} displayName={kill.victimName} side={victimSide} version={ver} champions={champs} level={victimPlayer?.level} />
                <span className="pg-kf-right">
                  {(kill.multiKill || kill.killStreak) && (
                    <span className="pg-kf-badges">
                      {kill.multiKill && (
                        <TextTooltip text={MULTI_KILL_TOOLTIPS[kill.multiKill]} variant={kill.multiKill} className={`pg-kf-badge pg-kf-badge--multikill pg-kf-badge--${kill.multiKill}`}>
                          {kill.multiKill === 'double' && 'Double Kill'}
                          {kill.multiKill === 'triple' && 'Triple Kill'}
                          {kill.multiKill === 'quadra' && 'Quadra Kill'}
                          {kill.multiKill === 'penta' && 'Penta Kill'}
                          {kill.multiKillCount != null && kill.multiKillCount > 1 && <span className="pg-kf-badge-multiplier">\u00d7{kill.multiKillCount}</span>}
                        </TextTooltip>
                      )}
                      {kill.killStreak && (
                        <TextTooltip text={KILL_STREAK_TOOLTIPS[kill.killStreak]} variant={kill.killStreak} className={`pg-kf-badge pg-kf-badge--streak pg-kf-badge--${kill.killStreak}`}>
                          {kill.killStreak === 'killing_spree' && 'Killing Spree'}
                          {kill.killStreak === 'rampage' && 'Rampage'}
                          {kill.killStreak === 'unstoppable' && 'Unstoppable'}
                          {kill.killStreak === 'godlike' && 'Godlike'}
                          {kill.killStreak === 'legendary' && 'Legendary'}
                          {kill.killStreakCount != null && kill.killStreakCount > 1 && <span className="pg-kf-badge-multiplier">\u00d7{kill.killStreakCount}</span>}
                        </TextTooltip>
                      )}
                    </span>
                  )}
                </span>
                <svg className={`pg-kf-chevron${isExpanded ? ' pg-kf-chevron--open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </div>

              {isExpanded && (
                <div className="pg-kf-detail">
                  <div className="pg-kf-detail-columns">
                    <PgKillDetailColumn label="Killer" player={killerPlayer} champ={kill.killerChamp} isEntity={killerIsEntity} side={killerSide} version={ver} champions={champs} itemData={items} />
                    {assisterPlayers.length > 0 && (
                      <div className="pg-kf-detail-col pg-kf-detail-col--assists">
                        <span className="pg-kf-detail-label">Assists</span>
                        <div className="pg-kf-detail-assist-list">
                          {assisterPlayers.map((ap) => {
                            const apSide = nameToTeam[ap.summonerName] === 'ORDER' ? 'blue' : nameToTeam[ap.summonerName] === 'CHAOS' ? 'red' : 'neutral';
                            return (
                              <div key={ap.summonerName} className="pg-kf-detail-assist-player">
                                <img className={`pg-kf-detail-assist-icon pg-kf-icon--${apSide}`} src={getChampionIconUrl(ver, ap.championName, champs)} alt={ap.championName} />
                                <div className="pg-kf-detail-assist-info">
                                  <span className={`pg-kf-detail-assist-name pg-kf-name--${apSide}`}>{ap.championName}</span>
                                  <span className="pg-kf-detail-assist-kda">{ap.kills}/{ap.deaths}/{ap.assists}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <div className="pg-kf-detail-vs">
                      <span className="pg-kf-detail-vs-text">VS</span>
                      <span className="pg-kf-detail-vs-time">{formatTime(kill.eventTime)}</span>
                    </div>
                    <PgKillDetailColumn label="Killed" player={victimPlayer} champ={kill.victimChamp} isEntity={victimIsEntity} side={victimSide} version={ver} champions={champs} itemData={items} />
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
