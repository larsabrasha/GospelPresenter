// What a window of the app may be given when its page asks (the security review, 2026-11-09): Electron grants every
// request by default, the camera and microphone too. Only what the app uses; reading a device's name (a permission
// check, not a request) is not touched, so the sound outputs keep their names.

const ALLOWED: ReadonlySet<string> = new Set(['fullscreen', 'clipboard-sanitized-write', 'speaker-selection']);

export const allowsPermission = (permission: string) => ALLOWED.has(permission);
