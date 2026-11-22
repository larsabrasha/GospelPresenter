// syncStatusView (wave 2), every combination of its arguments, and some that are not what they should be.
export function cases() {
  const out = [];
  for (const pending of [0, 1, 3, -1, 1.5, 'x'])
    for (const stopped of [null, 'update-required', 'unauthenticated', 'device-not-paired', 'not-a-member', 7])
      for (const connected of [true, false, 'yes'])
        for (const busy of [true, false]) for (const waitedLong of [true, false, undefined]) out.push({ name: 'syncStatusView', pure: true, args: { pending, stopped, connected, busy, waitedLong } });
  out.push({ name: 'syncStatusView', pure: true, args: {} });
  return out;
}
