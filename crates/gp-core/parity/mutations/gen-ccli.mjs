// Random inputs for ccli.ts's 3 mutators: collection switched on and off, songs shown recorded, entries reported.
export function generator({ random, pick, mostly, idsOf }) {
  const q = random();
  if (q < 0.15) return { name: 'setCcliCollection', args: { on: mostly([true, false], ['true', 1, null]) } };
  if (q < 0.7) {
    return {
      name: 'recordCcliUse',
      args: {
        songId: mostly(['s1', 's2', 's3', 'sx'], ['', 'x'.repeat(101)]), songName: mostly(['Härlig är jorden', '', 'x'.repeat(200)], ['x'.repeat(201), null]),
        ccli: mostly(['12345', ' 999 ', '', '   ', 'x'.repeat(20), ' x'.repeat(10)], ['x'.repeat(21), null]),
        presentationId: mostly(['p1', 'p2', 'px'], ['']), presentationName: mostly(['Söndag', ''], ['x'.repeat(201)]),
        date: mostly(['2026-11-01', '2026-11-15', '9999-99-99'], ['2026-1-01', '２０２６-11-01', '2026-11-01\n', 20261101]),
      },
    };
  }
  const entries = idsOf('SELECT id FROM ccli_entries');
  const ids = mostly([entries.filter(() => random() < 0.5), [...entries, 'x|y|z'], [pick([...entries, 'q'])]], [[], Array(501).fill('a'), ['x'.repeat(401)], [7]]);
  return { name: 'setCcliReported', args: { ids: ids.length ? ids : ['none'], reported: mostly([true, false], ['yes']), at: mostly([1000, 2000], [1.5, null]) } };
}
