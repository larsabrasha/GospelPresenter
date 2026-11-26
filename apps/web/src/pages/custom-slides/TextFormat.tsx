import type { ReactNode } from 'react';
import { FONT_STACKS } from '@gp/core';
import { locale, t } from '../../i18n.ts';
import { ALIGN_CHOICES, ColorChoice, OnOff, Segments, Slider } from '../../ui/FormatControls.tsx';
import { GROUP_ROW, Group, PopUp } from '../../ui/Group.tsx';

// One Text panel for a theme's texts and a slideshow's or an overlay's (Lars, 2026-11-26: the overlay's had fewer
// choices than the theme's, for no reason one could see). Each editor gives the look as this panel has it, and takes
// the changes back in its own form.

type Align = 'left' | 'center' | 'right';

/** A text's look as the panel shows it. `font` and `color` null: the theme's (a slide's text only). */
export interface TextLook {
  font: string | null;
  size: number;
  weight: number;
  italic: boolean;
  lineHeight: number;
  align: Align;
  color: string | null;
  /** Per cent. */
  opacity: number;
  uppercase: boolean;
  shadow: boolean;
  outline: number;
  outlineColor: string;
}

const FONTS: [string, string][] = [
  [FONT_STACKS.tahoma, 'Tahoma'],
  [FONT_STACKS.inter, 'Inter'],
  [FONT_STACKS.lato, 'Lato'],
  [FONT_STACKS.montserrat, 'Montserrat'],
];

/**
 * A size on the 1920×1080 slide, from a line of credits to a heading, by a slider, so the text grows on the slide as
 * it is pulled (Lars, 2026-11-26: a slider to 400 made sizes no slide wants easy to land on; a menu showed nothing).
 */
const MIN_SIZE = 20;
const MAX_SIZE = 240;

/** A weight as one of the three choices. */
const weightChoice = (weight: number) => String(weight >= 700 ? 700 : weight >= 500 ? 600 : 400);

export function TextFormat({
  title,
  look,
  followsTheme = false,
  placement,
  onChange,
}: {
  title?: string;
  look: TextLook;
  /** A slide's text: its font and colour may be the theme's. */
  followsTheme?: boolean;
  /** A row under Justering: a theme's text's place in its box. */
  placement?: ReactNode;
  /** `key` names what changed, so a slider pulled is one step for Ångra. */
  onChange: (key: string, patch: Partial<TextLook>) => void;
}) {
  // A font the menu does not name (a terminal's) is shown as the first.
  const font = look.font === null ? '' : (FONTS.find(([stack]) => stack === look.font)?.[0] ?? FONTS[0]![0]);
  return (
    <>
      <Group title={title}>
        <div className={GROUP_ROW}>
          <span>{t('themeEditor.font')}</span>
          <PopUp aria-label={t('themeEditor.font')} value={font} onChange={(e) => onChange('font', { font: e.target.value || null })}>
            {followsTheme && <option value="">{t('slideEditor.theme')}</option>}
            {FONTS.map(([stack, name]) => (
              <option key={name} value={stack}>
                {name}
              </option>
            ))}
          </PopUp>
        </div>
        {/* A larger size of before shows its own number, the slider at its end, until it is pulled. */}
        <Slider label={t('slideEditor.size')} value={Math.min(look.size, MAX_SIZE)} min={MIN_SIZE} max={MAX_SIZE} shown={String(look.size)} onChange={(size) => onChange('size', { size })} />
        <Segments
          label={t('themeEditor.weight')}
          value={weightChoice(look.weight)}
          options={[
            ['400', 'themeEditor.regular'],
            ['600', 'themeEditor.semibold'],
            ['700', 'slideEditor.bold'],
          ]}
          onChange={(w) => onChange('weight', { weight: Number(w) })}
        />
        <Slider
          label={t('themeEditor.lineHeight')}
          value={Math.round(look.lineHeight * 10)}
          min={8}
          max={25}
          shown={look.lineHeight.toLocaleString(locale(), { minimumFractionDigits: 1 })}
          onChange={(n) => onChange('lineHeight', { lineHeight: n / 10 })}
        />
        <Segments label={t('slideEditor.align')} value={look.align} options={ALIGN_CHOICES} onChange={(align) => onChange('align', { align })} />
        {placement}
        <ColorChoice label={t('slideEditor.color')} value={look.color} empty={followsTheme ? 'theme' : undefined} onChange={(color) => onChange('color', { color })} />
        <Slider label={t('themeEditor.opacity')} value={look.opacity} min={10} max={100} onChange={(opacity) => onChange('opacity', { opacity })} />
      </Group>
      <Group>
        <div className={GROUP_ROW}>
          <span>{t('slideEditor.style')}</span>
          <span className="flex gap-2">
            <OnOff label={t('slideEditor.italic')} on={look.italic} onChange={(italic) => onChange('italic', { italic })} />
            <OnOff label={t('themeEditor.uppercase')} on={look.uppercase} onChange={(uppercase) => onChange('uppercase', { uppercase })} />
            <OnOff label={t('themeEditor.shadow')} on={look.shadow} onChange={(shadow) => onChange('shadow', { shadow })} />
          </span>
        </div>
        <Slider label={t('themeEditor.outline')} value={look.outline} min={0} max={10} onChange={(outline) => onChange('outline', { outline })} />
        {look.outline > 0 && <ColorChoice label={t('themeEditor.outlineColor')} value={look.outlineColor} onChange={(c) => onChange('outlineColor', { outlineColor: c ?? '#000000' })} />}
      </Group>
    </>
  );
}
