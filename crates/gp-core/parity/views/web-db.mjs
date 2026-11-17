// A ReadDb (apps/web/src/db/share.ts) over node:sqlite, so the web's own reads run here as the reference.
export const readDb = (db) => ({
  query: async (sql, params = []) => db.prepare(sql).all(...params),
  onChange: () => () => {},
  fetchMedia: async () => null,
  view: async () => {
    throw new Error('the reference reads by SQL');
  },
});
