import { useState } from 'react';
import { language, setLanguage, t, type Language, type TextKey } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { GROUP_ROW, Group, OpeningRow, PopUp, SwitchRow } from '../ui/Group.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { href } from '../ui/router.ts';
import { getTheme, setTheme, type ThemeChoice } from '../ui/theme.ts';
import { autoOutputsSetting, setAutoOutputsSetting } from '../live/autoOutputs.ts';
import { StorageRow } from './Storage.tsx';

/** Slå på utgångar automatiskt (live/autoOutputs.ts): in the desktop app only, where an output goes to a display. */
function AutoOutputs() {
  const [on, setOn] = useState(autoOutputsSetting);
  if (!window.gpDesktop) return null;
  return (
    <SwitchRow
      title={t('settings.autoOutputs')}
      description={t('settings.autoOutputsDescription')}
      checked={on}
      onChange={(v) => {
        setAutoOutputsSetting(v);
        setOn(v);
      }}
    />
  );
}

const THEMES: { value: ThemeChoice; label: TextKey }[] = [
  { value: 'system', label: 'settings.themeSystem' },
  { value: 'light', label: 'settings.themeLight' },
  { value: 'dark', label: 'settings.themeDark' },
];

const LANGUAGES: { value: Language; label: TextKey }[] = [
  { value: 'sv', label: 'settings.languageSv' },
  { value: 'en', label: 'settings.languageEn' },
];

/** A small window in a theme's colours: a bar, a sidebar and two lines of text. */
function WindowPicture({ dark }: { dark: boolean }) {
  const [ground, bar, line] = dark ? ['bg-stone-800', 'bg-stone-700', 'bg-stone-500'] : ['bg-stone-50', 'bg-stone-200', 'bg-stone-300'];
  return (
    <span className={`absolute inset-0 flex flex-col ${ground}`}>
      <span className={`h-2.5 shrink-0 ${bar}`} />
      <span className="flex-1 flex">
        <span className={`w-1/4 ${bar}`} />
        <span className="flex-1 p-2 space-y-1.5">
          <span className={`block h-1 w-3/4 rounded-full ${line}`} />
          <span className={`block h-1 w-1/2 rounded-full ${line}`} />
        </span>
      </span>
    </span>
  );
}

/**
 * Färgtema as macOS's Appearance and iOS's Display & Brightness show it: a small picture of each, side by side, the
 * chosen one ringed in sky; System half light, half dark.
 */
function ThemePicker() {
  const [current, setCurrent] = useState(getTheme);
  return (
    <div role="radiogroup" aria-label={t('settings.theme')} className="flex justify-around gap-2 px-4 py-4">
      {THEMES.map(({ value, label }) => {
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
            className="flex flex-col items-center gap-2 cursor-pointer group"
          >
            <span
              className={`relative block w-20 h-13 rounded-lg overflow-hidden border border-stone-300 dark:border-stone-600 ring-offset-2 ring-offset-surface ${selected ? 'ring-2 ring-sky-500' : 'group-hover:ring-2 group-hover:ring-stone-300 dark:group-hover:ring-stone-600'}`}
            >
              <WindowPicture dark={value === 'dark'} />
              {value === 'system' && (
                <span className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">
                  <WindowPicture dark />
                </span>
              )}
            </span>
            <span className={`text-xs ${selected ? 'font-semibold text-sky-600 dark:text-sky-400' : 'text-stone-600 dark:text-stone-300'}`}>{t(label)}</span>
          </AppButton>
        );
      })}
    </div>
  );
}

/** Språk as a row with a pop-up menu, as macOS's: two languages need no more. A new language loads the page again. */
function LanguageRow() {
  return (
    <label className={GROUP_ROW}>
      <span>{t('settings.language')}</span>
      <PopUp value={language()} onChange={(e) => e.target.value !== language() && setLanguage(e.target.value as Language)}>
        {LANGUAGES.map(({ value, label }) => (
          <option key={value} value={value}>
            {t(label)}
          </option>
        ))}
      </PopUp>
    </label>
  );
}

/** Konto: the ways to sign in, which the picture's menu held before 2.0. */
function Account() {
  return (
    <Group title={t('settings.account')}>
      <OpeningRow label={t('logins.title')} href={href({ page: 'logins', error: null })} />
    </Group>
  );
}

/**
 * "Mina inställningar" (Pages/Settings.razor), as grouped rows (ui/Group.tsx): the colour theme and the language of
 * this device, its storage (a page of its own) and what it does with its displays, and the ways to sign in. The version is
 * under Om Gospel Presenter.
 */
export function Settings() {
  return (
    <PageContainer>
      <PageHeader title={t('nav.settings')} />
      <div className="space-y-6">
        <Group title={t('settings.theme')}>
          <ThemePicker />
        </Group>
        <Group footer={t('settings.themeDescription')}>
          <LanguageRow />
        </Group>
        <DeviceGroup />
        <Account />
      </div>
    </PageContainer>
  );
}

/** Den här enheten: Lagring, a page of its own as iOS's iPhone-lagring (Lars, 2026-11-03), and in the desktop app its switch. */
function DeviceGroup() {
  return (
    <Group title={t('settings.thisDevice')}>
      <StorageRow />
      <AutoOutputs />
    </Group>
  );
}
