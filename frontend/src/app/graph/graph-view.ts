import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NotesApi } from '../core/notes.api';
import { shouldOpenInApp } from '../manager/click-modifiers';
import { NoteEditor } from '../editor/note-editor';
import {
  GraphEdgeInput,
  SimState,
  createSimState,
  layoutGraph,
  stepSim,
} from './graph-layout';

interface Pt {
  x: number;
  y: number;
}

interface RenderEdge {
  aId: string;
  bId: string;
  a: Pt;
  b: Pt;
  active: boolean; // touches the hovered node
}

type DragState =
  | {
      kind: 'node';
      id: string;
      idx: number;
      pointerId: number;
      startClientX: number;
      startClientY: number;
      grabOffset: Pt;
      moved: boolean;
    }
  | {
      kind: 'pan';
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startTx: number;
      startTy: number;
      moved: boolean;
    };

const ZERO: Pt = { x: 0, y: 0 };
const MIN_SCALE = 0.2;
const MAX_SCALE = 4;

/**
 * Obsidian-style wikilink graph. Fetches GET /api/notes/graph, seeds positions
 * from the pure deterministic force layout, then drives a *live* force
 * simulation (see graph-layout's stepSim) whenever a node is dragged so the rest
 * of the graph reacts. Pan (drag empty canvas) + zoom (wheel / buttons) move a
 * single SVG transform group. Hovering a node highlights it, its edges and
 * direct neighbours; clicking a node opens it in a right-side sheet (the graph
 * shrinks and re-centres on the node). Ctrl/middle-click still opens /note/:id
 * in a new tab via the anchor.
 */
@Component({
  selector: 'app-graph-view',
  imports: [
    RouterLink,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    NoteEditor,
  ],
  templateUrl: './graph-view.html',
  styleUrl: './graph-view.scss',
})
export class GraphView implements OnInit, OnDestroy {
  private readonly api = inject(NotesApi);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly error = signal(false);
  private readonly nodes = signal<{ id: string; title: string }[]>([]);
  private readonly edges = signal<GraphEdgeInput[]>([]);

  /** Currently hovered node id, or null (drives highlight/dim). */
  readonly hovered = signal<string | null>(null);
  /** Selected node id — opens the side sheet, or null when closed. */
  readonly selectedId = signal<string | null>(null);

  // --- viewport transform (graph → screen): translate then scale ---
  readonly scale = signal(1);
  readonly tx = signal(0);
  readonly ty = signal(0);
  readonly viewTransform = computed(
    () => `translate(${this.tx()} ${this.ty()}) scale(${this.scale()})`,
  );
  /** True while panning the background (toggles the grabbing cursor). */
  readonly panning = signal(false);

  private readonly svgRef =
    viewChild<ElementRef<SVGSVGElement>>('svg');
  private readonly stageRef = viewChild<ElementRef<HTMLElement>>('stage');

  /** Static deterministic layout — seeds the sim and supplies node id/title. */
  private readonly layout = computed(() =>
    layoutGraph(this.nodes(), this.edges()),
  );

  /** Live node positions, mirrored from the simulation each frame. */
  readonly positions = signal<Map<string, Pt>>(new Map());

  readonly width = computed(() => this.layout().width);
  readonly height = computed(() => this.layout().height);
  /** Stable {id,title} list; render positions come from `positions()`. */
  readonly nodeList = computed(() => this.layout().nodes);
  readonly isEmpty = computed(
    () => !this.loading() && this.nodeList().length === 0,
  );

  readonly selectedTitle = computed(
    () =>
      this.nodeList().find((n) => n.id === this.selectedId())?.title || 'note',
  );

  /** Ids directly linked to the hovered node (plus the hovered node itself). */
  private readonly neighbours = computed(() => {
    const h = this.hovered();
    const set = new Set<string>();
    if (!h) return set;
    set.add(h);
    for (const e of this.layout().edges) {
      if (e.a === h) set.add(e.b);
      if (e.b === h) set.add(e.a);
    }
    return set;
  });

  readonly renderEdges = computed<RenderEdge[]>(() => {
    const p = this.positions();
    const h = this.hovered();
    return this.layout().edges.map((e) => ({
      aId: e.a,
      bId: e.b,
      a: p.get(e.a) ?? ZERO,
      b: p.get(e.b) ?? ZERO,
      active: h != null && (e.a === h || e.b === h),
    }));
  });

  // --- live simulation ---
  private sim: SimState | null = null;
  private readonly pinned = new Set<number>();
  private alpha = 0;
  private rafId: number | null = null;
  private fitted = false;
  private resizeObs: ResizeObserver | null = null;
  private drag: DragState | null = null;
  private static readonly DRAG_THRESHOLD = 4; // px (screen)
  private static readonly MIN_ALPHA = 0.02;

  constructor() {
    // Rebuild the simulation whenever the fetched graph changes. Seed positions
    // from the settled deterministic layout so first paint is stable (no intro
    // animation); the live sim only kicks in on drag.
    effect(() => {
      const laid = this.layout();
      untracked(() => {
        const sim = createSimState(laid.nodes, laid.edges);
        for (const nd of laid.nodes) {
          const i = sim.index.get(nd.id);
          if (i != null) {
            sim.px[i] = nd.x;
            sim.py[i] = nd.y;
          }
        }
        this.sim = sim;
        this.pinned.clear();
        this.alpha = 0;
        this.cancelRaf();
        this.syncPositions();
        this.fitted = false;
      });
    });

    // Fit the view once the SVG is in the DOM (and re-fit on a new graph).
    effect(() => {
      const svg = this.svgRef();
      this.layout(); // re-fit on graph change
      if (svg && !untracked(() => this.fitted)) {
        untracked(() => this.fitToContainer());
      }
    });

    // Observe the stage so the graph re-centres on the selected node when the
    // side sheet reflows the width, and re-fits on window resize when idle.
    effect(() => {
      const stage = this.stageRef();
      if (stage && !this.resizeObs) {
        this.resizeObs = new ResizeObserver(() => this.onStageResize());
        this.resizeObs.observe(stage.nativeElement);
      }
    });
  }

  ngOnInit(): void {
    this.api.graph().subscribe({
      next: (g) => {
        this.nodes.set(g.nodes);
        this.edges.set(g.edges);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }

  ngOnDestroy(): void {
    this.cancelRaf();
    this.resizeObs?.disconnect();
    this.resizeObs = null;
  }

  // ----------------------------------------------------------------- rendering

  pos(id: string): Pt {
    return this.positions().get(id) ?? ZERO;
  }

  dimmed(id: string): boolean {
    const h = this.hovered();
    return h != null && !this.neighbours().has(id);
  }

  highlighted(id: string): boolean {
    return this.hovered() != null && this.neighbours().has(id);
  }

  isHovered(id: string): boolean {
    return this.hovered() === id;
  }

  // ----------------------------------------------------------------- sim loop

  private syncPositions(): void {
    const sim = this.sim;
    if (!sim) {
      this.positions.set(new Map());
      return;
    }
    const m = new Map<string, Pt>();
    for (let i = 0; i < sim.ids.length; i++) {
      m.set(sim.ids[i], { x: sim.px[i], y: sim.py[i] });
    }
    this.positions.set(m);
  }

  private reheat(): void {
    this.alpha = 1;
    this.ensureRunning();
  }

  private ensureRunning(): void {
    if (this.rafId == null) {
      this.rafId = requestAnimationFrame(this.frame);
    }
  }

  private cancelRaf(): void {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private readonly frame = (): void => {
    this.rafId = null;
    const sim = this.sim;
    if (!sim) return;
    const dragging = this.drag?.kind === 'node';
    stepSim(sim, this.alpha, this.pinned);
    this.syncPositions();
    if (!dragging) this.alpha *= 0.92;
    if (dragging || this.alpha > GraphView.MIN_ALPHA) {
      this.ensureRunning();
    } else {
      this.alpha = 0;
    }
  };

  // ------------------------------------------------------------- coordinates

  private clientToGraph(clientX: number, clientY: number): Pt {
    const svg = this.svgRef()?.nativeElement;
    if (!svg) return ZERO;
    const rect = svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.tx()) / this.scale(),
      y: (clientY - rect.top - this.ty()) / this.scale(),
    };
  }

  private fitToContainer(): void {
    const svg = this.svgRef()?.nativeElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const gw = this.width();
    const gh = this.height();
    const s = Math.min(rect.width / gw, rect.height / gh) * 0.9;
    this.scale.set(s);
    this.tx.set((rect.width - gw * s) / 2);
    this.ty.set((rect.height - gh * s) / 2);
    this.fitted = true;
  }

  private recenterOnSelected(): void {
    const id = this.selectedId();
    const svg = this.svgRef()?.nativeElement;
    if (!id || !svg) return;
    const p = this.positions().get(id);
    if (!p) return;
    const rect = svg.getBoundingClientRect();
    const s = this.scale();
    this.tx.set(rect.width / 2 - p.x * s);
    this.ty.set(rect.height / 2 - p.y * s);
  }

  private onStageResize(): void {
    if (this.selectedId()) this.recenterOnSelected();
    else if (!this.fitted) this.fitToContainer();
  }

  // ------------------------------------------------------------------- zoom

  onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const svg = this.svgRef()?.nativeElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const next = clampScale(this.scale() * Math.exp(-ev.deltaY * 0.0015));
    const g = this.clientToGraph(ev.clientX, ev.clientY);
    this.tx.set(ev.clientX - rect.left - g.x * next);
    this.ty.set(ev.clientY - rect.top - g.y * next);
    this.scale.set(next);
  }

  private zoomBy(factor: number): void {
    const svg = this.svgRef()?.nativeElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const sx = rect.width / 2;
    const sy = rect.height / 2;
    const next = clampScale(this.scale() * factor);
    const gx = (sx - this.tx()) / this.scale();
    const gy = (sy - this.ty()) / this.scale();
    this.tx.set(sx - gx * next);
    this.ty.set(sy - gy * next);
    this.scale.set(next);
  }

  zoomIn(): void {
    this.zoomBy(1.2);
  }

  zoomOut(): void {
    this.zoomBy(1 / 1.2);
  }

  resetView(): void {
    this.fitToContainer();
  }

  // --------------------------------------------------------- pointer / drag

  onNodePointerDown(id: string, ev: PointerEvent): void {
    // Modified / non-left clicks fall through to the <a href> for a new tab.
    if (!shouldOpenInApp(ev)) return;
    ev.preventDefault();
    const sim = this.sim;
    const idx = sim?.index.get(id);
    if (!sim || idx == null) return;
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
    const g = this.clientToGraph(ev.clientX, ev.clientY);
    this.drag = {
      kind: 'node',
      id,
      idx,
      pointerId: ev.pointerId,
      startClientX: ev.clientX,
      startClientY: ev.clientY,
      grabOffset: { x: g.x - sim.px[idx], y: g.y - sim.py[idx] },
      moved: false,
    };
  }

  onBackgroundPointerDown(ev: PointerEvent): void {
    if (ev.button !== 0) return;
    // Only a gesture that starts on empty canvas pans (not one on a node).
    if ((ev.target as Element).closest('.node-link')) return;
    const svg = this.svgRef()?.nativeElement;
    svg?.setPointerCapture?.(ev.pointerId);
    this.drag = {
      kind: 'pan',
      pointerId: ev.pointerId,
      startClientX: ev.clientX,
      startClientY: ev.clientY,
      startTx: this.tx(),
      startTy: this.ty(),
      moved: false,
    };
    this.panning.set(true);
  }

  onPointerMove(ev: PointerEvent): void {
    const d = this.drag;
    if (!d || ev.pointerId !== d.pointerId) return;
    const dx = ev.clientX - d.startClientX;
    const dy = ev.clientY - d.startClientY;
    if (!d.moved && Math.hypot(dx, dy) < GraphView.DRAG_THRESHOLD) return;
    d.moved = true;
    if (d.kind === 'node') {
      const sim = this.sim;
      if (!sim) return;
      const g = this.clientToGraph(ev.clientX, ev.clientY);
      sim.px[d.idx] = g.x - d.grabOffset.x;
      sim.py[d.idx] = g.y - d.grabOffset.y;
      sim.vx[d.idx] = 0;
      sim.vy[d.idx] = 0;
      this.pinned.add(d.idx);
      this.reheat();
    } else {
      this.tx.set(d.startTx + dx);
      this.ty.set(d.startTy + dy);
    }
  }

  onPointerUp(ev: PointerEvent): void {
    const d = this.drag;
    if (!d || ev.pointerId !== d.pointerId) return;
    this.drag = null;
    if (d.kind === 'node') {
      this.pinned.delete(d.idx);
      if (!d.moved) this.selectNode(d.id);
      else this.reheat(); // let the released node settle into the layout
    } else {
      this.panning.set(false);
    }
  }

  /** Plain left clicks select in-app; modified clicks fall through to the anchor. */
  onNodeClick(ev: MouseEvent): void {
    if (shouldOpenInApp(ev)) ev.preventDefault();
  }

  onNodeKeydown(id: string, ev: Event): void {
    ev.preventDefault();
    this.selectNode(id);
  }

  onHoverEnter(id: string): void {
    if (!this.drag) this.hovered.set(id);
  }

  onHoverLeave(id: string): void {
    if (this.hovered() === id) this.hovered.set(null);
  }

  // --------------------------------------------------------------- side sheet

  selectNode(id: string): void {
    const wasOpen = this.selectedId() !== null;
    this.selectedId.set(id);
    // When the sheet is already open the stage width is unchanged, so recentre
    // now. Opening from closed relies on the ResizeObserver firing once the
    // sheet has reflowed the stage.
    if (wasOpen) this.recenterOnSelected();
  }

  closeSheet(): void {
    this.selectedId.set(null);
  }
}

function clampScale(s: number): number {
  return s < MIN_SCALE ? MIN_SCALE : s > MAX_SCALE ? MAX_SCALE : s;
}
