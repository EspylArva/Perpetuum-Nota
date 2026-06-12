// Alphabet without visually ambiguous characters: 0 O I l 1
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
const DIGITS = '23456789';
const CHARSET = ALPHA + DIGITS;

/**
 * Generates a cryptographically random temporary password.
 * Guaranteed to contain at least one digit; uses only unambiguous characters.
 */
export function generateTempPassword(length = 16): string {
  if (length < 2) throw new RangeError('length must be at least 2');

  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);

  const chars = Array.from(bytes, (b) => CHARSET[b % CHARSET.length]);

  // Guarantee at least one digit — replace the last char with a random digit.
  const digitBytes = new Uint32Array(1);
  crypto.getRandomValues(digitBytes);
  chars[length - 1] = DIGITS[digitBytes[0] % DIGITS.length];

  return chars.join('');
}
