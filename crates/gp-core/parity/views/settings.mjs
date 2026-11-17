// The Bibles, the themes and the CCLI report against 2.0's reads (listBibles, ownThemes, getOwnTheme,
// orgDefaultThemeId, listCcliEntries and ccliCollectionOn at 238d481b); lists the page orders by its language compared
// in that order.
import { ccliCollectionOn, getOwnTheme, listBibles, listCcliEntries, orgDefaultThemeId, ownThemes } from '../.out/web-queries.mjs';
import { viewRust } from '../diff.mjs';
import { canon } from '../sources.mjs';
import { fixture } from './fixture.mjs';
import { readDb } from './web-db.mjs';

const byLocale = new Intl.Collator('sv', { sensitivity: 'base' }).compare;
const bibleOrder = (xs) => xs.toSorted((a, b) => byLocale(a.name, b.name) || a.id.localeCompare(b.id));
const ccliOrder = (xs) =>
  xs.toSorted((a, b) => b.date.localeCompare(a.date) || byLocale(a.presentationName, b.presentationName) || a.presentationId.localeCompare(b.presentationId) || byLocale(a.songName, b.songName));

export default async function check(_, file) {
  const db = fixture(file);
  const d = readDb(db);
  const differ = [];
  let compared = 0;
  const same = async (view, args, want, order = (x) => x) => {
    compared++;
    const got = order(await viewRust(db, view, args));
    if (canon(want) !== canon(got)) differ.push(`${view} ${JSON.stringify(args)}: TS ${canon(want).slice(0, 300)} Rust ${canon(got).slice(0, 300)}`);
  };
  await same('biblesView', {}, await listBibles(d), bibleOrder);
  await same('ownThemesView', {}, await ownThemes(d));
  await same('defaultThemeIdView', {}, await orgDefaultThemeId(d));
  for (const id of ['own-1', 'own-bad', 'light', 'no-such']) await same('ownThemeView', { id }, await getOwnTheme(d, id));
  await same('ccliReportView', {}, { entries: await listCcliEntries(d), on: await ccliCollectionOn(d) }, (v) => ({ ...v, entries: ccliOrder(v.entries) }));
  return { compared, differ, notes: ['the Bibles, own themes and the default, each own theme, the CCLI report'] };
}
