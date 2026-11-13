import { describe, expect, it } from 'vitest';
import { appVersion } from '../src/version.ts';

describe("the app's version", () => {
  it('names the commit of a release build', () => {
    expect(appVersion('abc1234', false)).toBe('Version abc1234');
  });

  it('marks the dev server as a development build', () => {
    expect(appVersion('abc1234', true)).toBe('Version abc1234 (utvecklingsbygge)');
  });

  it('is nothing when the build knows no commit', () => {
    expect(appVersion(null, false)).toBeNull();
  });
});
