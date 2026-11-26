import { type Background, type TextStyle, THEME_LIMITS, type ThemeDefinition } from '@gp/core';
import { t, type TextKey } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { AutoSaveField } from '../../ui/AutoSave.tsx';
import { ColorChoice, PLACE_CHOICES, Segments, Slider } from '../../ui/FormatControls.tsx';
import { ACTION_ROW, Group } from '../../ui/Group.tsx';
import { FormatTabs } from '../custom-slides/EditorChrome.tsx';
import { TextFormat, type TextLook } from '../custom-slides/TextFormat.tsx';
import { backgroundIn, defaultArea, joinColor, splitColor, type EditedKind, type TextRole } from './themeModel.ts';

// The theme editor's Format (docs/themes.md), as the slideshows' editor's: the slide's parts as tabs at the top
// (Bakgrund | Text | Källa; Lars 2026-11-26), following what is picked on the slide, so what can be changed is in view
// and not to be guessed by tapping; under them the picked part's look and place, or the kind's background; and the
// theme's name only just after it was made.

const KIND_TEXT: Record<EditedKind, TextKey> = { song: 'themeEditor.song', bible: 'themeEditor.bible', media: 'themeEditor.media' };

/** The theme's text as the Text panel shows it: its colour and opacity, which the theme keeps in one CSS colour, apart. */
function lookOf(style: TextStyle): TextLook {
  const { hex, alpha } = splitColor(style.color);
  return {
    font: style.fontFamily,
    size: style.fontSize,
    weight: style.fontWeight,
    italic: !!style.italic,
    lineHeight: style.lineHeight,
    align: style.align,
    color: hex,
    opacity: alpha,
    uppercase: style.uppercase,
    shadow: style.shadow,
    outline: style.outline,
    outlineColor: splitColor(style.outlineColor).hex,
  };
}

/** A change in the Text panel as the theme keeps it. */
function styleOf(look: TextLook, patch: Partial<TextLook>): Partial<TextStyle> {
  const { font, size, weight, color, opacity, ...same } = patch;
  return {
    ...same,
    ...(font ? { fontFamily: font } : {}),
    ...(size !== undefined ? { fontSize: size } : {}),
    ...(weight !== undefined ? { fontWeight: weight } : {}),
    ...(color !== undefined || opacity !== undefined ? { color: joinColor(color ?? look.color ?? '#ffffff', opacity ?? look.opacity) } : {}),
  };
}

function TextPanel({ kind, role, style, onText }: { kind: 'song' | 'bible'; role: TextRole; style: TextStyle; onText: (key: string, patch: Partial<TextStyle>) => void }) {
  const look = lookOf(style);
  return (
    <div className="space-y-5" data-testid="theme-text-panel">
      <TextFormat
        title={t(role === 'main' ? 'themeEditor.mainText' : 'themeEditor.credits')}
        look={look}
        placement={<Segments label={t('themeEditor.placement')} value={style.valign} options={PLACE_CHOICES} onChange={(valign) => onText('valign', { valign })} />}
        onChange={(key, patch) => onText(key, styleOf(look, patch))}
      />
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
  onPick,
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
  onPick: (role: TextRole | null) => void;
}) {
  const parts = kind !== 'media' && <PartTabs picked={picked} onPick={onPick} />;
  if (picked && kind !== 'media')
    return (
      <div className="space-y-5">
        {parts}
        <TextPanel key={`${kind}:${picked}`} kind={kind} role={picked} style={definition[kind][picked]} onText={onText} />
      </div>
    );
  return (
    <div className="space-y-5" data-testid="theme-inspector">
      {/* Bare, as the slide editor's: the card is its box, which cut a box of its own and its focus ring. */}
      {nameNew && (
        <Group>
          <AutoSaveField bare autoSelect label={t('song.name')} maxChars={THEME_LIMITS.name} value={name} onSave={(v) => (v.trim() ? onRename(v) : undefined)} onSaved={onSaved} />
        </Group>
      )}
      {parts}
      <BackgroundPanel kind={kind} background={backgroundIn(definition, kind)} onBackground={onBackground} onChoosePicture={onChoosePicture} />
    </div>
  );
}

type Part = TextRole | 'background';

const PARTS: [Part, TextKey][] = [
  ['background', 'slideEditor.background'],
  ['main', 'themeEditor.mainText'],
  ['credits', 'themeEditor.credits'],
];

/** The slide's parts as Format's tabs (Lars, 2026-11-26), following what is picked on the slide. */
function PartTabs({ picked, onPick }: { picked: TextRole | null; onPick: (role: TextRole | null) => void }) {
  return <FormatTabs label={t('themeEditor.change')} tabs={PARTS} value={picked ?? 'background'} onChange={(p) => onPick(p === 'background' ? null : p)} />;
}
