// Every UI text is shown somewhere: a text nobody uses still has to be kept right in two languages.
import { describe, expect, it } from 'vitest';
import { FILES } from './source.ts';

const I18N = 'apps/web/src/i18n.ts';

/** The keys of the Swedish texts, which the English ones must match (the types check that). */
function keys(): string[] {
  const lines = FILES.find((f) => f.path === I18N)!.lines;
  const end = lines.indexOf('} as const;');
  return lines.slice(0, end).flatMap((line) => /^ {2}'([^']+)':/.exec(line)?.[1] ?? []);
}

describe('UI texts', () => {
  it('use every text in the web app, by its key or by a template that ends in it', () => {
    const web = FILES.filter((f) => f.pkg === 'apps/web' && f.kind === 'source' && f.path !== I18N)
      .map((f) => f.lines.join('\n'))
      .join('\n');
    // `role.${r}` uses every role.… text; a key only ever made from variables would hide here, so write keys out.
    const prefixes = [...web.matchAll(/`([\w.-]+\.)\$\{/g)].map((m) => m[1]!);
    // Every quoted word in one pass: looking for each key in the whole app, three ways, took seconds under load.
    const quoted = new Set([...web.matchAll(/(['"`])([\w.-]+)\1/g)].map((m) => m[2]!));

    expect(keys().filter((key) => !quoted.has(key) && !prefixes.some((p) => key.startsWith(p)))).toEqual([]);
  });
});
