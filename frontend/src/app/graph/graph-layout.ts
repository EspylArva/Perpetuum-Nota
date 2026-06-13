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
 * Computes a static force-directed layout. Pure: same input → same output.
 * Handles 0 and 1 node gracefully (no NaN, single node centred).
 */
export function layoutGraph(
  nodesIn: GraphNodeInput[],
  edgesIn: GraphEdgeInput[],
  options: LayoutOptions = {},
): GraphLayout {
  const width = options.width ?? DEFAULTS.width;
  const height = options.height ?? DEFAULTS.height;
  const iterations = options.iterations ?? DEFAULTS.iterations;
  const cx = width / 2;
  const cy = height / 2;

  // Keep only edges whose endpoints both exist, and drop self-edges.
  const idSet = new Set(nodesIn.map((n) => n.id));
  const edges = edgesIn.filter(
    (e) => e.a !== e.b && idSet.has(e.a) && idSet.has(e.b),
  );

  // Seed positions deterministically from the id hash, spread around the
  // centre. A second hash (id + '#') gives an independent y coordinate.
  const px: number[] = [];
  const py: number[] = [];
  const vx: number[] = [];
  const vy: number[] = [];
  const index = new Map<string, number>();

  nodesIn.forEach((n, i) => {
    index.set(n.id, i);
    const hx = unit(hashString(n.id));
    const hy = unit(hashString(`${n.id}#y`));
    // Spread across ~80% of the canvas so seeds aren't all stacked centrally.
    px[i] = cx + (hx - 0.5) * width * 0.8;
    py[i] = cy + (hy - 0.5) * height * 0.8;
    vx[i] = 0;
    vy[i] = 0;
  });

  const n = nodesIn.length;
  // A single node (or none) needs no force simulation — centre the one node.
  if (n <= 1) {
    return {
      nodes: nodesIn.map((nd, i) => ({
        id: nd.id,
        title: nd.title,
        x: n === 1 ? cx : px[i],
        y: n === 1 ? cy : py[i],
      })),
      edges,
      width,
      height,
    };
  }

  const adj = edges.map((e) => [index.get(e.a)!, index.get(e.b)!] as const);

  for (let iter = 0; iter < iterations; iter++) {
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
      let dx = px[j] - px[i];
      let dy = py[j] - py[i];
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

    // Integrate with damping + a per-step clamp for stability.
    for (let i = 0; i < n; i++) {
      vx[i] = (vx[i] + fx[i]) * DEFAULTS.damping;
      vy[i] = (vy[i] + fy[i]) * DEFAULTS.damping;
      vx[i] = clamp(vx[i], -DEFAULTS.maxStep, DEFAULTS.maxStep);
      vy[i] = clamp(vy[i], -DEFAULTS.maxStep, DEFAULTS.maxStep);
      px[i] += vx[i];
      py[i] += vy[i];
      px[i] = clamp(px[i], 0, width);
      py[i] = clamp(py[i], 0, height);
    }
  }

  return {
    nodes: nodesIn.map((nd, i) => ({
      id: nd.id,
      title: nd.title,
      x: px[i],
      y: py[i],
    })),
    edges,
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
