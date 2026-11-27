import { useState, type ReactNode } from "react";
import { t, type TextKey } from "../i18n.ts";
import { AppButton } from "./AppButton.tsx";
import { GROUP_ROW } from "./Group.tsx";
import { ChevronDownIcon, TextAlignIcon, TextPlaceIcon } from "./icons.tsx";

// The rows of a Format panel, as Keynote's (docs/custom-slides.md, docs/themes.md): a colour, a number on a slider,
// choices side by side, and a word that is on or off. The slideshows' editor and the themes' share them.

const SWATCHES = [
  "#ffffff",
  "#000000",
  "#6b7280",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

/**
 * A colour: one of the swatches, another of the system's picker, or none (`empty`: the theme's, or no colour; without it,
 * always one). Folded to the chosen colour's swatch with ⌄, the swatches under the row once it is pressed and folded
 * again by a choice (Lars, 2026-11-26: all of them in view took the panel's room), as a colour well in Keynote's Format.
 */
export function ColorChoice({
  label,
  value,
  empty,
  onChange,
}: {
  label: string;
  value: string | null;
  /** What no colour is: the theme's, none, or a picture's own colours. */
  empty?: "theme" | "none" | "picture";
  onChange: (c: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const dot =
    "size-8 shrink-0 rounded-full cursor-pointer ring-offset-2 ring-offset-surface dark:ring-offset-raised";
  const emptyLook =
    "bg-[linear-gradient(135deg,transparent_45%,#ef4444_45%,#ef4444_55%,transparent_55%)]";
  const emptyName = empty && t(empty === "theme" ? "slideEditor.theme" : empty === "picture" ? "slideEditor.pictureColors" : "slideEditor.none");
  const choose = (c: string | null) => {
    onChange(c);
    setOpen(false);
  };
  return (
    <div className={`${GROUP_ROW} flex-wrap`}>
      <span>{label}</span>
      <AppButton
        variant="plain"
        aria-expanded={open}
        aria-label={`${label}: ${value ?? emptyName ?? ""}`}
        className="flex items-center gap-1.5 cursor-pointer"
        onClick={() => setOpen((o) => !o)}
      >
        <span
          className={`size-7 rounded-full border border-separator ${value === null ? emptyLook : ""}`}
          style={value === null ? undefined : { background: value }}
        />
        <ChevronDownIcon className={`size-4 text-stone-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </AppButton>
      {open && (
        <span className="basis-full flex flex-wrap items-center justify-end gap-2 pt-2" role="radiogroup" aria-label={label}>
          {empty && (
            <AppButton
              variant="plain"
              role="radio"
              aria-checked={value === null}
              aria-label={emptyName}
              title={emptyName}
              className={`${dot} border border-separator ${emptyLook} ${value === null ? "ring-2 ring-sky-500" : ""}`}
              onClick={() => choose(null)}
            />
          )}
          {SWATCHES.map((c) => (
            <AppButton
              key={c}
              variant="plain"
              role="radio"
              aria-checked={value === c}
              aria-label={c}
              className={`${dot} border border-separator ${value === c ? "ring-2 ring-sky-500" : ""}`}
              style={{ background: c }}
              onClick={() => choose(c)}
            />
          ))}
          {/* Another colour, by the system's own picker: left open, as its colour is dragged there. */}
          <label
            className={`${dot} relative overflow-hidden border border-separator bg-[conic-gradient(#ef4444,#eab308,#22c55e,#3b82f6,#8b5cf6,#ef4444)] has-focus-visible:outline-2 has-focus-visible:outline-solid has-focus-visible:outline-sky-500 has-focus-visible:outline-offset-2 ${value && !SWATCHES.includes(value) ? "ring-2 ring-sky-500" : ""}`}
            title={t("slideEditor.otherColor")}
          >
            <input
              type="color"
              aria-label={t("slideEditor.otherColor")}
              className="absolute inset-0 opacity-0 cursor-pointer"
              value={value ?? "#ffffff"}
              onChange={(e) => onChange(e.target.value)}
            />
          </label>
        </span>
      )}
    </div>
  );
}

/** A number on a slider, with its value beside it (`shown` writes it otherwise, a line spacing of 14 as 1,4). */
export function Slider({
  label,
  value,
  min,
  max,
  shown,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  shown?: string;
  onChange: (n: number) => void;
}) {
  return (
    <label className={GROUP_ROW}>
      <span className="flex-1 min-w-0">{label}</span>
      {/* One width for every slider, at the right as the other controls, whatever its label's length. */}
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        className="w-32 shrink-0 accent-sky-500"
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="w-10 text-right tabular-nums text-stone-500 dark:text-stone-400">
        {shown ?? value}
      </span>
    </label>
  );
}

/** Choices side by side, one of them chosen (Vänster, Mitten, Höger). */
export function Segments<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  /** Each choice's value, its name, and a symbol drawn in the name's place (the name then its tooltip), as Keynote's. */
  options: [V, TextKey, ReactNode?][];
  onChange: (v: V) => void;
}) {
  return (
    <div className={GROUP_ROW} role="radiogroup" aria-label={label}>
      <span>{label}</span>
      <span className="flex rounded-full bg-raised p-0.5">
        {options.map(([v, key, icon]) => (
          <AppButton
            key={v}
            variant="plain"
            role="radio"
            aria-checked={value === v}
            aria-label={icon ? t(key) : undefined}
            title={icon ? t(key) : undefined}
            className={`h-8 ${icon ? 'w-10 flex items-center justify-center' : 'px-3'} rounded-full text-[13px] cursor-pointer ${value === v ? "bg-surface dark:bg-raised-2 shadow font-medium" : "text-stone-500 dark:text-stone-400"}`}
            onClick={() => onChange(v)}
          >
            {icon ?? t(key)}
          </AppButton>
        ))}
      </span>
    </div>
  );
}

/** A switch as a word that is on or off (Fet, Kursiv). */
export function OnOff({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <AppButton
      variant="plain"
      role="switch"
      aria-checked={on}
      className={`h-8 px-3 rounded-full text-[13px] cursor-pointer ${on ? "bg-sky-500 text-white" : "bg-raised text-stone-600 dark:text-stone-300"}`}
      onClick={() => onChange(!on)}
    >
      {label}
    </AppButton>
  );
}

/** Justering's choices, each drawn as its symbol (Lars, 2026-11-26: as Keynote's). */
export const ALIGN_CHOICES: ["left" | "center" | "right", TextKey, ReactNode][] = [
  ["left", "slideEditor.left", <TextAlignIcon key="left" align="left" className="size-4" />],
  ["center", "slideEditor.center", <TextAlignIcon key="center" align="center" className="size-4" />],
  ["right", "slideEditor.right", <TextAlignIcon key="right" align="right" className="size-4" />],
];

/** Placering's choices: the text at the top, the middle or the foot of its box, each drawn as its symbol. */
export const PLACE_CHOICES: ["top" | "middle" | "bottom", TextKey, ReactNode][] = [
  ["top", "themeEditor.top", <TextPlaceIcon key="top" place="top" className="size-4" />],
  ["middle", "themeEditor.middle", <TextPlaceIcon key="middle" place="middle" className="size-4" />],
  ["bottom", "themeEditor.bottom", <TextPlaceIcon key="bottom" place="bottom" className="size-4" />],
];
