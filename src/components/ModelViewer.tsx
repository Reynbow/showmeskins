import {
  useRef,
  useMemo,
  useEffect,
  useState,
  useCallback,
  Suspense,
  Component,
  type ReactNode,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import type { ChromaInfo } from '../types';
import './ModelViewer.css';

/* ================================================================
   Map Side Type (blue / red)
   ================================================================ */
export type MapSide = 'blue' | 'red';

/**
 * Per-skin overrides for models whose auto-sizing doesn't produce good results.
 * Key = skin ID (from URL).
 *   scale  – multiplier on the auto-computed scale (default 1)
 *   xShift – extra horizontal offset in world units (positive = right, default 0)
 *   yShift – extra vertical offset in world units (positive = up, default 0)
 *   zShift – extra depth offset in world units (positive = away from camera, default 0)
 */
/**
 * Per-skin / per-champion overrides for models whose auto-sizing doesn't
 * produce good results.
 *
 * Key priority (most specific wins):
 *   1. "alias/skinId"  – e.g. "elisespider/60024" (specific form + skin)
 *   2. "skinId"        – e.g. "60024"             (any form of that skin)
 *   3. "alias"         – e.g. "evelynn"           (all skins of a champion)
 */
const SKIN_OVERRIDES: Record<string, { scale?: number; xShift?: number; yShift?: number; zShift?: number }> = {
};

/* ================================================================
   Types
   ================================================================ */
export type ViewMode = 'model' | 'ingame';

export type EmoteType = 'idle' | 'joke' | 'taunt' | 'dance' | 'laugh';

interface EmoteVariant {
  intro?: string;   // animation name for intro (e.g. "Joke_In")
  main: string;     // animation name for loop/main (e.g. "Joke_Loop" or "Joke")
  outro?: string;   // animation name for outro (e.g. "Joke_Out") — skipped when loops
  loops: boolean;   // true when an explicit _Loop clip exists (should loop forever)
}

interface EmoteRequest {
  type: EmoteType;
  id: number;       // unique id (Date.now()) so each click triggers a new effect
}

interface Props {
  modelUrl: string;
  splashUrl: string;
  viewMode: ViewMode;
  chromas: ChromaInfo[];
  selectedChromaId: number | null;
  chromaTextureUrl: string | null;
  onChromaSelect: (chromaId: number | null) => void;
}

/* ================================================================
   Animation Utilities
   ================================================================ */

/**
 * Check whether an animation name represents an idle animation.
 * Matches "Idle_Base", "Idle_Variant01", "Idle1", "{Prefix}_Idle01", etc.
 * Excludes transitions: "IdleIn", "Idle_In", "Idle_IN_*", "*_to_*", "*_to_Idle".
 */

/** IQR (Interquartile Range) bounds for outlier rejection.
 *  Returns lower/upper thresholds; values outside are outliers. */
function iqrBounds(vals: number[], factor = 1.5) {
  const sorted = [...vals].sort((a, b) => a - b);
  const n = sorted.length;
  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const iqr = q3 - q1;
  return { lower: q1 - factor * iqr, upper: q3 + factor * iqr };
}

/** Build a Box3 from bone positions, rejecting statistical outliers on X/Z.
 *  Y axis is NOT filtered because:
 *   - The name filter already removes overhead buffbones (the main Y outlier)
 *   - Ground-level bones (True_World, foot bones at Y≈0) are legitimate and
 *     needed for accurate height measurement and foot placement
 *   - IQR on Y tends to remove these low bones since most bones cluster in
 *     the torso/head area, which breaks positioning */
function buildBoneBox(positions: THREE.Vector3[]): THREE.Box3 {
  const box = new THREE.Box3();
  if (positions.length < 4) {
    for (const p of positions) box.expandByPoint(p);
    return box;
  }
  const xB = iqrBounds(positions.map(p => p.x));
  const zB = iqrBounds(positions.map(p => p.z));
  for (const pos of positions) {
    if (pos.x >= xB.lower && pos.x <= xB.upper &&
        pos.z >= zB.lower && pos.z <= zB.upper) {
      box.expandByPoint(pos);
    }
  }
  // If IQR was too aggressive, fall back to all positions
  if (box.isEmpty()) {
    for (const p of positions) box.expandByPoint(p);
  }
  return box;
}

function isIdleAnimation(name: string): boolean {
  const n = name.replace(/\.anm$/i, '');
  // Must contain "idle" somewhere
  if (!/idle/i.test(n)) return false;
  // Exclude "IdleIn" / "Idle_In" / "Idle_IN_*" transitions (into idle)
  if (/idle_?in(?:_|$)/i.test(n)) return false;
  // Exclude anything with "_to_" (transition between states)
  if (/_to_/i.test(n)) return false;
  // Exclude "X_to_Idle" (transition TO idle from another anim)
  if (/to_idle/i.test(n)) return false;
  // The remainder is a valid idle: Idle_Base, Idle_Variant01, Idle1, Idle_Loop, etc.
  return true;
}

/**
 * Per-champion preferred idle animation name.
 * Key = champion alias (lowercase), value = exact animation name to prefer.
 */
const PREFERRED_IDLE: Record<string, string> = {
  fiddlesticks: 'Fiddlesticks_Idle2_Loop',
};

/** Ordered patterns for finding the best idle animation (most preferred first) */
const IDLE_PATTERNS: RegExp[] = [
  /^idle_?base(\.anm)?$/i,
  /^idle\d?_base(\.anm)?$/i,
  /^idle_?1(\.anm)?$/i,
  /^idle_?01(\.anm)?$/i,
  /(?:^|_)idle_?01_loop(\.anm)?$/i,
  /idle_loop(\.anm)?$/i,
  /(?:^|_)idle(?:\d{0,2})?(\.anm)?$/i,
  /idle/i,
];

function findIdleName(names: string[], alias?: string): string | undefined {
  // Check for a champion-specific preferred idle first
  if (alias) {
    const preferred = PREFERRED_IDLE[alias.toLowerCase()];
    if (preferred) {
      const exact = names.find((n) => n === preferred);
      if (exact) return exact;
    }
  }
  // First try matching from candidate idle animations only
  const idles = names.filter(isIdleAnimation);
  if (idles.length > 0) {
    for (const pattern of IDLE_PATTERNS) {
      const match = idles.find((n) => pattern.test(n));
      if (match) return match;
    }
    return idles[0];
  }
  // Fallback: any name containing "idle" (broad match)
  for (const pattern of IDLE_PATTERNS) {
    const match = names.find((n) => pattern.test(n));
    if (match) return match;
  }
  return names[0];
}

/**
 * Find ALL distinct idle animations for cycling.
 * If both "IdleX" and "IdleX_Loop" exist, only the loop version is kept.
 */
function findAllIdleNames(names: string[]): string[] {
  let idleNames = names.filter(isIdleAnimation);
  if (idleNames.length === 0) {
    // Broad fallback: anything starting with "idle"
    idleNames = names.filter((n) => /^idle/i.test(n));
  }
  if (idleNames.length === 0) return [];

  // Prefer loop versions: if "X" and "X_Loop" both exist, drop the non-loop
  const loopSuffix = /_loop(\.anm)?$/i;
  const hasLoop = new Set(
    idleNames
      .filter((n) => loopSuffix.test(n))
      .map((n) => n.replace(loopSuffix, '').toLowerCase()),
  );
  const filtered = idleNames.filter((n) => {
    if (loopSuffix.test(n)) return true;
    const base = n.replace(/\.anm$/i, '').toLowerCase();
    return !hasLoop.has(base);
  });

  filtered.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return filtered.length > 0 ? filtered : idleNames;
}

/**
 * Given an array of animation clip names and an emote type (e.g. "joke"),
 * return all playable variants found in the model.
 *
 * Handles naming patterns:
 *   Joke, Joke_In + Joke_Loop, Joke2, Joke2_Into + Joke2_Loop, etc.
 */
function findEmoteVariants(animNames: string[], emoteType: string): EmoteVariant[] {
  const variants: EmoteVariant[] = [];

  // Collect variant IDs: "" (base), "2", "3", etc.
  const variantIds = new Set<string>();
  variantIds.add('');
  for (const name of animNames) {
    const match = name.match(new RegExp(`^${emoteType}(\\d+)`, 'i'));
    if (match) variantIds.add(match[1]);
  }

  for (const varId of variantIds) {
    const prefix = emoteType + varId;

    // Find intro: {prefix}_in, {prefix}_into, {prefix}_intro
    const intro = animNames.find((n) => {
      const l = n.toLowerCase();
      const p = prefix.toLowerCase();
      return l === `${p}_in` || l === `${p}_into` || l === `${p}_intro`;
    });

    // Find explicit loop: {prefix}_loop
    const loop = animNames.find(
      (n) => n.toLowerCase() === `${prefix}_loop`.toLowerCase(),
    );

    // Find outro: {prefix}_out, {prefix}_outro
    const outro = animNames.find((n) => {
      const l = n.toLowerCase();
      const p = prefix.toLowerCase();
      return l === `${p}_out` || l === `${p}_outro`;
    });

    // Find base/main: exact match for {prefix}
    const main = animNames.find(
      (n) => n.toLowerCase() === prefix.toLowerCase(),
    );

    if (loop) {
      // Explicit _Loop clip found → will loop forever after optional intro
      // Outro is intentionally ignored when looping
      variants.push({ intro: intro ?? main, main: loop, loops: true });
    } else if (main) {
      // Has a base animation → play once (with optional intro/outro)
      variants.push({ intro, main, outro, loops: false });
    } else if (intro) {
      // No base animation but has intro (e.g. Joke_In + Joke_Out)
      // The intro IS the content; outro plays after if present
      variants.push({ main: intro, outro, loops: false });
    }
  }

  return variants;
}

/* ================================================================
   Error Boundary
   ================================================================ */
interface ErrorBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
  resetKey?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class ModelErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

/* ================================================================
   Champion 3‑D Model (GLB) with Emote System
   ================================================================ */
interface ChampionModelProps {
  url: string;
  viewMode: ViewMode;
  emoteRequest: EmoteRequest | null;
  chromaTextureUrl: string | null;
  facingRotationY: number;
  onChromaLoading: (loading: boolean) => void;
  onEmotesAvailable: (emotes: EmoteType[]) => void;
  onEmoteFinished: () => void;
  onAnimationName: (name: string) => void;
  onEmoteNames: (names: Record<string, string[]>) => void;
  onModelHeight: (height: number) => void;
}

function ChampionModel({ url, viewMode, emoteRequest, chromaTextureUrl, facingRotationY, onChromaLoading, onEmotesAvailable, onEmoteFinished, onAnimationName, onEmoteNames, onModelHeight }: ChampionModelProps) {
  const { scene, animations } = useGLTF(url);
  const groupRef = useRef<THREE.Group>(null);
  const { actions, names, mixer } = useAnimations(animations, groupRef);

  /* ── Extract champion alias from URL for idle overrides ──── */
  const champAlias = useMemo(() => {
    const m = url.match(/\/models\/([^/]+)\//);
    return m ? m[1] : undefined;
  }, [url]);

  /* ── Idle animation name (stable for the model's lifetime) ──── */
  const idleName = useMemo(() => findIdleName(names, champAlias), [names, champAlias]);

  /* ── All idle animation names for cycling ────────────────────── */
  const allIdleNames = useMemo(() => findAllIdleNames(names), [names]);
  const idleCycleIdx = useRef(
    Math.max(0, allIdleNames.indexOf(idleName ?? '')),
  );

  /* ── Ref to the idle action for easy access by the emote system */
  const idleRef = useRef<THREE.AnimationAction | null>(null);

  /* ── Raw model height (before normalization) for relative sizing ─ */
  const rawHeightRef = useRef(4);

  /* ── Hide the model until the setup effect has positioned it ──── */
  const [ready, setReady] = useState(false);

  /* ── Frame-delay reveal: wait for the animation to settle before
       showing the model, so the bind-pose → idle transition (weapons
       sliding in, limbs pulling into place) is never visible. ────── */
  const pendingRevealRef = useRef(false);
  const revealElapsedRef = useRef(0);

  /* ── Build a map of available emotes → their animation variants  */
  const emoteMap = useMemo(() => {
    const map = new Map<EmoteType, EmoteVariant[]>();
    for (const type of ['joke', 'taunt', 'dance', 'laugh'] as EmoteType[]) {
      const variants = findEmoteVariants(names, type);
      if (variants.length > 0) {
        map.set(type, variants);
      }
    }
    return map;
  }, [names]);

  /* ── Report available emotes and their animation names to parent ─ */
  const prevEmotesKey = useRef('');
  useEffect(() => {
    // Always include 'idle' since every model has at least one idle animation
    const emotes: EmoteType[] = ['idle', ...Array.from(emoteMap.keys())];
    const key = emotes.join(',');
    if (key !== prevEmotesKey.current) {
      prevEmotesKey.current = key;
      onEmotesAvailable(emotes);

      // Build a map of emote type → animation names for tooltips
      const nameMap: Record<string, string[]> = {};
      nameMap['idle'] = allIdleNames.length > 0 ? allIdleNames : (idleName ? [idleName] : []);
      for (const [type, variants] of emoteMap.entries()) {
        nameMap[type] = variants.map((v) => v.intro ?? v.main);
      }
      onEmoteNames(nameMap);
    }
  }, [emoteMap, allIdleNames, idleName, onEmotesAvailable, onEmoteNames]);

  /* ── Ref to clean up the current emote playback ────────────── */
  const emoteCleanupRef = useRef<(() => void) | null>(null);

  /* ── Setup effect: mesh fixes, scaling, idle animation ──────── */
  useEffect(() => {
    setReady(false);
    // Immediately hide the scene at the Three.js object level.
    // This is independent of React's render cycle, so there is zero chance
    // of a frame leaking through before React processes the state update.
    scene.visible = false;
    if (!groupRef.current) return;

    /* 1. Hide submeshes flagged invisible, fix material layering, enable shadows */
    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;

      // Enable shadow casting on all visible meshes
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

    /* 2. Reset transforms so bounding-box math starts clean */
    scene.scale.set(1, 1, 1);
    scene.position.set(0, 0, 0);
    scene.rotation.set(0, 0, 0);

    /* 2b. Fix negative scales on nodes (some models use negative X scale for mirroring).
           Negative scale can cause degenerate bounding boxes and tiny rendering. */
    scene.traverse((child) => {
      if (child.scale.x < 0) child.scale.x = Math.abs(child.scale.x);
      if (child.scale.y < 0) child.scale.y = Math.abs(child.scale.y);
      if (child.scale.z < 0) child.scale.z = Math.abs(child.scale.z);
    });

    /* 3. Start the idle animation and tick one frame so the skeleton
          is in its animated pose before we measure the bounding box */
    idleRef.current = null;
    if (idleName && actions[idleName]) {
      const idle = actions[idleName]!;
      idle.reset().play();
      idle.getMixer().update(0);
      idleRef.current = idle;
      onAnimationName(idleName);
    }

    /* 4. Force skeleton / skinned-mesh world-matrix update */
    scene.updateMatrixWorld(true);

    /* 5. Determine model height using Riot's reference bones.
          Every champion model contains two marker bones placed by Riot:
            - Buffbone_Glb_Ground_Loc  → the floor level
            - C_Buffbone_Glb_Overhead_Loc → the intended display height
          The distance between them is the authoritative character height,
          identical across all skins of the same champion.
          FALLBACK: if either bone is missing, use body bones with IQR,
          then mesh bounding box. */
    const _refPos = new THREE.Vector3();
    let groundBoneY: number | null = null;
    let overheadBoneY: number | null = null;
    scene.traverse((child) => {
      if (!(child as THREE.Bone).isBone) return;
      const name = child.name.toLowerCase();
      if (name === 'buffbone_glb_ground_loc') {
        child.getWorldPosition(_refPos);
        groundBoneY = _refPos.y;
      } else if (name === 'c_buffbone_glb_overhead_loc') {
        child.getWorldPosition(_refPos);
        overheadBoneY = _refPos.y;
      }
    });

    // Use reference bones if both found, otherwise fall back to body bone box / mesh box
    const NON_BODY_BONE = /buffbone|recall|dummy/i;
    let modelHeight: number;
    if (groundBoneY !== null && overheadBoneY !== null) {
      modelHeight = Math.abs(overheadBoneY - groundBoneY);
    } else {
      // Fallback: gather body bones with IQR outlier rejection
      const bonePositions: THREE.Vector3[] = [];
      scene.traverse((child) => {
        if ((child as THREE.Bone).isBone && !NON_BODY_BONE.test(child.name)) {
          const pos = new THREE.Vector3();
          child.getWorldPosition(pos);
          bonePositions.push(pos);
        }
      });
      if (bonePositions.length >= 4) {
        const boneBox = buildBoneBox(bonePositions);
        const boneSize = new THREE.Vector3();
        boneBox.getSize(boneSize);
        modelHeight = boneSize.y;
      } else {
        const meshBox = new THREE.Box3();
        scene.traverse((child) => {
          if (!(child as THREE.Mesh).isMesh || !child.visible) return;
          meshBox.expandByObject(child);
        });
        const meshSize = new THREE.Vector3();
        meshBox.getSize(meshSize);
        modelHeight = meshSize.y;
      }
    }

    // Record raw height for relative sizing in ingame mode
    rawHeightRef.current = Math.max(modelHeight, 0.01);
    onModelHeight(rawHeightRef.current);

    /* 6. Scale based on HEIGHT (Y) so all champions appear the same
          height regardless of how wide their geometry is */
    const targetHeight = 3.2;
    const height = rawHeightRef.current;
    // Extract alias and skin ID from URL for per-skin overrides
    // URL pattern: /model-cdn/lol/models/{alias}/{skinId}/model.glb
    const urlMatch = url.match(/\/models\/([^/]+)\/(\d+)\/model\.glb/);
    const overrides = urlMatch
      ? (SKIN_OVERRIDES[`${urlMatch[1]}/${urlMatch[2]}`]  // alias/skinId (most specific)
        ?? SKIN_OVERRIDES[urlMatch[2]]                     // skinId
        ?? SKIN_OVERRIDES[urlMatch[1]])                    // alias (least specific)
      : undefined;
    const scale = (targetHeight / height) * (overrides?.scale ?? 1);

    scene.scale.setScalar(scale);

    /* 7. Recompute positions after scaling to place model on platform.
          - Ground bone for Y positioning (Riot's authoritative floor marker)
          - Body bones (with IQR) for X/Z centering
          - Mesh bounding box as fallback */
    scene.updateMatrixWorld(true);

    // Re-find ground bone position after scaling — this is Riot's authoritative
    // "where the champion stands" marker, giving us X/Y/Z origin in one shot.
    const _groundPosHolder: { v: THREE.Vector3 | null } = { v: null };
    scene.traverse((child) => {
      if (_groundPosHolder.v === null && (child as THREE.Bone).isBone &&
          /^buffbone_glb_ground_loc$/i.test(child.name)) {
        _groundPosHolder.v = new THREE.Vector3();
        child.getWorldPosition(_groundPosHolder.v);
      }
    });
    const groundPos = _groundPosHolder.v;

    // Fallback: gather body bones for X/Z centering (with IQR outlier rejection)
    // and mesh bounding box if no bones are available
    let fallbackCenterX = 0;
    let fallbackCenterZ = 0;
    let fallbackFootY = 0;
    if (groundPos === null) {
      const scaledBonePositions: THREE.Vector3[] = [];
      scene.traverse((child) => {
        if ((child as THREE.Bone).isBone && !NON_BODY_BONE.test(child.name)) {
          const pos = new THREE.Vector3();
          child.getWorldPosition(pos);
          scaledBonePositions.push(pos);
        }
      });
      const scaledBoneBox = scaledBonePositions.length >= 4
        ? buildBoneBox(scaledBonePositions)
        : new THREE.Box3();

      const scaledMeshBox = new THREE.Box3();
      scene.traverse((child) => {
        if (!(child as THREE.Mesh).isMesh || !child.visible) return;
        scaledMeshBox.expandByObject(child);
      });

      const centerBox = !scaledBoneBox.isEmpty() ? scaledBoneBox : scaledMeshBox;
      const scaledCenter = new THREE.Vector3();
      centerBox.getCenter(scaledCenter);
      fallbackCenterX = scaledCenter.x;
      fallbackCenterZ = scaledCenter.z;
      fallbackFootY = !scaledBoneBox.isEmpty()
        ? scaledBoneBox.min.y
        : (scaledMeshBox.isEmpty() ? centerBox.min.y : scaledMeshBox.min.y);
    }

    // Position: ground bone for all axes if available, otherwise fallback
    const centerX = groundPos ? groundPos.x : fallbackCenterX;
    const centerZ = groundPos ? groundPos.z : fallbackCenterZ;
    const footY   = groundPos ? groundPos.y : fallbackFootY;

    scene.position.set(
      -centerX + (overrides?.xShift ?? 0),
      -footY - 1.7 + (overrides?.yShift ?? 0),
      -centerZ + (overrides?.zShift ?? 0),
    );

    // Signal the useFrame reveal loop to start counting frames.
    // The model stays invisible (scene.visible = false + group visible={ready})
    // while the animation mixer naturally ticks for ~150 ms, letting all bones
    // settle into their idle pose before anything is shown to the user.
    pendingRevealRef.current = true;
    revealElapsedRef.current = 0;

    return () => {
      pendingRevealRef.current = false;
      Object.values(actions).forEach((a) => a?.stop());
    };
  }, [scene, actions, names, idleName]);

  /* ── Reveal-after-settle: keep the model invisible while the animation
       mixer ticks naturally for several real-time frames.  This guarantees
       the bind-pose → idle transition (weapons/limbs sliding into place)
       completes off-screen before anything is shown. ──────────────────── */
  useFrame((_, delta) => {
    if (pendingRevealRef.current) {
      revealElapsedRef.current += delta;
      // Wait ~150 ms of real animation time before revealing
      if (revealElapsedRef.current >= 0.15) {
        pendingRevealRef.current = false;
        scene.visible = true;
        setReady(true);
      }
    }
  });

  /* ══════════════════════════════════════════════════════════════
     Chroma Texture Swap
     Loads the chroma's diffuse texture from CommunityDragon and
     replaces the model's primary material map. Stores originals
     so they can be restored when switching back to default.
     ══════════════════════════════════════════════════════════════ */
  const originalTexturesRef = useRef<Map<THREE.MeshStandardMaterial, THREE.Texture | null>>(new Map());
  const loadedChromaTexRef = useRef<THREE.Texture | null>(null);

  useEffect(() => {
    const originals = originalTexturesRef.current;
    let cancelled = false;

    /** Restore all previously swapped materials to their original textures */
    function restoreOriginals() {
      for (const [mat, origTex] of originals) {
        mat.map = origTex;
        mat.needsUpdate = true;
      }
      if (loadedChromaTexRef.current) {
        loadedChromaTexRef.current.dispose();
        loadedChromaTexRef.current = null;
      }
    }

    /**
     * Fetch a texture via fetch() + createImageBitmap with retry & timeout.
     * Much more resilient than THREE.TextureLoader (which uses <img> src
     * with no retry/timeout control).
     */
    async function loadTextureWithRetry(
      url: string,
      retries = 3,
      timeoutMs = 15_000,
    ): Promise<THREE.Texture> {
      let lastError: unknown;
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
          lastError = err;
          if ((err as Error).message === 'cancelled') throw err;
          // Wait a bit before retrying (exponential backoff: 1s, 2s, 4s)
          if (attempt < retries - 1) {
            await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
          }
        }
      }
      throw lastError;
    }

    // Always restore first
    restoreOriginals();

    if (!chromaTextureUrl) {
      onChromaLoading(false);
      return;
    }

    // Signal loading started
    onChromaLoading(true);

    loadTextureWithRetry(chromaTextureUrl)
      .then((texture) => {
        if (cancelled) { texture.dispose(); return; }

        loadedChromaTexRef.current = texture;

        // Find the primary body material(s) — largest texture map
        let maxSize = 0;
        const primaryMats: THREE.MeshStandardMaterial[] = [];

        scene.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh || !mesh.visible) return;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of mats) {
            const m = mat as THREE.MeshStandardMaterial;
            if (m.map?.image) {
              const size = (m.map.image.width ?? 0) * (m.map.image.height ?? 0);
              if (size > maxSize) {
                maxSize = size;
                primaryMats.length = 0;
                primaryMats.push(m);
              } else if (size === maxSize && size > 0) {
                primaryMats.push(m);
              }
            }
          }
        });

        // Swap the texture on each primary material
        for (const m of primaryMats) {
          if (!originals.has(m)) {
            originals.set(m, m.map);
          }
          m.map = texture;
          m.needsUpdate = true;
        }

        onChromaLoading(false);
      })
      .catch((err) => {
        if ((err as Error).message === 'cancelled') return;
        console.warn('Failed to load chroma texture after retries:', chromaTextureUrl, err);
        onChromaLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, chromaTextureUrl]);

  /* ══════════════════════════════════════════════════════════════
     Emote Playback Effect
     Watches emoteRequest and manages intro → loop transitions.
     - If the variant has an explicit _Loop clip  → intro then loop forever
     - If not (standalone animation)              → play once then back to idle
     ══════════════════════════════════════════════════════════════ */
  useEffect(() => {
    // Clean up any previous emote (fade out actions, remove listeners)
    if (emoteCleanupRef.current) {
      emoteCleanupRef.current();
      emoteCleanupRef.current = null;
    }

    if (!emoteRequest) {
      // No emote requested → restore idle
      if (idleRef.current) {
        idleRef.current.reset().fadeIn(0.3).play();
      }
      onAnimationName(idleName ?? '');
      return;
    }

    /* ── Idle cycling ──────────────────────────────────────────── */
    if (emoteRequest.type === 'idle') {
      if (allIdleNames.length <= 1) {
        // Only one idle — just reset it to the beginning
        if (idleRef.current) {
          idleRef.current.reset().play();
        }
        onAnimationName(idleName ?? '');
      } else {
        // Multiple idles — crossfade to the next one
        if (idleRef.current) {
          idleRef.current.fadeOut(0.3);
        }
        idleCycleIdx.current =
          (idleCycleIdx.current + 1) % allIdleNames.length;
        const nextIdleName = allIdleNames[idleCycleIdx.current];
        const nextIdle = actions[nextIdleName];
        if (nextIdle) {
          nextIdle.reset();
          nextIdle.setLoop(THREE.LoopRepeat, Infinity);
          nextIdle.fadeIn(0.3).play();
          idleRef.current = nextIdle;
        }
        onAnimationName(nextIdleName);
      }
      // Don't call onEmoteFinished — idle IS the base state
      return;
    }

    const variants = emoteMap.get(emoteRequest.type);
    if (!variants?.length) return;

    // Pick a random variant
    const variant = variants[Math.floor(Math.random() * variants.length)];
    onAnimationName(variant.intro ?? variant.main);

    // Fade out idle
    if (idleRef.current) {
      idleRef.current.fadeOut(0.3);
    }

    /** Helper: fade back to idle and notify parent that the emote ended */
    const returnToIdle = () => {
      if (idleRef.current) {
        idleRef.current.reset().fadeIn(0.3).play();
      }
      onAnimationName(idleName ?? '');
      onEmoteFinished();
    };

    const hasDistinctIntro =
      variant.intro &&
      variant.intro !== variant.main &&
      actions[variant.intro];

    if (variant.loops) {
      /* ══ LOOPING: optional intro → loop forever (outro ignored) ══ */
      const loopAction = actions[variant.main]!;

      if (hasDistinctIntro) {
        const introAction = actions[variant.intro!]!;
        introAction.reset();
        introAction.setLoop(THREE.LoopOnce, 1);
        introAction.clampWhenFinished = true;
        introAction.fadeIn(0.3).play();

        const onFinished = (e: { action: THREE.AnimationAction }) => {
          if (e.action === introAction) {
            introAction.fadeOut(0.15);
            loopAction.reset();
            loopAction.setLoop(THREE.LoopRepeat, Infinity);
            loopAction.fadeIn(0.15).play();
          }
        };

        mixer.addEventListener('finished', onFinished);

        emoteCleanupRef.current = () => {
          mixer.removeEventListener('finished', onFinished);
          introAction.fadeOut(0.3);
          loopAction.fadeOut(0.3);
        };
      } else {
        loopAction.reset();
        loopAction.setLoop(THREE.LoopRepeat, Infinity);
        loopAction.fadeIn(0.3).play();

        emoteCleanupRef.current = () => {
          loopAction.fadeOut(0.3);
        };
      }
    } else if (actions[variant.main]) {
      /* ══ ONE-SHOT: intro? → main → outro? → idle ═══════════════ */
      // Build an ordered list of phases to play through
      const phases: THREE.AnimationAction[] = [];

      if (hasDistinctIntro) {
        phases.push(actions[variant.intro!]!);
      }
      phases.push(actions[variant.main]!);
      if (variant.outro && actions[variant.outro]) {
        phases.push(actions[variant.outro]!);
      }

      let currentIdx = 0;

      // Kick off the first phase
      const first = phases[0];
      first.reset();
      first.setLoop(THREE.LoopOnce, 1);
      first.clampWhenFinished = true;
      first.fadeIn(0.3).play();

      const onFinished = (e: { action: THREE.AnimationAction }) => {
        if (currentIdx < phases.length && e.action === phases[currentIdx]) {
          phases[currentIdx].fadeOut(0.15);
          currentIdx++;

          if (currentIdx < phases.length) {
            // Advance to next phase
            const next = phases[currentIdx];
            next.reset();
            next.setLoop(THREE.LoopOnce, 1);
            next.clampWhenFinished = true;
            next.fadeIn(0.15).play();
          } else {
            // All phases complete → back to idle
            returnToIdle();
          }
        }
      };

      mixer.addEventListener('finished', onFinished);

      emoteCleanupRef.current = () => {
        mixer.removeEventListener('finished', onFinished);
        for (const phase of phases) {
          phase.fadeOut(0.3);
        }
      };
    }

    // Unmount cleanup
    return () => {
      if (emoteCleanupRef.current) {
        emoteCleanupRef.current();
        emoteCleanupRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emoteRequest]);

  /* In ingame mode, apply a relative scale factor based on the raw model
     height so that larger champions appear bigger and smaller ones smaller.
     A reference height of ~4 units (typical mid-size champion) maps to 1.0.
     Clamped to [0.65, 1.5] to keep things reasonable. */
  const ingameScale = viewMode === 'ingame'
    ? Math.min(Math.max(rawHeightRef.current / 4.0, 0.65), 1.5)
    : 1;

  return (
    <group rotation={[0, facingRotationY, 0]} scale={ingameScale} visible={ready}>
      <group ref={groupRef}>
        <primitive object={scene} />
      </group>
    </group>
  );
}

/* ================================================================
   Fountain-style Platform (Model Viewer mode)
   Multi-tiered stone podium inspired by the Summoner's Rift fountain.
   ================================================================ */
function HexPlatform() {
  const glowRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    // Subtle pulsing glow
    if (glowRef.current) {
      const mat = glowRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.3 + Math.sin(t * 1.2) * 0.15;
    }
  });

  const stoneColor = '#1a2030';
  const stoneLight = '#232d40';
  const glowColor = '#1e6091';

  return (
    <group position={[0, -2.05, 0]}>
      {/* ── Tier 1: Wide base step ── */}
      <mesh position={[0, -0.08, 0]} receiveShadow>
        <cylinderGeometry args={[3.0, 3.2, 0.16, 64]} />
        <meshStandardMaterial
          color="#0e1520"
          metalness={0.7}
          roughness={0.35}
        />
      </mesh>

      {/* ── Tier 2: Middle step ── */}
      <mesh position={[0, 0.06, 0]} receiveShadow>
        <cylinderGeometry args={[2.4, 2.55, 0.14, 64]} />
        <meshStandardMaterial
          color={stoneColor}
          metalness={0.75}
          roughness={0.3}
        />
      </mesh>

      {/* ── Tier 3: Top platform ── */}
      <mesh position={[0, 0.19, 0]} receiveShadow>
        <cylinderGeometry args={[1.8, 1.9, 0.12, 64]} />
        <meshStandardMaterial
          color={stoneLight}
          metalness={0.8}
          roughness={0.25}
        />
      </mesh>

      {/* ── Inner glow disc (blue energy on top surface) ── */}
      <mesh
        ref={glowRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.26, 0]}
      >
        <circleGeometry args={[1.75, 64]} />
        <meshStandardMaterial
          color="#0a1520"
          emissive={glowColor}
          emissiveIntensity={0.3}
          metalness={0.6}
          roughness={0.4}
          transparent
          opacity={0.85}
        />
      </mesh>

      {/* ── Outer ground fade (dark circle extending beyond the podium) ── */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.15, 0]} renderOrder={-2}>
        <circleGeometry args={[6, 64]} />
        <meshStandardMaterial color="#010a13" />
      </mesh>
    </group>
  );
}

/* ================================================================
   Floating Particles (Model Viewer mode only)
   ================================================================ */
function Particles() {
  const count = 150;
  const meshRef = useRef<THREE.Points>(null);

  const [positions, colors] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const gold = new THREE.Color('#c8aa6e');
    const blue = new THREE.Color('#0ac8b9');
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 12;
      pos[i * 3 + 1] = Math.random() * 8 - 2;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 12;
      const c = Math.random() > 0.7 ? blue : gold;
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    return [pos, col];
  }, []);

  useFrame((state) => {
    if (!meshRef.current) return;
    const arr = meshRef.current.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] += 0.002 + Math.sin(i) * 0.0005;
      if (arr[i * 3 + 1] > 6) arr[i * 3 + 1] = -2;
      arr[i * 3] += Math.sin(state.clock.elapsedTime * 0.3 + i * 0.1) * 0.001;
      arr[i * 3 + 2] += Math.cos(state.clock.elapsedTime * 0.2 + i * 0.1) * 0.001;
    }
    meshRef.current.geometry.attributes.position.needsUpdate = true;
  });

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geo;
  }, [positions, colors]);

  return (
    <points ref={meshRef} geometry={geometry}>
      <pointsMaterial
        size={0.04}
        transparent
        opacity={0.5}
        vertexColors
        sizeAttenuation
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

/* ================================================================
   Ingame Lighting (outdoor / Summoner's Rift daylight)
   ================================================================ */
function IngameLighting() {
  return (
    <>
      <ambientLight intensity={0.7} color="#f5f0e0" />
      <directionalLight
        position={[8, 12, 6]}
        intensity={1.4}
        color="#fff8e0"
      />
      <directionalLight position={[-4, 6, -4]} intensity={0.3} color="#a0d0ff" />
      <hemisphereLight
        color="#87ceeb"
        groundColor="#3a5a2a"
        intensity={0.5}
      />
    </>
  );
}

/* ================================================================
   Loading Indicator
   ================================================================ */
function LoadingIndicator() {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = state.clock.elapsedTime * 1.5;
      meshRef.current.rotation.x = state.clock.elapsedTime * 0.7;
      meshRef.current.position.y = Math.sin(state.clock.elapsedTime * 2) * 0.15;
    }
  });
  return (
    <mesh ref={meshRef} position={[0, 0, 0]}>
      <octahedronGeometry args={[0.6, 0]} />
      <meshStandardMaterial color="#c8aa6e" wireframe emissive="#c8aa6e" emissiveIntensity={0.8} toneMapped={false} />
    </mesh>
  );
}

/* ================================================================
   Camera Controller — smoothly moves between view modes
   ================================================================ */
function CameraController({ viewMode, rawHeight }: { viewMode: ViewMode; rawHeight: number }) {
  const { camera } = useThree();
  const animating = useRef(false);
  const targetPos = useRef(new THREE.Vector3());
  const prevView = useRef(viewMode);
  const prevHeight = useRef(rawHeight);

  useEffect(() => {
    /* In ingame (top-down) mode, scale the camera distance based on the
       champion's raw model height so that small champions look small and
       large champions look large.  A reference height of ~4 units maps to
       the baseline camera position.  We scale the Y and Z components of
       the camera position proportionally, clamped to keep things sane. */
    const sizeFactor = viewMode === 'ingame'
      ? Math.min(Math.max(rawHeight / 4.0, 0.7), 1.6)
      : 1;

    const newTarget = viewMode === 'ingame'
      ? new THREE.Vector3(0, 8.5 * sizeFactor, 4.2 * sizeFactor)
      : new THREE.Vector3(0, 0.5, 5.5);
    targetPos.current.copy(newTarget);

    const viewChanged = prevView.current !== viewMode;
    const heightChanged = Math.abs(prevHeight.current - rawHeight) > 0.05;
    prevView.current = viewMode;
    prevHeight.current = rawHeight;

    if (viewChanged || (viewMode === 'ingame' && heightChanged)) {
      animating.current = true;
    }
  }, [viewMode, rawHeight, camera]);

  useFrame(() => {
    if (!animating.current) return;
    camera.position.lerp(targetPos.current, 0.08);
    camera.lookAt(0, 0, 0);
    if (camera.position.distanceTo(targetPos.current) < 0.01) {
      camera.position.copy(targetPos.current);
      camera.lookAt(0, 0, 0);
      animating.current = false;
    }
  });

  return null;
}


/* ================================================================
   Splash Art Fallback
   ================================================================ */
function SplashFallback({ url }: { url: string }) {
  return (
    <div className="viewer-splash-fallback">
      <img src={url} alt="Skin splash art" />
      <div className="viewer-splash-fallback-label">
        3D model unavailable — showing splash art
      </div>
    </div>
  );
}

/* ================================================================
   Model Viewer Lighting (dark, gold/teal accents)
   ================================================================ */
function ModelViewerLighting() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 8, 5]} intensity={1} color="#f0e6d2" />
      <directionalLight position={[-5, 4, -3]} intensity={0.3} color="#0ac8b9" />
      <pointLight position={[-4, 3, -3]} intensity={0.5} color="#0ac8b9" />
      <pointLight position={[4, 3, -3]} intensity={0.5} color="#c8aa6e" />
      <pointLight position={[0, -1, 4]} intensity={0.3} color="#0ac8b9" />
      <spotLight position={[0, 8, 0]} intensity={0.6} color="#f0e6d2" angle={0.5} penumbra={0.8} />
    </>
  );
}


/* ================================================================
   Emote Button SVG Icons
   ================================================================ */
const EMOTE_ICONS: Record<EmoteType, ReactNode> = {
  idle: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="4.5" r="2.5" />
      <line x1="12" y1="7" x2="12" y2="15" />
      <line x1="8" y1="10.5" x2="16" y2="10.5" />
      <line x1="12" y1="15" x2="9" y2="21.5" />
      <line x1="12" y1="15" x2="15" y2="21.5" />
    </svg>
  ),
  joke: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <line x1="12" y1="8" x2="12" y2="11" />
      <circle cx="12" cy="14" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  ),
  taunt: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M18 11V6a2 2 0 0 0-4 0" />
      <path d="M14 11V4a2 2 0 0 0-4 0v7" />
      <path d="M10 10.5V6a2 2 0 0 0-4 0v6a6 6 0 0 0 12 0v-2a2 2 0 0 0-4 0" />
    </svg>
  ),
  dance: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  ),
  laugh: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" strokeWidth="3" strokeLinecap="round" />
      <line x1="15" y1="9" x2="15.01" y2="9" strokeWidth="3" strokeLinecap="round" />
    </svg>
  ),
};

const EMOTE_LABELS: Record<EmoteType, string> = {
  idle: 'Idle',
  joke: 'Joke',
  taunt: 'Taunt',
  dance: 'Dance',
  laugh: 'Laugh',
};

/* ================================================================
   Main Exported Component
   ================================================================ */
const bgColor = '#010a13';

export function ModelViewer({ modelUrl, splashUrl, viewMode, chromas, selectedChromaId, chromaTextureUrl, onChromaSelect }: Props) {
  const [modelError, setModelError] = useState(false);
  const [emoteRequest, setEmoteRequest] = useState<EmoteRequest | null>(null);
  const [availableEmotes, setAvailableEmotes] = useState<EmoteType[]>([]);
  const [activeEmote, setActiveEmote] = useState<EmoteType | null>(null);
  const [chromaLoading, setChromaLoading] = useState(false);
  const [currentAnimName, setCurrentAnimName] = useState('');
  const [emoteAnimNames, setEmoteAnimNames] = useState<Record<string, string[]>>({});
  const [mapSide, setMapSide] = useState<MapSide>('blue');
  const [rawModelHeight, setRawModelHeight] = useState(4);

  /* Facing rotation: SW for blue side, NE for red side (only in ingame mode) */
  const facingRotationY = viewMode === 'ingame'
    ? (mapSide === 'blue' ? (Math.PI * 3) / 4 : -Math.PI / 4)
    : 0;

  /* Reset state on model change */
  useEffect(() => {
    setModelError(false);
    setEmoteRequest(null);
    setActiveEmote(null);
    setAvailableEmotes([]);
    setChromaLoading(false);
    setCurrentAnimName('');
    setEmoteAnimNames({});
  }, [modelUrl]);

  const handleChromaLoading = useCallback((loading: boolean) => {
    setChromaLoading(loading);
  }, []);

  const handleEmotesAvailable = useCallback((emotes: EmoteType[]) => {
    setAvailableEmotes(emotes);
  }, []);

  const handleAnimationName = useCallback((name: string) => {
    setCurrentAnimName(name);
  }, []);

  const handleEmoteNames = useCallback((names: Record<string, string[]>) => {
    setEmoteAnimNames(names);
  }, []);

  const handleModelHeight = useCallback((h: number) => {
    setRawModelHeight(h);
  }, []);

  /** Called when a non-looping emote finishes playing → reset button state */
  const handleEmoteFinished = useCallback(() => {
    setActiveEmote(null);
    setEmoteRequest(null);
  }, []);

  const handleEmoteClick = useCallback((type: EmoteType) => {
    if (type === 'idle') {
      // Idle always sends a new request to cycle/reset — never "toggles off"
      setActiveEmote(null);
      setEmoteRequest({ type: 'idle', id: Date.now() });
      return;
    }
    setActiveEmote((prev) => {
      if (prev === type) {
        // Toggle off → back to idle
        setEmoteRequest(null);
        return null;
      }
      // Play this emote
      setEmoteRequest({ type, id: Date.now() });
      return type;
    });
  }, []);

  return (
    <div className="model-viewer-root">
      {modelError ? (
        <SplashFallback url={splashUrl} />
      ) : (
        <ModelErrorBoundary resetKey={modelUrl} fallback={<SplashFallback url={splashUrl} />}>
          {/* Flat ground texture behind the 3D canvas (ingame mode only) */}
          {viewMode === 'ingame' && (
            <div
              className="ingame-ground-bg"
              style={{
                backgroundImage: `url(${mapSide === 'blue' ? '/blue-side.png' : '/red-side.png'})`,
              }}
            />
          )}
          <Canvas
            shadows
            camera={{ position: [0, 0.5, 5.5], fov: 45 }}
            gl={{
              antialias: true,
              toneMapping: THREE.ACESFilmicToneMapping,
              toneMappingExposure: 1.2,
              ...(viewMode === 'ingame' ? { alpha: true } : {}),
            }}
            style={{ background: viewMode === 'ingame' ? 'transparent' : bgColor }}
          >
            {viewMode === 'model' && (
              <fog attach="fog" args={[bgColor, 10, 30]} />
            )}

            {viewMode === 'model' ? <ModelViewerLighting /> : <IngameLighting />}

            {/* Champion 3D model with emote support */}
            <Suspense fallback={<LoadingIndicator />}>
              <ChampionModel
                key={modelUrl}
                url={modelUrl}
                viewMode={viewMode}
                emoteRequest={emoteRequest}
                chromaTextureUrl={chromaTextureUrl}
                facingRotationY={facingRotationY}
                onChromaLoading={handleChromaLoading}
                onEmotesAvailable={handleEmotesAvailable}
                onEmoteFinished={handleEmoteFinished}
                onAnimationName={handleAnimationName}
                onEmoteNames={handleEmoteNames}
                onModelHeight={handleModelHeight}
              />
            </Suspense>

            {/* Shadow-casting light from the south-west — shadow falls to upper-right */}
            <directionalLight
              position={[-5, 10, 5]}
              intensity={0.3}
              castShadow
              shadow-mapSize-width={1024}
              shadow-mapSize-height={1024}
              shadow-camera-left={-6}
              shadow-camera-right={6}
              shadow-camera-top={6}
              shadow-camera-bottom={-6}
              shadow-camera-near={0.5}
              shadow-camera-far={30}
              shadow-bias={-0.002}
              shadow-radius={50}
            />
            {/* Invisible ground plane that receives the shadow */}
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, -1.69, 0]}
              receiveShadow
            >
              <planeGeometry args={[20, 20]} />
              <shadowMaterial opacity={viewMode === 'ingame' ? 0.55 : 0.35} />
            </mesh>

            {/* Environment: hex platform + particles in model view only */}
            {viewMode === 'model' && (
              <>
                <HexPlatform />
                <Particles />
              </>
            )}

            <CameraController viewMode={viewMode} rawHeight={rawModelHeight} />

            <OrbitControls
              enableRotate={viewMode !== 'ingame'}
              enablePan={false}
              enableZoom
              minDistance={viewMode === 'ingame' ? 4 : 2}
              maxDistance={viewMode === 'ingame' ? 20 : 12}
              minPolarAngle={viewMode === 'ingame' ? 0 : 0.2}
              maxPolarAngle={viewMode === 'ingame' ? Math.PI : Math.PI / 2}
              autoRotate={false}
              enableDamping
              dampingFactor={0.05}
              target={[0, 0, 0]}
            />
          </Canvas>
        </ModelErrorBoundary>
      )}

      {/* Chroma loading spinner */}
      {chromaLoading && (
        <div className="chroma-loading-overlay">
          <div className="chroma-loading-spinner" />
        </div>
      )}

      {/* Map side toggle buttons (ingame mode only) */}
      {viewMode === 'ingame' && !modelError && (
        <>
          <button
            className={`side-btn side-btn-blue${mapSide === 'blue' ? ' active' : ''}`}
            onClick={() => setMapSide('blue')}
            title="Blue Side"
          >
            <span className="side-label">Blue</span>
            <div className="side-icon-box">
              <svg viewBox="0 0 40 40" fill="currentColor" className="side-icon">
                <polygon points="4,36 4,8 32,36" />
              </svg>
            </div>
          </button>
          <button
            className={`side-btn side-btn-red${mapSide === 'red' ? ' active' : ''}`}
            onClick={() => setMapSide('red')}
            title="Red Side"
          >
            <div className="side-icon-box">
              <svg viewBox="0 0 40 40" fill="currentColor" className="side-icon">
                <polygon points="36,4 36,32 8,4" />
              </svg>
            </div>
            <span className="side-label">Red</span>
          </button>
        </>
      )}

      {/* Emote buttons */}
      {availableEmotes.length > 0 && !modelError && (
        <div className="emote-bar">
          {(['idle', 'joke', 'taunt', 'dance', 'laugh'] as EmoteType[]).map(
            (type) =>
              availableEmotes.includes(type) && (
                <div key={type} className="emote-btn-wrapper">
                  <button
                    className={`emote-btn${activeEmote === type ? ' active' : ''}`}
                    onClick={() => handleEmoteClick(type)}
                  >
                    {EMOTE_ICONS[type]}
                    <span>{EMOTE_LABELS[type]}</span>
                  </button>
                  <div className="emote-tooltip">
                    {type === 'idle' || activeEmote === type
                      ? currentAnimName || 'None'
                      : (emoteAnimNames[type]?.join(', ') || 'None')}
                  </div>
                </div>
              ),
          )}
        </div>
      )}

      {/* Chroma selector */}
      {chromas.length > 0 && !modelError && (
        <div className="chroma-bar">
          {/* Base skin (no chroma) */}
          <button
            className={`chroma-swatch${selectedChromaId === null ? ' active' : ''}`}
            onClick={() => onChromaSelect(null)}
            title="Default"
          >
            <svg viewBox="0 0 20 20" className="chroma-reset-icon">
              <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <line x1="4" y1="16" x2="16" y2="4" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
          {chromas.map((chroma) => {
            const c1 = chroma.colors[0] ?? '#888';
            const c2 = chroma.colors[1] ?? c1;
            const bg =
              c1 === c2
                ? c1
                : `linear-gradient(135deg, ${c1} 50%, ${c2} 50%)`;
            return (
              <button
                key={chroma.id}
                className={`chroma-swatch${selectedChromaId === chroma.id ? ' active' : ''}`}
                style={{ background: bg }}
                onClick={() => onChromaSelect(chroma.id)}
                title={chroma.name}
              />
            );
          })}
        </div>
      )}

    </div>
  );
}
