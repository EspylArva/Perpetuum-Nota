// Minimal structural type for a ProseMirror / TipTap document.
// Note content is stored as this JSON shape (jsonb) on the server.
// Image size/position live in node `attrs` (e.g. width/height, and future x/y/floating),
// never as separate columns — so free-floating images become an additive v2 feature.

export interface ProseMirrorMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface ProseMirrorNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ProseMirrorNode[];
  marks?: ProseMirrorMark[];
  text?: string;
}

export interface ProseMirrorDoc {
  type: 'doc';
  content?: ProseMirrorNode[];
}
