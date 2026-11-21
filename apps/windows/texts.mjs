// The web's UI texts (apps/web/src/i18n.ts), Swedish and English, as the JSON the Windows app's Shell library embeds
// (Shell/texts.json, not kept in git): one table for the web and the native apps, as apps/mac/texts.mjs makes the
// Mac's. Written only when it changed. build/core.sh and build/build.ps1 run it.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { texts } = await import(join(here, '../web/src/i18n.ts'));
const out = join(here, 'Shell/texts.json');
const json = JSON.stringify(texts);
let old = '';
try {
  old = readFileSync(out, 'utf8');
} catch {}
if (old !== json) writeFileSync(out, json);
