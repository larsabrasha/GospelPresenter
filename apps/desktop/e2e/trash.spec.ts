// Papperskorg's Välj (Lars, 2026-11-07), as every list has it: the entries marked are restored together, or purged
// together after asking; Escape closes the question, then ends Välj.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { createSong, openAdmin, setUpHost } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('Välj in Papperskorg restores the marked together, and purges them after asking', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  for (const name of ['Ett', 'Två', 'Tre']) await createSong(page, name, [['Verse', name]]);

  // All three to the trash at once, through Sånger's Välj.
  await openAdmin(page, 'Sånger');
  const bar = page.getByRole('toolbar', { name: 'Markerade' });
  await page.getByRole('button', { name: 'Välj', exact: true }).click();
  await page.getByRole('button', { name: 'Markera alla' }).click();
  await bar.getByRole('button', { name: 'Radera' }).click();
  await page.getByRole('dialog', { name: 'Radera' }).getByRole('button', { name: 'Radera' }).click();
  await expect(page.getByText('Inga sånger i biblioteket ännu')).toBeVisible();

  await page.getByRole('link', { name: 'Papperskorg' }).click();
  const list = page.getByRole('list', { name: 'Papperskorg' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await page.getByRole('button', { name: 'Välj', exact: true }).click();
  await list.getByRole('listitem', { name: 'Ett' }).getByRole('checkbox').click();
  await list.getByRole('listitem', { name: 'Två' }).getByRole('checkbox').click();
  await expect(bar).toContainText('2 markerade');
  await bar.getByRole('button', { name: 'Återställ' }).click();
  await expect(page.getByRole('status').getByText('2 återställda')).toBeVisible();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(bar).toHaveCount(0);

  // Escape closes the question, then ends Välj; Inställningar stays.
  await page.getByRole('button', { name: 'Välj', exact: true }).click();
  await page.getByRole('button', { name: 'Markera alla' }).click();
  await bar.getByRole('button', { name: 'Radera' }).click();
  const purge = page.getByRole('dialog', { name: 'Radera permanent' });
  await expect(purge).toContainText('Vill du ta bort Tre permanent?');
  await page.keyboard.press('Escape');
  await expect(purge).toHaveCount(0);
  await expect(bar).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Papperskorg', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Välj', exact: true }).click();
  await list.getByRole('listitem', { name: 'Tre' }).getByRole('checkbox').click();
  await bar.getByRole('button', { name: 'Radera' }).click();
  await purge.getByRole('button', { name: 'Radera' }).click();
  await expect(page.getByText('Papperskorgen är tom.')).toBeVisible();
});
