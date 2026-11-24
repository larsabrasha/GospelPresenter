import { locale } from '../i18n.ts';

/** Bytes as a Swede reads them: "1,2 GB", "350 MB", "12 kB". */
export function formatBytes(bytes: number): string {
  const units: [number, string][] = [
    [1e9, 'GB'],
    [1e6, 'MB'],
    [1e3, 'kB'],
  ];
  for (const [size, unit] of units) {
    if (bytes >= size) {
      const n = bytes / size;
      return `${n.toLocaleString(locale(), { maximumFractionDigits: n < 10 ? 1 : 0 })} ${unit}`;
    }
  }
  return `${bytes} B`;
}
