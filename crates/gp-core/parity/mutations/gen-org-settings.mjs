// Random inputs for org-settings.ts's setRemoteControl.
export function generator({ mostly }) {
  return { name: 'setRemoteControl', args: { policy: mostly(['never', 'presenter', 'always'], ['sometimes', 'Always', null, undefined]) } };
}
