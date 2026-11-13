import { describe, expect, it } from 'vitest';
import { byLetter, letterOf } from '../src/pages/songLetters.ts';

describe('letterOf', () => {
  it('is the first letter in capitals', () => {
    const letter = letterOf('blott en dag');

    expect(letter).toBe('B');
  });

  it('keeps Å, Ä and Ö as letters of their own', () => {
    const letters = ['Åt dig', 'Ära', 'Ö'].map(letterOf);

    expect(letters).toEqual(['Å', 'Ä', 'Ö']);
  });

  it('puts a name starting with a digit or a sign under #', () => {
    const letters = ['10 000 anledningar', '"Herre"'].map(letterOf);

    expect(letters).toEqual(['#', '#']);
  });
});

describe('byLetter', () => {
  it('groups the songs by letter in the order they come', () => {
    const songs = [{ name: 'Amen' }, { name: 'Allt' }, { name: 'Blott' }];

    const sections = byLetter(songs);

    expect(sections.map((s) => [s.letter, s.songs.length])).toEqual([
      ['A', 2],
      ['B', 1],
    ]);
  });
});
