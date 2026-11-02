import { useState } from 'react';
import { language, setLanguage, t, type Language, type TextKey } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { CheckIcon, ChevronRightIcon, ComputerIcon, GlobeIcon, KeyIcon, MoonIcon, SunIcon } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { href } from '../ui/router.ts';
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
          <span className="block text-xs text-stone-500 dark:text-stone-400 mt-1">{t(unavailable ? 'settings.keepComingUnavailable' : 'settings.keepComingDescription')}</span>
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

const LANGUAGES: { value: Language; label: TextKey }[] = [
  { value: 'sv', label: 'settings.languageSv' },
  { value: 'en', label: 'settings.languageEn' },
];

/** One setting's options as a column of bordered rows, the chosen one sky-blue with a check (Settings.razor). */
function Choices<T extends string>({ id, title, options, current, onChoose }: { id: string; title: TextKey; options: { value: T; label: TextKey; icon: typeof SunIcon }[]; current: T; onChoose: (v: T) => void }) {
  return (
    <div className={`${CARD} p-5`}>
      <h2 id={id} className="block text-sm/5 font-medium mb-1">
        {t(title)}
      </h2>
      <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">{t('settings.themeDescription')}</p>
      <div className="flex flex-col gap-2" role="radiogroup" aria-labelledby={id}>
        {options.map(({ value, label, icon: Icon }) => {
          const selected = value === current;
          return (
            <AppButton
              key={value}
              variant="plain"
              role="radio"
              aria-checked={selected}
              onClick={() => onChoose(value)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left cursor-pointer transition ${
                selected ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/30 dark:border-sky-400' : 'border-stone-300 dark:border-stone-600 hover:bg-raised'
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
  );
}

/** Konto: the ways to sign in, which the picture's menu held before 2.0. */
function Account() {
  return (
    <div className={CARD}>
      <h2 className="px-5 pt-4 pb-1 text-sm/5 font-medium">{t('settings.account')}</h2>
      <a href={href({ page: 'logins', error: null })} className="flex items-center gap-3 px-5 py-3 no-underline text-inherit hover:bg-raised">
        <KeyIcon className="size-5 shrink-0 text-stone-400" />
        <span className="flex-1">{t('logins.title')}</span>
        <ChevronRightIcon className="size-4 text-stone-400 dark:text-stone-600" />
      </a>
    </div>
  );
}

/**
 * "Mina inställningar" (Pages/Settings.razor): the colour theme and the language of this device, and what it keeps
 * offline, and the ways to sign in. The version is under Om Gospel Presenter. A new language loads the page again in it.
 */
export function Settings() {
  const [current, setCurrent] = useState(getTheme);
  return (
    <PageContainer>
      <PageHeader title={t('nav.settings')} />
      <Choices
        id="theme-label"
        title="settings.theme"
        options={THEMES}
        current={current}
        onChoose={(v) => {
          setTheme(v);
          setCurrent(v);
        }}
      />
      <Choices id="language-label" title="settings.language" options={LANGUAGES.map((l) => ({ ...l, icon: GlobeIcon }))} current={language()} onChoose={(v) => v !== language() && setLanguage(v)} />
      <KeepComing />
      <StorageSection />
      <Account />
    </PageContainer>
  );
}
