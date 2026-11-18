// The ProPresenter import's duplicates against the web's songImport.ts at fb03e798 (build.sh's LEGACY_REFERENCE):
// `songNamesakesView` against `namesakes`, and `songImportDuplicatesView` against `planImport`'s duplicates with
// `choicesFor` and `defaultChoice`, on imports made here: names alike but for case, composition or white space, texts
// alike but for spaces and line breaks, a name twice in one import, several library songs of one name.
import { choicesFor, defaultChoice, namesakes, planImport, songText } from '../.out/song-import.mjs';
import { viewRust } from '../diff.mjs';
import { canon } from '../sources.mjs';

let seed = 71;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const int = (n) => Math.floor(rand() * n);

const NAMES = ['Härlig är jorden', 'HÄRLIG ÄR JORDEN', 'Härlig är jorden'.normalize('NFD'), '  Härlig är jorden ', 'Tusen skäl', 'tusen skäl', 'Ὀδυσσεύς', 'ΣΟΦΟΣ', 'Ett', ''];
const LINES = ['Härlig är jorden', 'härlig är Guds himmel', 'Skön är själarnas', 'pilgrimsgång'];
const text = () => Array.from({ length: 1 + int(3) }, () => pick(LINES)).join(pick(['\n', ' ', '  \n', '\n\n', '\t']));
const song = () => ({ name: pick(NAMES), author: null, publisher: null, ccli: null, parts: Array.from({ length: 1 + int(3) }, () => ({ labelText: null, content: text() })), arrangements: [] });

export default async function check(db) {
  const differ = [];
  let compared = 0;
  let found = 0;
  let id = 0;
  const same = (what, want, got) => {
    compared++;
    if (want !== got) differ.push(`${what}: TS ${want.slice(0, 300)} Rust ${got.slice(0, 300)}`);
  };
  for (let i = 0; i < 2000; i++) {
    const read = Array.from({ length: 1 + int(5) }, song);
    const library = Array.from({ length: int(6) }, () => ({ id: pick(['L1', 'L2', 'L3', '']), name: pick(NAMES), text: text() }));
    const at = await viewRust(db, 'songNamesakesView', { names: read.map((s) => s.name), library: library.map((s) => s.name) });
    same(`namesakes ${i}`, JSON.stringify(namesakes(read, library)), JSON.stringify(at.map((k) => library[k])));
    const plan = planImport(read, library, () => `n${id++}`);
    found += plan.duplicates.length;
    const want = plan.duplicates.map((d) => ({ index: d.index, other: d.other, same: d.same, choices: choicesFor(d), choice: defaultChoice(d) }));
    const songs = read.map((s) => ({ name: s.name, text: songText(s.parts) }));
    same(`duplicates ${i}`, canon(want), canon(await viewRust(db, 'songImportDuplicatesView', { songs, library })));
  }
  return { compared, differ, notes: [`2 000 imports, ${found} duplicates found`] };
}
