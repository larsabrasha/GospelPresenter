import { useEffect, useState, useSyncExternalStore } from 'react';
import { t } from '../../i18n.ts';
import { onSoundOutput, setSoundOutput, soundDevices, soundOutput, type SoundDevice } from '../../live/soundOutput.ts';
import { ChevronUpDownIcon, SpeakerOutlineIcon } from '../../ui/icons.tsx';

/**
 * Ljud under Utgångar (live/soundOutput.ts): where the presentation's sound goes, the computer's own output or a device
 * the operating system names, as an Apple TV used as a display through AirPlay (Lars, 2026-11-07). A row of the group's
 * card with the choice in grey at its right and ⌃⌄, the whole row opening the system's menu, as the phone's item
 * sheet has its choices. Only where the devices can be named and chosen (the desktop app), with more than one.
 */
export function SoundOutputRow() {
  const [devices, setDevices] = useState<SoundDevice[]>([]);
  const chosen = useSyncExternalStore(onSoundOutput, soundOutput);
  useEffect(() => {
    let live = true;
    const read = () => void soundDevices().then((d) => live && setDevices(d));
    read();
    // An AirPlay display or headphones connected later appear without a reload.
    navigator.mediaDevices?.addEventListener?.('devicechange', read);
    return () => {
      live = false;
      navigator.mediaDevices?.removeEventListener?.('devicechange', read);
    };
  }, []);
  if (devices.length < 2) return null;
  const name = devices.find((d) => d.id === chosen)?.name ?? t('live.soundSystem');
  return (
    <label className="relative min-h-11 py-1.5 px-3 flex items-center justify-between gap-2 text-sm text-stone-700 dark:text-stone-200 cursor-pointer">
      <span className="flex items-center gap-2 shrink-0">
        <SpeakerOutlineIcon className="size-4 shrink-0 text-stone-500 dark:text-stone-400" />
        {t('live.sound')}
      </span>
      <span className="flex items-center gap-1 min-w-0 text-stone-500 dark:text-stone-400">
        <span className="truncate">{name}</span>
        <ChevronUpDownIcon className="size-4 shrink-0" />
      </span>
      {/* The system's menu, unseen over the whole row. */}
      <select aria-label={t('live.sound')} value={devices.some((d) => d.id === chosen) ? chosen : ''} onChange={(e) => setSoundOutput(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer">
        <option value="">{t('live.soundSystem')}</option>
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </label>
  );
}
