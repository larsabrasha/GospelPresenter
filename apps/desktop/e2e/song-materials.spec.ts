// Sheet music, recordings and links on a song (spec 02 "Song material"): added on the song's page, gathered for the
// band under a presentation, and a PDF opened in the app's viewer, on the host and on another computer, which
// fetches it when it is opened.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, openAdmin, openMaterials, pair, setUpHost, createUser } from './flows.ts';

let host: Desktop | undefined;
let second: Desktop | undefined;
test.afterEach(async () => {
  await second?.app.close();
  await host?.app.close();
  host = undefined;
  second = undefined;
});

/** A PDF of one empty page that pdf.js reads: three objects and a cross-reference table with their offsets. */
function onePagePdf(): Buffer {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 280] >>'];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [i, o] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

test('a song carries sheet music and links; the presentation gathers them for the band, and a PDF opens in the app', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Sång A', [['Verse 1', 'A ett']]);

  // On the song's page: a PDF, named by its file, and a link, named by where it points.
  await openMaterials(page);
  await page.getByTestId('song-file').setInputFiles({ name: 'Piano.pdf', mimeType: 'application/pdf', buffer: onePagePdf() });
  const list = page.getByRole('list', { name: 'Noter och länkar' });
  await expect(list.getByRole('button', { name: /^Piano/ })).toContainText('PDF');
  await page.getByRole('button', { name: 'Lägg till länk' }).click();
  const linkDialog = page.getByRole('dialog', { name: 'Lägg till länk' });
  await linkDialog.getByLabel('Adress').fill('https://open.spotify.com/track/abc');
  await linkDialog.getByRole('button', { name: 'Lägg till länk' }).click();
  await expect(list.getByRole('link', { name: /Spotify/ })).toHaveAttribute('href', 'https://open.spotify.com/track/abc');

  // A presentation gathers its songs' material, in the running order.
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A']);
  await page.getByTestId('presentation-bar').getByRole('button', { name: 'Alternativ' }).click();
  await page.getByRole('menuitem', { name: 'Noter och länkar' }).click();
  const gathered = page.getByTestId('presentation-materials');
  const song = gathered.getByRole('region', { name: 'Sång A' });
  await expect(song.getByRole('link', { name: /Spotify/ })).toBeVisible();
  await expect(song.getByRole('button', { name: /Options|Alternativ/ })).toHaveCount(0); // read only here

  // The PDF opens in the viewer, drawn by pdf.js; Ladda ner saves it by its name; the desktop app has no browser tab.
  await song.getByRole('button', { name: /^Piano/ }).click();
  const viewer = page.getByRole('dialog', { name: 'Piano' });
  await expect(viewer.getByRole('img', { name: 'Piano 1' })).toBeVisible({ timeout: 10_000 });
  await expect(viewer.getByRole('link', { name: 'Ladda ner' })).toHaveAttribute('download', 'Piano.pdf');
  await expect(viewer.getByRole('link', { name: 'Öppna i webbläsaren' })).toHaveCount(0);
});

test('another computer fetches a song\'s PDF when it is opened, and not before', async () => {
  host = await launch();
  await setUpHost(host);
  await createUser(host.page, 'Bo', 'bo@kyrkan.se');
  await createSong(host.page, 'Sång A', [['Verse 1', 'A ett']]);
  await openMaterials(host.page);
  await host.page.getByTestId('song-file').setInputFiles({ name: 'Gitarr.pdf', mimeType: 'application/pdf', buffer: onePagePdf() });
  await expect(host.page.getByRole('list', { name: 'Noter och länkar' }).getByRole('button', { name: /^Gitarr/ })).toBeVisible();
  second = await launch({ server: host.base });
  await pair(host.page, second.page, 'Andra datorn', 'Bo');
  // Every media request of the second computer, its database worker's too.
  const fetched: string[] = [];
  second.page.context().on('request', (r) => void (r.url().includes('/api/media/') && fetched.push(r.url())));
  await expect(second.page.getByTestId('status')).toHaveText(/^Synkad$/, { timeout: 5_000 });
  await openAdmin(second.page, 'Sånger');
  await second.page.getByRole('link', { name: 'Sång A' }).click();
  await openMaterials(second.page);
  const row = second.page.getByRole('list', { name: 'Noter och länkar' }).getByRole('button', { name: /^Gitarr/ });
  await expect(row).toBeVisible();
  expect(fetched).toEqual([]); // synced and shown, not fetched

  await row.click();

  await expect(second.page.getByRole('dialog', { name: 'Gitarr' }).getByRole('img', { name: 'Gitarr 1' })).toBeVisible({ timeout: 10_000 });
  expect(fetched).toHaveLength(1);
});
