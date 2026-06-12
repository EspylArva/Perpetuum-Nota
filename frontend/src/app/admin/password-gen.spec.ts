import { describe, expect, it } from 'vitest';
import { generateTempPassword } from './password-gen';

const ALLOWED = /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789]+$/;
const DIGIT = /[23456789]/;
const AMBIGUOUS = /[0OIl1]/;

describe('generateTempPassword', () => {
  it('returns the default length of 16', () => {
    expect(generateTempPassword()).toHaveLength(16);
  });

  it('returns the requested length', () => {
    expect(generateTempPassword(20)).toHaveLength(20);
    expect(generateTempPassword(8)).toHaveLength(8);
  });

  it('contains only allowed characters', () => {
    for (let i = 0; i < 50; i++) {
      const pw = generateTempPassword();
      expect(pw).toMatch(ALLOWED);
      expect(pw).not.toMatch(AMBIGUOUS);
    }
  });

  it('always contains at least one digit', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateTempPassword()).toMatch(DIGIT);
    }
  });

  it('produces distinct values across calls', () => {
    const samples = new Set(Array.from({ length: 20 }, () => generateTempPassword()));
    expect(samples.size).toBeGreaterThan(1);
  });
});
