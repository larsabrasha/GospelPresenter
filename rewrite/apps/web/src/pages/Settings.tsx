import { useState } from 'react';
import { t, type TextKey } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { CheckIcon, ComputerIcon, MoonIcon, SunIcon } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { getTheme, setTheme, type ThemeChoice } from '../ui/theme.ts';
import { useDbStatus } from '../db/react.tsx';
import { isHostWindow } from '../hostWindow.ts';
import { setKeepComingSetting, useKeepComing } from '../ui/KeepOffline.tsx';
import { SWITCH } from '../ui/Toggle.tsx';
import { StorageSection } from './Storage.tsx';

/**
 * "Spara kommande presentationer offline" (TODO.md "Video"): this device keeps every presentation of the
 * coming seven days offline, videos too, as if each had been chosen by hand. Off at first. A desktop
 * host's own window keeps nothing, so it has no such choice; a device that keeps nothing says why.
 */
function KeepComing() {
  const on = useKeepComing();
  const status = useDbStatus();
  if (isHostWindow()) return null;
  const unavailable = !!status && status.storage !== 'opfs';
  return (
    <div className={`${CARD} p-5`}>
      <label className={`flex items-start justify-between gap-4 ${unavailable ? 'cursor-default' : 'cursor-pointer'}`}>
        <span>
          <span className="block text-sm/5 font-medium">{t('settings.keepComing')}</span>
          <span className="block text-xs text-neutral-500 dark:text-neutral-400 mt-1">{t(unavailable ? 'settings.keepComingUnavailable' : 'settings.keepComingDescription')}</span>
        </span>
        <input type="checkbox" role="switch" className={`${SWITCH} mt-0.5`} checked={on && !unavailable} disabled={unavailable} onChange={(e) => setKeepComingSetting(e.target.checked)} />
      </label>
    </div>
  );
}

const THEMES: { value: ThemeChoice; label: TextKey; icon: typeof SunIcon }[] = [
  { value: 'system', label: 'settings.themeSystem', icon: ComputerIcon },
  { value: 'light', label: 'settings.themeLight', icon: SunIcon },
  { value: 'dark', label: 'settings.themeDark', icon: MoonIcon },
];

/** "Mina inställningar" (Pages/Settings.razor): the colour theme of this device, and what it keeps offline. The version is under Om Gospel Presenter. */
export function Settings() {
  const [current, setCurrent] = useState(getTheme);
  return (
    <PageContainer>
      <PageHeader title={t('nav.settings')} />
      <div className={`${CARD} p-5`}>
        <h2 id="theme-label" className="block text-sm/5 font-medium mb-1">
          {t('settings.theme')}
        </h2>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">{t('settings.themeDescription')}</p>
        <div className="flex flex-col gap-2" role="radiogroup" aria-labelledby="theme-label">
          {THEMES.map(({ value, label, icon: Icon }) => {
            const selected = value === current;
            return (
              <AppButton
                key={value}
                variant="plain"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  setTheme(value);
                  setCurrent(value);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left cursor-pointer transition ${
                  selected ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/30 dark:border-sky-400' : 'border-neutral-300 dark:border-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-700'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span>{t(label)}</span>
                {selected && <CheckIcon className="w-5 h-5 ml-auto text-sky-500" />}
              </AppButton>
            );
          })}
        </div>
      </div>
      <KeepComing />
      <StorageSection />
    </PageContainer>
  );
}
