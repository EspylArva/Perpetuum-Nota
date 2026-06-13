import {
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NotesApi } from '../core/notes.api';
import { shouldOpenInApp } from '../manager/click-modifiers';
import { GraphEdgeInput, LaidOutNode, layoutGraph } from './graph-layout';

interface RenderEdge {
  a: LaidOutNode;
  b: LaidOutNode;
  active: boolean; // touches the hovered node
}

/**
 * Obsidian-style wikilink graph. Fetches GET /api/notes/graph, runs the pure
 * hand-rolled force layout once (static render — no live physics), and draws an
 * SVG of circles + titles. Hovering a node highlights it, its edges and its
 * direct neighbours (everything else dims). Clicking a node opens that note;
 * Ctrl/middle-click opens it in a new tab via the /note/:id anchor.
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
  ],
  templateUrl: './graph-view.html',
  styleUrl: './graph-view.scss',
})
export class GraphView implements OnInit {
  private readonly api = inject(NotesApi);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly error = signal(false);
  private readonly nodes = signal<{ id: string; title: string }[]>([]);
  private readonly edges = signal<GraphEdgeInput[]>([]);

  /** Currently hovered node id, or null (drives highlight/dim). */
  readonly hovered = signal<string | null>(null);

  /** Static layout, recomputed only when the fetched graph changes. */
  private readonly layout = computed(() =>
    layoutGraph(this.nodes(), this.edges()),
  );

  readonly width = computed(() => this.layout().width);
  readonly height = computed(() => this.layout().height);
  readonly laidOutNodes = computed(() => this.layout().nodes);
  readonly isEmpty = computed(
    () => !this.loading() && this.laidOutNodes().length === 0,
  );

  private readonly nodeById = computed(
    () => new Map(this.layout().nodes.map((n) => [n.id, n])),
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
    const byId = this.nodeById();
    const h = this.hovered();
    return this.layout().edges.map((e) => ({
      a: byId.get(e.a)!,
      b: byId.get(e.b)!,
      active: h != null && (e.a === h || e.b === h),
    }));
  });

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

  /** True when a node should be dimmed (something is hovered and it's not a neighbour). */
  dimmed(id: string): boolean {
    const h = this.hovered();
    return h != null && !this.neighbours().has(id);
  }

  /** True when a node is the hovered one or a direct neighbour. */
  highlighted(id: string): boolean {
    return this.hovered() != null && this.neighbours().has(id);
  }

  /**
   * Plain left-click opens in-app; Ctrl/Cmd/Shift/Alt/middle-click fall through
   * so the browser opens the /note/:id anchor in a new tab/window.
   */
  openNode(id: string, event: MouseEvent): void {
    if (!shouldOpenInApp(event)) return;
    event.preventDefault();
    void this.router.navigate(['/note', id]);
  }
}
