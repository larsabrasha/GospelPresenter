import { describe, expect, it } from 'vitest';
import { allowsPermission } from '../src/permissions.ts';

describe("the permissions the app's windows may have", () => {
  it('grants what the app uses: full screen, writing to the clipboard, choosing the speaker', () => {
    expect(['fullscreen', 'clipboard-sanitized-write', 'speaker-selection'].map(allowsPermission)).toEqual([true, true, true]);
  });

  it('refuses the rest, the camera and microphone, the location and notifications among them', () => {
    expect(['media', 'geolocation', 'notifications', 'midi', 'openExternal', 'display-capture'].map(allowsPermission)).toEqual([false, false, false, false, false, false]);
  });
});
