/**
 * Hand-rolled force-directed graph layout — no external deps, fully
 * DETERMINISTIC. Initial positions are seeded from a string hash of each node
 * id (never Math.random / Date.now), so the same input always produces the same
 * output. A few hundred iterations of all-pairs repulsion + edge springs +
 * light centering settle the layout; we then render statically (no live
 * physics). Connected nodes end up closer together than unconnected ones.
 */

export interface GraphNodeInput {
  id: string;
  title: string;
}

export interface GraphEdgeInput {
  a: string;
  b: string;
}

export interface LaidOutNode {
  id: string;
  title: string;
  x: number;
  y: number;
}

export interface GraphLayout {
  nodes: LaidOutNode[];
  edges: GraphEdgeInput[];
  width: number;
  height: number;
}

export interface LayoutOptions {
  width?: number;
  height?: number;
  iterations?: number;
}

const DEFAULTS = {
  width: 1000,
  height: 700,
  iterations: 250,
  repulsion: 9000, // all-pairs repulsive strength
  spring: 0.02, // edge spring stiffness
  springLength: 120, // natural edge length
  centering: 0.01, // pull toward the canvas centre
  damping: 0.85, // velocity retained per step
  maxStep: 40, // clamp per-iteration movement for stability
};

/**
 * Deterministic 32-bit string hash (FNV-1a style). Used to seed initial node
 * positions so the layout is stable across runs without any RNG.
 */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Force to an unsigned 32-bit integer.
  return h >>> 0;
}

/** Maps a hash to a float in [0, 1) deterministically. */
function unit(hash: number): number {
  return (hash % 100000) / 100000;
}

/**
 * Mutable simulation state. The component drives live physics by mutating this
 * in place via {@link stepSim} (e.g. while a node is being dragged), reading the
 * `px/py` arrays each frame. `layoutGraph` uses the very same primitive to
 * produce its deterministic static layout, so the two never drift apart.
 */
export interface SimState {
  ids: string[];
  titles: string[];
  index: Map<string, number>;
  px: number[];
  py: number[];
  vx: number[];
  vy: number[];
  /** Edge endpoint index pairs (filtered: no self-edges, both endpoints exist). */
  adj: (readonly [number, number])[];
  /** Filtered edges in id form (same filtering as `adj`), for rendering. */
  edges: GraphEdgeInput[];
  width: number;
  height: number;
}

/**
 * Builds a {@link SimState} with positions seeded deterministically from each id
 * hash (never Math.random / Date.now), velocities zeroed. Same input → same
 * seed, so a static layout run from here is reproducible.
 */
export function createSimState(
  nodesIn: GraphNodeInput[],
  edgesIn: GraphEdgeInput[],
  options: LayoutOptions = {},
): SimState {
  const width = options.width ?? DEFAULTS.width;
  const height = options.height ?? DEFAULTS.height;
  const cx = width / 2;
  const cy = height / 2;

  // Keep only edges whose endpoints both exist, and drop self-edges.
  const idSet = new Set(nodesIn.map((n) => n.id));
  const edges = edgesIn.filter(
    (e) => e.a !== e.b && idSet.has(e.a) && idSet.has(e.b),
  );

  const ids: string[] = [];
  const titles: string[] = [];
  const px: number[] = [];
  const py: number[] = [];
  const vx: number[] = [];
  const vy: number[] = [];
  const index = new Map<string, number>();

  nodesIn.forEach((nd, i) => {
    index.set(nd.id, i);
    ids[i] = nd.id;
    titles[i] = nd.title;
    const hx = unit(hashString(nd.id));
    const hy = unit(hashString(`${nd.id}#y`));
    // Spread across ~80% of the canvas so seeds aren't all stacked centrally.
    px[i] = cx + (hx - 0.5) * width * 0.8;
    py[i] = cy + (hy - 0.5) * height * 0.8;
    vx[i] = 0;
    vy[i] = 0;
  });

  const adj = edges.map((e) => [index.get(e.a)!, index.get(e.b)!] as const);

  return { ids, titles, index, px, py, vx, vy, adj, edges, width, height };
}

/**
 * Advances the simulation by a single iteration, mutating `s` in place.
 *
 * `alpha` scales every force (Obsidian-style cooling): callers decay it toward 0
 * so the layout settles, and reheat it to ~1 on interaction. `pinned` indices
 * are held fixed — their forces are skipped and they are not integrated — so a
 * dragged node stays glued to the cursor while its neighbours react around it.
 */
export function stepSim(
  s: SimState,
  alpha = 1,
  pinned?: Set<number>,
): void {
  const { px, py, vx, vy, adj, width, height } = s;
  const n = px.length;
  if (n <= 1) return;
  const cx = width / 2;
  const cy = height / 2;

  const fx = new Array<number>(n).fill(0);
  const fy = new Array<number>(n).fill(0);

  // All-pairs repulsion (Coulomb-like).
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let dx = px[i] - px[j];
      let dy = py[i] - py[j];
      let distSq = dx * dx + dy * dy;
      if (distSq < 0.01) {
        // Coincident seeds: nudge deterministically apart using the indices.
        dx = (i - j) * 0.1 + 0.1;
        dy = (i + j) * 0.1 + 0.1;
        distSq = dx * dx + dy * dy;
      }
      const dist = Math.sqrt(distSq);
      const force = DEFAULTS.repulsion / distSq;
      const ux = dx / dist;
      const uy = dy / dist;
      fx[i] += ux * force;
      fy[i] += uy * force;
      fx[j] -= ux * force;
      fy[j] -= uy * force;
    }
  }

  // Edge springs (Hooke-like) pull linked nodes toward springLength.
  for (const [i, j] of adj) {
    const dx = px[j] - px[i];
    const dy = py[j] - py[i];
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
    const displacement = dist - DEFAULTS.springLength;
    const force = DEFAULTS.spring * displacement;
    const ux = dx / dist;
    const uy = dy / dist;
    fx[i] += ux * force;
    fy[i] += uy * force;
    fx[j] -= ux * force;
    fy[j] -= uy * force;
  }

  // Light centering keeps disconnected components on-canvas.
  for (let i = 0; i < n; i++) {
    fx[i] += (cx - px[i]) * DEFAULTS.centering;
    fy[i] += (cy - py[i]) * DEFAULTS.centering;
  }

  // Integrate with damping + a per-step clamp for stability. Pinned nodes hold
  // their position (cursor-controlled) and keep zero velocity.
  for (let i = 0; i < n; i++) {
    if (pinned?.has(i)) {
      vx[i] = 0;
      vy[i] = 0;
      px[i] = clamp(px[i], 0, width);
      py[i] = clamp(py[i], 0, height);
      continue;
    }
    vx[i] = (vx[i] + fx[i] * alpha) * DEFAULTS.damping;
    vy[i] = (vy[i] + fy[i] * alpha) * DEFAULTS.damping;
    vx[i] = clamp(vx[i], -DEFAULTS.maxStep, DEFAULTS.maxStep);
    vy[i] = clamp(vy[i], -DEFAULTS.maxStep, DEFAULTS.maxStep);
    px[i] += vx[i];
    py[i] += vy[i];
    px[i] = clamp(px[i], 0, width);
    py[i] = clamp(py[i], 0, height);
  }
}

/**
 * Computes a static force-directed layout. Pure: same input → same output.
 * Handles 0 and 1 node gracefully (no NaN, single node centred). Built on the
 * same {@link createSimState}/{@link stepSim} primitives the live view uses.
 */
export function layoutGraph(
  nodesIn: GraphNodeInput[],
  edgesIn: GraphEdgeInput[],
  options: LayoutOptions = {},
): GraphLayout {
  const iterations = options.iterations ?? DEFAULTS.iterations;
  const s = createSimState(nodesIn, edgesIn, options);
  const { width, height } = s;
  const cx = width / 2;
  const cy = height / 2;
  const n = nodesIn.length;

  // A single node (or none) needs no force simulation — centre the one node.
  if (n <= 1) {
    return {
      nodes: nodesIn.map((nd, i) => ({
        id: nd.id,
        title: nd.title,
        x: n === 1 ? cx : s.px[i],
        y: n === 1 ? cy : s.py[i],
      })),
      edges: s.edges,
      width,
      height,
    };
  }

  // Run the static settle at full force (alpha = 1, no pins) — identical maths
  // to the previous inline loop, so the deterministic output is unchanged.
  for (let iter = 0; iter < iterations; iter++) {
    stepSim(s, 1);
  }

  return {
    nodes: nodesIn.map((nd, i) => ({
      id: nd.id,
      title: nd.title,
      x: s.px[i],
      y: s.py[i],
    })),
    edges: s.edges,
    width,
    height,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Euclidean distance between two laid-out nodes (test/util helper). */
export function nodeDistance(a: LaidOutNode, b: LaidOutNode): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
