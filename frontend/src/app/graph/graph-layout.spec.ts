import { describe, expect, it } from 'vitest';
import {
  GraphEdgeInput,
  GraphNodeInput,
  hashString,
  layoutGraph,
  nodeDistance,
} from './graph-layout';

function node(id: string): GraphNodeInput {
  return { id, title: id };
}

function avgEdgeDistance(
  laid: ReturnType<typeof layoutGraph>,
  edges: GraphEdgeInput[],
): number {
  const byId = new Map(laid.nodes.map((n) => [n.id, n]));
  const ds = edges.map((e) => nodeDistance(byId.get(e.a)!, byId.get(e.b)!));
  return ds.reduce((s, d) => s + d, 0) / ds.length;
}

describe('hashString', () => {
  it('is deterministic and unsigned', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).toBeGreaterThanOrEqual(0);
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
});

describe('layoutGraph', () => {
  it('handles 0 nodes', () => {
    const out = layoutGraph([], []);
    expect(out.nodes).toEqual([]);
    expect(out.edges).toEqual([]);
  });

  it('centres a single node with no NaN', () => {
    const out = layoutGraph([node('only')], [], { width: 800, height: 600 });
    expect(out.nodes).toHaveLength(1);
    expect(out.nodes[0].x).toBe(400);
    expect(out.nodes[0].y).toBe(300);
  });

  it('produces no NaN positions for a populated graph', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e'].map(node);
    const edges: GraphEdgeInput[] = [
      { a: 'a', b: 'b' },
      { a: 'b', b: 'c' },
      { a: 'd', b: 'e' },
    ];
    const out = layoutGraph(nodes, edges);
    for (const n of out.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });

  it('is deterministic: same input → identical output across runs', () => {
    const nodes = ['n1', 'n2', 'n3', 'n4'].map(node);
    const edges: GraphEdgeInput[] = [
      { a: 'n1', b: 'n2' },
      { a: 'n3', b: 'n4' },
    ];
    const a = layoutGraph(nodes, edges);
    const b = layoutGraph(nodes, edges);
    expect(a.nodes).toEqual(b.nodes);
    expect(a.edges).toEqual(b.edges);
  });

  it('places connected nodes closer on average than unconnected pairs', () => {
    // Two tight clusters: {a,b,c} all linked, {x,y,z} all linked. No edge
    // crosses clusters, so cross-cluster pairs should sit farther apart.
    const nodes = ['a', 'b', 'c', 'x', 'y', 'z'].map(node);
    const connected: GraphEdgeInput[] = [
      { a: 'a', b: 'b' },
      { a: 'b', b: 'c' },
      { a: 'a', b: 'c' },
      { a: 'x', b: 'y' },
      { a: 'y', b: 'z' },
      { a: 'x', b: 'z' },
    ];
    const out = layoutGraph(nodes, connected, { iterations: 300 });
    const byId = new Map(out.nodes.map((n) => [n.id, n]));

    const connectedAvg = avgEdgeDistance(out, connected);

    // Cross-cluster (unconnected) pairs.
    const crossPairs: [string, string][] = [
      ['a', 'x'],
      ['a', 'y'],
      ['b', 'z'],
      ['c', 'x'],
    ];
    const crossAvg =
      crossPairs
        .map(([p, q]) => nodeDistance(byId.get(p)!, byId.get(q)!))
        .reduce((s, d) => s + d, 0) / crossPairs.length;

    expect(connectedAvg).toBeLessThan(crossAvg);
  });

  it('drops self-edges and edges to missing nodes', () => {
    const out = layoutGraph([node('a'), node('b')], [
      { a: 'a', b: 'a' }, // self
      { a: 'a', b: 'ghost' }, // missing endpoint
      { a: 'a', b: 'b' }, // valid
    ]);
    expect(out.edges).toEqual([{ a: 'a', b: 'b' }]);
  });
});
