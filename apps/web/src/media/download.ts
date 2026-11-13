import { makeZip } from '@gp/core';

// Saving library files on this device (Lars, 2026-11-04): one as itself, several as one zip, as Safari on a phone
// takes one download well and asks again for each of many.

export interface DownloadFile {
  name: string;
  data: Uint8Array;
  type: string;
}

/** Hands `blob` to the browser to save as `name`. */
export function saveBlob(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** The names in a zip made unique: a second "Bild.jpg" is "Bild (2).jpg". */
function uniqueNames(files: DownloadFile[]): DownloadFile[] {
  const seen = new Map<string, number>();
  return files.map((f) => {
    const n = (seen.get(f.name) ?? 0) + 1;
    seen.set(f.name, n);
    if (n === 1) return f;
    const dot = f.name.lastIndexOf('.');
    return { ...f, name: dot > 0 ? `${f.name.slice(0, dot)} (${n})${f.name.slice(dot)}` : `${f.name} (${n})` };
  });
}

/** One file saved as itself; several as `zipName`.zip. */
export function saveFiles(files: DownloadFile[], zipName: string) {
  if (files.length === 1) return saveBlob(files[0]!.name, new Blob([files[0]!.data as BlobPart], { type: files[0]!.type }));
  if (files.length) saveBlob(`${zipName}.zip`, new Blob([makeZip(uniqueNames(files).map((f) => ({ name: f.name, data: f.data }))) as BlobPart], { type: 'application/zip' }));
}

/** A name whose extension says what the bytes are: a picture is kept as JPEG or WebP, whatever it was imported as. */
export function nameFor(fileName: string, type: string): string {
  const ext = type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : null;
  if (!ext) return fileName;
  const dot = fileName.lastIndexOf('.');
  return `${dot > 0 ? fileName.slice(0, dot) : fileName}.${ext}`;
}
