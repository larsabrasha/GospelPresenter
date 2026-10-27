// Outputs (spec 04 "Outputs", LIVE-R30): what a presentation can send to.
// So far a public output, which anyone opens at `/watch/{code}`.

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
