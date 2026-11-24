import { t } from '../i18n.ts';
import { SearchField } from './Picker.tsx';

// A list page's search, alike on every list in Inställningar (Lars, 2026-11-03): under the title, iOS's filled field.

export function ListSearch({ query, onChange }: { query: string; onChange: (query: string) => void }) {
  return <SearchField compact filled value={query} onChange={onChange} label={t('images.search')} placeholder={t('images.searchPlaceholder')} />;
}

/** Whether any of `texts` holds `query`, case aside; an empty query matches all. */
export function matches(query: string, ...texts: (string | null | undefined)[]): boolean {
  const q = query.trim().toLocaleLowerCase('sv');
  return !q || texts.some((text) => !!text && text.toLocaleLowerCase('sv').includes(q));
}

/** "Inga träffar för …", where a search finds nothing. */
export function NoMatch({ query }: { query: string }) {
  return <p className="px-5 text-sm text-stone-400">{t('search.none', { query: query.trim() })}</p>;
}
