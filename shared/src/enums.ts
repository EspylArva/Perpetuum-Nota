// String-literal unions shared across frontend + backend.
// Kept as plain types (no TS `enum`) so this package carries ZERO runtime code
// and can be consumed via `import type` with no bundling/resolution cost.
// These line up exactly with the Prisma-generated enum string values.

export type Role = 'USER' | 'ADMIN';

export type Visibility = 'PRIVATE' | 'PUBLIC';

// Manager list filters. 'trash' = the viewer's own soft-deleted notes.
export type NoteFilter = 'mine' | 'shared' | 'all' | 'trash';

// Manager sort orders. Default (undefined) = explicit drag position.
export type NoteSort = 'position' | 'updated' | 'created' | 'title' | 'dueDate';
