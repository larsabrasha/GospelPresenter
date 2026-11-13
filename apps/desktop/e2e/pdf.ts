/**
 * A PDF made in memory (no file in the repository): `pages` pages of 960×540
 * points, a PowerPoint slide's size, each filled with one colour, so a page
 * rendered at 1920×1080 can be told from its neighbours.
 */
export function colouredPdf(pages: number): Buffer {
  const objects: string[] = [];
  const pageIds: number[] = [];
  // 1: catalog, 2: page tree; then a page and its content stream for each page.
  for (let i = 0; i < pages; i++) {
    const pageId = 3 + i * 2;
    pageIds.push(pageId);
    const [r, g, b] = [((i * 70) % 256) / 255, ((i * 130 + 60) % 256) / 255, ((i * 30 + 120) % 256) / 255];
    const stream = `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg 0 0 960 540 re f`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages} >>`;

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out);
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
