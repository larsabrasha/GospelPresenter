// The web's UI texts (apps/web/src/i18n.ts), Swedish and English, as JSON in the iPad app's bundle
// (app/Resources/texts.json, not kept in git), as apps/mac/texts.mjs writes them for the native app: one table, so a
// text is written once. build-core.sh runs it.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { texts } = await import(join(here, '../../apps/web/src/i18n.ts'));
writeFileSync(join(here, 'app/Resources/texts.json'), JSON.stringify(texts));
