import { describe, expect, it } from 'vitest';
import { freshName } from '../src/ui/justCreated.ts';

describe('freshName', () => {
  it('is the name itself when no name has it', () => {
    expect(freshName('Ny sång', ['Härlig är jorden'])).toBe('Ny sång');
  });

  it('numbers it from 2 when the name is taken, whatever the case', () => {
    expect(freshName('Ny sång', ['ny sång'])).toBe('Ny sång 2');
  });

  it('takes the first number no name has', () => {
    expect(freshName('Ny sång', ['Ny sång', 'Ny sång 2', 'Ny sång 4'])).toBe('Ny sång 3');
  });
});
