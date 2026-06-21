/**
 * Deterministic per-tag colors. A tag name always maps to the same swatch, so
 * the same tag reads identically across the list, the wall and the sidebar.
 *
 * The swatches are theme-agnostic medium-tone hues (the same trick the editor
 * uses): the chip background is a translucent tint of the hue (`color-mix`
 * with `transparent`) so it sits over whatever themed surface is behind it and
 * stays legible in both light and dark; the foreground is the solid hue.
 */

/** Curated, theme-agnostic hues — medium tones that read on light + dark. */
const PALETTE: readonly string[] = [
  '#e53935', // red
  '#fb8c00', // orange
  '#f9a825', // amber
  '#43a047', // green
  '#00897b', // teal
  '#00acc1', // cyan
  '#1e88e5', // blue
  '#3949ab', // indigo
  '#8e24aa', // purple
  '#d81b60', // pink
  '#6d4c41', // brown
  '#546e7a', // blue-grey
];

/** A chip's resolved colors: translucent tinted background + solid foreground. */
export interface TagColor {
  bg: string;
  fg: string;
}

/**
 * 32-bit FNV-1a hash of `name`. Deterministic and order-sensitive so visually
 * similar tags still scatter across the palette.
 */
function hash(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Force unsigned so the modulo below is always non-negative.
  return h >>> 0;
}

/**
 * Maps a tag name to a deterministic color from the curated palette. Pure: the
 * same name always returns the same `{ bg, fg }`.
 */
export function tagColor(name: string): TagColor {
  const hue = PALETTE[hash(name) % PALETTE.length];
  return {
    // Translucent tint over the themed surface — legible in light + dark.
    bg: `color-mix(in srgb, ${hue} 22%, transparent)`,
    fg: hue,
  };
}
