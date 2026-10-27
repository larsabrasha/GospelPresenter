// Outputs (spec 04 "Outputs", LIVE-R30): what a presentation can send to. A
// public output, which anyone opens at `/watch/{code}`; a saved screen, which
// a TV opens at `/display?id={code}`; and a temporary screen, paired for the
// session with a four-digit code or a QR token (spec 04 §5, LIVE-R28).

/** Lower-case letters and digits that are not easily confused (no i, l, o, 0, 1). */
export const DISPLAY_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const DISPLAY_CODE_LENGTH = 7;
export const DISPLAY_CODE = /^[abcdefghjkmnpqrstuvwxyz23456789]{7}$/;

/** At most 50 outputs per organisation, screens and public ones together (LIVE-R30). */
export const MAX_DISPLAYS = 50;

/** A new code from random bytes (the caller's `crypto.getRandomValues`): unbiased, by rejection. */
export function displayCode(random: (n: number) => Uint8Array): string {
  let code = '';
  const limit = 256 - (256 % DISPLAY_CODE_ALPHABET.length);
  while (code.length < DISPLAY_CODE_LENGTH) {
    for (const b of random(16)) {
      if (b < limit && code.length < DISPLAY_CODE_LENGTH) code += DISPLAY_CODE_ALPHABET[b % DISPLAY_CODE_ALPHABET.length];
    }
  }
  return code;
}

/** A temporary screen's id: 32 random bytes, base64url. It is the screen's only credential. */
export const SCREEN_ID = /^[A-Za-z0-9_-]{43}$/;
/** A QR pairing token (LIVE-R28): 32 random bytes, base64url. */
export const SCREEN_TOKEN = /^[A-Za-z0-9_-]{43}$/;
/** A pairing code (LIVE-R28): four digits in [1000, 9998]. */
export const SCREEN_PIN = /^\d{4}$/;
/** How long a pairing code or a QR token is good for (LIVE-R28). */
export const SCREEN_PAIRING_MS = 10 * 60_000;
