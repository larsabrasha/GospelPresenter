import type { Label, SongPart } from '@gp/core';
import { PILL } from './songEditorLook.ts';

// A part as an arrangement shows it (Components/SongArrangementEditor.razor): its label's coloured pill.

/** How a part is named in arrangement chips: its label, else the start of its first line (spec 02). */
export function partName(p: SongPart, labels: Map<string, Label>): string {
  const label = p.labelId ? labels.get(p.labelId) : undefined;
  if (label) return label.text;
  const line = p.content.split('\n')[0]!.trim();
  return line.length > 20 ? `${line.slice(0, 20)}...` : line;
}

export function PartPill({ part, labels }: { part: SongPart; labels: Map<string, Label> }) {
  const label = part.labelId ? labels.get(part.labelId) : undefined;
  return (
    <span className={`${PILL} ${label ? '' : 'bg-stone-400'}`} style={label ? { background: label.color } : undefined}>
      {partName(part, labels)}
    </span>
  );
}

/** An arrangement's parts as the line under a song's parts reads them: "Verse 1 · Chorus · Verse 2 · Chorus". */
export function orderLine(partIds: string[], parts: SongPart[], labels: Map<string, Label>): string {
  const byId = new Map(parts.map((p) => [p.id, p]));
  return partIds.flatMap((id) => (byId.has(id) ? [partName(byId.get(id)!, labels)] : [])).join(' · ');
}
