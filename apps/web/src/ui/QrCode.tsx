import { encode } from 'uqr';

// QR codes for links (spec 04 §7, §8, §9): drawn here from the link, so no
// service ever sees one. Error correction M, as the current app uses.

function modules(value: string): boolean[][] {
  return encode(value, { ecc: 'M', border: 2 }).data;
}

/** A QR code of `value`, as SVG: one path of dark squares on white. */
export function QrCode({ value, label, size = 200 }: { value: string; label: string; size?: number }) {
  const grid = modules(value);
  let d = '';
  grid.forEach((row, y) => row.forEach((dark, x) => dark && (d += `M${x} ${y}h1v1h-1z`)));
  return (
    <svg className="qr block bg-white rounded-sm" role="img" aria-label={label} data-value={value} viewBox={`0 0 ${grid.length} ${grid.length}`} width={size} height={size} shapeRendering="crispEdges">
      <rect width={grid.length} height={grid.length} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

/** Saves a QR code of `value` as a PNG, 24 pixels per module ("Ladda ner som bild", spec 04 §7). */
export function downloadQr(value: string, fileName: string) {
  const grid = modules(value);
  const scale = 24;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = grid.length * scale;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#000';
  grid.forEach((row, y) => row.forEach((dark, x) => dark && g.fillRect(x * scale, y * scale, scale, scale)));
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
}
