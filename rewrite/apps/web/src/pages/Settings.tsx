import { useState } from 'react';
import { t, type TextKey } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { CheckIcon, ComputerIcon, MoonIcon, SunIcon } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { getTheme, setTheme, type ThemeChoice } from '../ui/theme.ts';

const THEMES: { value: ThemeChoice; label: TextKey; icon: typeof SunIcon }[] = [
  { value: 'system', label: 'settings.themeSystem', icon: ComputerIcon },
  { value: 'light', label: 'settings.themeLight', icon: SunIcon },
  { value: 'dark', label: 'settings.themeDark', icon: MoonIcon },
];

/** "Mina inställningar" (Pages/Settings.razor): the colour theme of this device. */
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
    </PageContainer>
  );
}
