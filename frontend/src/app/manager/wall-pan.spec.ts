import { describe, expect, it } from 'vitest';
import { clampPan } from './wall-pan';

describe('clampPan', () => {
  const vp = { w: 800, h: 600 };

  it('content smaller than viewport clamps to a small symmetric range', () => {
    // over = 0 on both axes → range is [-viewport, viewport].
    const content = { w: 400, h: 300 };
    // within range: unchanged
    expect(clampPan({ x: 100, y: -200 }, content, vp)).toEqual({
      x: 100,
      y: -200,
    });
    // beyond +viewport: clamps to +viewport
    expect(clampPan({ x: 5000, y: 5000 }, content, vp)).toEqual({
      x: 800,
      y: 600,
    });
    // beyond -viewport: clamps to -viewport (NOT infinite)
    expect(clampPan({ x: -5000, y: -5000 }, content, vp)).toEqual({
      x: -800,
      y: -600,
    });
  });

  it('content far to the right allows panning out to (over + one viewport)', () => {
    const content = { w: 2000, h: 600 }; // over.x = 1200
    // farthest negative offset = -(1200 + 800) = -2000
    expect(clampPan({ x: -10000, y: 0 }, content, vp).x).toBe(-2000);
    // a value within the negative range is preserved
    expect(clampPan({ x: -1500, y: 0 }, content, vp).x).toBe(-1500);
    // before origin still clamps to +viewport
    expect(clampPan({ x: 9999, y: 0 }, content, vp).x).toBe(800);
  });

  it('content far down allows panning out to (over + one viewport) on y', () => {
    const content = { w: 800, h: 3000 }; // over.y = 2400
    expect(clampPan({ x: 0, y: -10000 }, content, vp).y).toBe(-3000);
    expect(clampPan({ x: 0, y: -2500 }, content, vp).y).toBe(-2500);
    expect(clampPan({ x: 0, y: 9999 }, content, vp).y).toBe(600);
  });

  it('clamps both axes independently when content overflows in 2D', () => {
    const content = { w: 2000, h: 3000 }; // over = (1200, 2400)
    expect(clampPan({ x: -9999, y: -9999 }, content, vp)).toEqual({
      x: -2000,
      y: -3000,
    });
    expect(clampPan({ x: 9999, y: 9999 }, content, vp)).toEqual({
      x: 800,
      y: 600,
    });
  });

  it('an in-bounds offset is returned unchanged', () => {
    const content = { w: 2000, h: 3000 };
    expect(clampPan({ x: -500, y: -1000 }, content, vp)).toEqual({
      x: -500,
      y: -1000,
    });
  });
});
