import { FONT_STACKS, type Background, type TextStyle, type ThemeDefinition } from '@gp/core';
import { locale, t, type TextKey } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { AutoSaveField } from '../../ui/AutoSave.tsx';
import { ColorChoice, OnOff, Segments, Slider } from '../../ui/FormatControls.tsx';
import { ACTION_ROW, GROUP_ROW, Group } from '../../ui/Group.tsx';
import { backgroundIn, defaultArea, joinColor, splitColor, type EditedKind, type TextRole } from './themeModel.ts';

// The theme editor's Format (docs/themes.md), as the slideshows' editor's: with the main text or the credits picked,
// their look and where they sit; with none, the theme's name and the kind's background.

const FONTS: [string, string][] = [
  [FONT_STACKS.tahoma, 'Tahoma'],
  [FONT_STACKS.inter, 'Inter'],
  [FONT_STACKS.lato, 'Lato'],
  [FONT_STACKS.montserrat, 'Montserrat'],
];

const KIND_TEXT: Record<EditedKind, TextKey> = { song: 'themeEditor.song', bible: 'themeEditor.bible', media: 'themeEditor.media' };

/** A colour and how opaque it is, as two rows: the theme keeps both in one CSS colour. */
function ColorWithOpacity({ label, value, onChange }: { label: string; value: string; onChange: (css: string) => void }) {
  const { hex, alpha } = splitColor(value);
  return (
    <>
      <ColorChoice label={label} value={hex} onChange={(c) => onChange(joinColor(c ?? hex, alpha))} />
      <Slider label={t('themeEditor.opacity')} value={alpha} min={10} max={100} onChange={(a) => onChange(joinColor(hex, a))} />
    </>
  );
}

function TextPanel({ kind, role, style, onText }: { kind: 'song' | 'bible'; role: TextRole; style: TextStyle; onText: (key: string, patch: Partial<TextStyle>) => void }) {
  const font = FONTS.find(([stack]) => stack === style.fontFamily)?.[0] ?? FONTS[0]![0];
  return (
    <div className="space-y-5" data-testid="theme-text-panel">
      <Group title={t(role === 'main' ? 'themeEditor.mainText' : 'themeEditor.credits')}>
        <label className={GROUP_ROW}>
          <span>{t('themeEditor.font')}</span>
          <select className="bg-transparent text-right text-stone-500 dark:text-stone-400 cursor-pointer outline-none" value={font} onChange={(e) => onText('fontFamily', { fontFamily: e.target.value })}>
            {FONTS.map(([stack, name]) => (
              <option key={name} value={stack}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <Slider label={t('slideEditor.size')} value={style.fontSize} min={20} max={role === 'main' ? 200 : 100} onChange={(fontSize) => onText('fontSize', { fontSize })} />
        <Segments
          label={t('themeEditor.weight')}
          value={String(style.fontWeight >= 700 ? 700 : style.fontWeight >= 500 ? 600 : 400)}
          options={[
            ['400', 'themeEditor.regular'],
            ['600', 'themeEditor.semibold'],
            ['700', 'slideEditor.bold'],
          ]}
          onChange={(w) => onText('fontWeight', { fontWeight: Number(w) })}
        />
        <Slider label={t('themeEditor.lineHeight')} value={Math.round(style.lineHeight * 10)} min={8} max={25} shown={style.lineHeight.toLocaleString(locale(), { minimumFractionDigits: 1 })} onChange={(n) => onText('lineHeight', { lineHeight: n / 10 })} />
        <Segments label={t('slideEditor.align')} value={style.align} options={[['left', 'slideEditor.left'], ['center', 'slideEditor.center'], ['right', 'slideEditor.right']]} onChange={(align) => onText('align', { align })} />
        <Segments label={t('themeEditor.placement')} value={style.valign} options={[['top', 'themeEditor.top'], ['middle', 'themeEditor.middle'], ['bottom', 'themeEditor.bottom']]} onChange={(valign) => onText('valign', { valign })} />
        <ColorWithOpacity label={t('slideEditor.color')} value={style.color} onChange={(color) => onText('color', { color })} />
      </Group>
      <Group>
        <div className={GROUP_ROW}>
          <span>{t('slideEditor.style')}</span>
          <span className="flex gap-2">
            <OnOff label={t('themeEditor.uppercase')} on={style.uppercase} onChange={(uppercase) => onText('uppercase', { uppercase })} />
            <OnOff label={t('themeEditor.shadow')} on={style.shadow} onChange={(shadow) => onText('shadow', { shadow })} />
          </span>
        </div>
        <Slider label={t('themeEditor.outline')} value={style.outline} min={0} max={10} onChange={(outline) => onText('outline', { outline })} />
        {style.outline > 0 && <ColorChoice label={t('themeEditor.outlineColor')} value={splitColor(style.outlineColor).hex} onChange={(c) => onText('outlineColor', { outlineColor: c ?? '#000000' })} />}
      </Group>
      <Group>
        <AppButton variant="plain" className={ACTION_ROW} onClick={() => onText('', { area: defaultArea(kind, role), valign: role === 'main' ? 'middle' : 'bottom' })}>
          {t('themeEditor.resetPlacement')}
        </AppButton>
      </Group>
    </div>
  );
}

function BackgroundPanel({ kind, background, onBackground, onChoosePicture }: { kind: EditedKind; background: Background; onBackground: (key: string, patch: Partial<Background>) => void; onChoosePicture: () => void }) {
  return (
    <Group title={t('themeEditor.backgroundOf', { kind: t(KIND_TEXT[kind]).toLowerCase() })}>
      <ColorChoice label={t('slideEditor.color')} value={splitColor(background.color).hex} onChange={(c) => onBackground('color', { color: c ?? '#000000' })} />
      <AppButton variant="plain" className={ACTION_ROW} onClick={onChoosePicture}>
        {t(background.image ? 'slideEditor.replaceBackground' : 'slideEditor.backgroundImage')}
      </AppButton>
      {background.image && (
        <>
          <Segments label={t('slideEditor.fit')} value={background.fit} options={[['cover', 'slideEditor.cover'], ['contain', 'slideEditor.contain']]} onChange={(fit) => onBackground('fit', { fit })} />
          <Slider label={t('themeEditor.scrim')} value={background.scrim} min={0} max={90} onChange={(scrim) => onBackground('scrim', { scrim })} />
          <AppButton variant="plain" className={ACTION_ROW} onClick={() => onBackground('', { image: null })}>
            {t('slideEditor.removeBackground')}
          </AppButton>
        </>
      )}
    </Group>
  );
}

export function ThemeInspector({
  name,
  nameNew,
  definition,
  kind,
  picked,
  onRename,
  onSaved,
  onText,
  onBackground,
  onChoosePicture,
}: {
  name: string;
  /** Just made: the name is focused and picked, to type over. */
  nameNew?: boolean;
  definition: ThemeDefinition;
  kind: EditedKind;
  picked: TextRole | null;
  onRename: (name: string) => Promise<unknown>;
  onSaved: () => void;
  onText: (key: string, patch: Partial<TextStyle>) => void;
  onBackground: (key: string, patch: Partial<Background>) => void;
  onChoosePicture: () => void;
}) {
  if (picked && kind !== 'media') return <TextPanel key={`${kind}:${picked}`} kind={kind} role={picked} style={definition[kind][picked]} onText={onText} />;
  return (
    <div className="space-y-5" data-testid="theme-inspector">
      <Group>
        <AutoSaveField autoSelect={nameNew} label={t('song.name')} maxLength={100} value={name} onSave={(v) => (v.trim() ? onRename(v) : undefined)} onSaved={onSaved} />
      </Group>
      <BackgroundPanel kind={kind} background={backgroundIn(definition, kind)} onBackground={onBackground} onChoosePicture={onChoosePicture} />
      {kind !== 'media' && <p className="px-4 text-[13px] text-stone-500 dark:text-stone-400">{t('themeEditor.pickHint')}</p>}
    </div>
  );
}
