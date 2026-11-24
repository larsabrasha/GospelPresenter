import { t, type TextKey } from "../i18n.ts";
import { AppButton } from "./AppButton.tsx";
import { GROUP_ROW } from "./Group.tsx";

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

/** A colour: one of the swatches, another of the system's picker, or none (`empty`: the theme's, or no colour; without it, always one). */
export function ColorChoice({
  label,
  value,
  empty,
  onChange,
}: {
  label: string;
  value: string | null;
  empty?: "theme" | "none";
  onChange: (c: string | null) => void;
}) {
  const dot =
    "size-8 shrink-0 rounded-full cursor-pointer ring-offset-2 ring-offset-surface dark:ring-offset-raised";
  return (
    <div
      className={`${GROUP_ROW} flex-wrap`}
      role="radiogroup"
      aria-label={label}
    >
      <span>{label}</span>
      <span className="flex flex-wrap items-center justify-end gap-2">
        {empty && (
          <AppButton
            variant="plain"
            role="radio"
            aria-checked={value === null}
            aria-label={t(
              empty === "theme" ? "slideEditor.theme" : "slideEditor.none",
            )}
            title={t(
              empty === "theme" ? "slideEditor.theme" : "slideEditor.none",
            )}
            className={`${dot} border border-separator bg-[linear-gradient(135deg,transparent_45%,#ef4444_45%,#ef4444_55%,transparent_55%)] ${value === null ? "ring-2 ring-sky-500" : ""}`}
            onClick={() => onChange(null)}
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
            onClick={() => onChange(c)}
          />
        ))}
        {/* Another colour, by the system's own picker. */}
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
  options: [V, TextKey][];
  onChange: (v: V) => void;
}) {
  return (
    <div className={GROUP_ROW} role="radiogroup" aria-label={label}>
      <span>{label}</span>
      <span className="flex rounded-full bg-raised p-0.5">
        {options.map(([v, key]) => (
          <AppButton
            key={v}
            variant="plain"
            role="radio"
            aria-checked={value === v}
            className={`h-8 px-3 rounded-full text-[13px] cursor-pointer ${value === v ? "bg-surface dark:bg-raised-2 shadow font-medium" : "text-stone-500 dark:text-stone-400"}`}
            onClick={() => onChange(v)}
          >
            {t(key)}
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
