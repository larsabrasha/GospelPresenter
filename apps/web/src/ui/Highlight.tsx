import { highlight } from '@gp/core';

/** `text` with the word prefixes that match `query` marked (SONG-A20), yellow as in SearchHighlighter.cs. */
export function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  return (
    <>
      {highlight(text, query).map((p, i) => (p.hit ? <mark key={i} className="bg-yellow-300/60 dark:bg-yellow-500/40 text-inherit rounded-sm">{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}
