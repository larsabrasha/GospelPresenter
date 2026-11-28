// A church's planning sheet read as events (docs/planning.md, "Import"): the dates and times people write, the years
// a sheet without them runs through, the cells as entries, and the files Excel, Google Sheets and a CSV give. The names
// here are made up; the sheet that shaped the rules is kept out of the repository.
import { describe, expect, it } from 'vitest';
import { eventsFromSheet, makeZip, readSheet, utf8Encode } from '@gp/core';
import { readWhen } from '../../src/sheet-events.ts';

const header = ['Datum och tid', 'Samling', 'Mötesledning', 'Predikan', 'Musik'];
const read = (rows: string[][], members: { id: string; name: string }[] = []) => {
  let n = 0;
  return eventsFromSheet([header, ...rows], { today: '2026-11-28', members, newId: () => `e${++n}` });
};

describe('reading the date and time', () => {
  it('reads a weekday, a date and a time', () => {
    expect(readWhen('Sö 4/1 kl 11')).toMatchObject({ day: 4, month: 1, weekday: 0, time: '11:00', note: '' });
  });

  it('reads a time with minutes', () => {
    expect(readWhen('Sö 4/10 kl 11.00')).toMatchObject({ time: '11:00' });
  });

  it('reads a time range as a start and an end', () => {
    expect(readWhen('Fr 16/1  kl 15-18')).toMatchObject({ time: '15:00', endTime: '18:00' });
  });

  it('reads two days with a weekday between them', () => {
    expect(readWhen('Lö 3/1-Sö4/1 kl 11-11')).toMatchObject({ day: 3, month: 1, endDay: 4, endMonth: 1, time: '11:00', endTime: '11:00' });
  });

  it('reads two days written as one range', () => {
    expect(readWhen('12-13/9')).toMatchObject({ day: 12, month: 9, endDay: 13, endMonth: 9, time: null });
  });

  it('keeps what it does not read as a note', () => {
    expect(readWhen('Lö 17/1 kl 14 och 16')).toMatchObject({ time: '14:00', note: 'och 16' });
  });

  it('keeps a feast’s name as a note', () => {
    expect(readWhen('Fr 26/3 Långfredag')).toMatchObject({ day: 26, month: 3, weekday: 5, note: 'Långfredag' });
  });

  it('reads no date in a cell without one', () => {
    expect(readWhen('Någon gång i vår')).toBeNull();
  });
});

describe('the years', () => {
  it('takes the year whose weekday is the one written', () => {
    const { events } = read([['Fr 26/12 kl 18', 'Gudstjänst']]);

    expect(events[0]!.date).toBe('2025-12-26');
  });

  it('goes on into the next year as the sheet runs forward', () => {
    const { events } = read([['Fr 26/12 kl 18', 'Gudstjänst'], ['To 1/1 kl 18', 'Nyårsbön'], ['Sö 3/1 kl 11', 'Nyårsgudstjänst']]);

    expect(events.map((e) => e.date)).toEqual(['2025-12-26', '2026-01-01', '2027-01-03']);
  });

  it('gives a date without a weekday its neighbour’s year', () => {
    const { events } = read([['Sö 6/9 kl 11', 'Gudstjänst'], ['12-13/9', 'Församlingshelg']]);

    expect(events[1]).toMatchObject({ date: '2026-09-12', endDate: '2026-09-13' });
  });
});

describe('the rows', () => {
  it('makes a field of each column after the title where the row has something', () => {
    const { events } = read([['Sö 29/11 kl 11', 'Gudstjänst', 'Anna Berg', '', 'Maria Ek m fl']]);

    expect(events[0]!.fields).toEqual([
      { name: 'Mötesledning', entries: [{ text: 'Anna Berg' }] },
      { name: 'Musik', entries: [{ text: 'Maria Ek m fl' }] },
    ]);
  });

  it('makes a cell that is exactly a member’s name that person', () => {
    const { events } = read([['Sö 29/11 kl 11', 'Gudstjänst', 'anna berg']], [{ id: 'u1', name: 'Anna Berg' }]);

    expect(events[0]!.fields[0]!.entries).toEqual([{ person: 'u1', name: 'Anna Berg' }]);
  });

  it('reads a row of dashes as a task not needed', () => {
    const { events } = read([['Sö 23/8 kl 11', 'Ekumenisk gudstjänst', '', '-----']]);

    expect(events[0]!.fields).toEqual([{ name: 'Predikan', entries: [{ text: '–' }] }]);
  });

  it('drops stray separators at a cell’s ends', () => {
    const { events } = read([['Sö 15/3 kl 11', 'Gudstjänst', '', '', ', Sven psalmer']]);

    expect(events[0]!.fields[0]!.entries).toEqual([{ text: 'Sven psalmer' }]);
  });

  it('keeps a row with a date only as an event without a title', () => {
    const { events } = read([['Sö 17/1 kl 11']]);

    expect(events[0]).toMatchObject({ title: '', fields: [] });
  });

  it('skips a row whose date does not read, and says which', () => {
    const { events, skipped } = read([['Någon gång i vår', 'Utflykt']]);

    expect([events.length, skipped]).toEqual([0, [{ row: 2, text: 'Någon gång i vår · Utflykt' }]]);
  });

  it('puts what the first column says beyond the date in the description', () => {
    const { events } = read([['Sö 24/5 kl 11 pingst', 'Gudstjänst']]);

    expect(events[0]!.description).toBe('pingst');
  });
});

describe('the files', () => {
  it('reads a CSV with semicolons and quotes', () => {
    const rows = readSheet(utf8Encode('Datum;Samling\n"Sö 4/1 kl 11";"Gudstjänst; med nattvard"\n'));

    expect(rows).toEqual([['Datum', 'Samling'], ['Sö 4/1 kl 11', 'Gudstjänst; med nattvard']]);
  });

  it('reads the first sheet of an xlsx, its shared and inline strings, a gap left as empty', () => {
    const xlsx = makeZip([
      { name: 'xl/workbook.xml', data: utf8Encode('<workbook><sheets><sheet name="HT" sheetId="1" r:id="rId1"/></sheets></workbook>') },
      { name: 'xl/_rels/workbook.xml.rels', data: utf8Encode('<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>') },
      { name: 'xl/sharedStrings.xml', data: utf8Encode('<sst><si><t>Sö 4/1 kl 11</t></si><si><r><t>Guds</t></r><r><t>tjänst &amp; fika</t></r></si></sst>') },
      {
        name: 'xl/worksheets/sheet1.xml',
        data: utf8Encode('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>Anna</t></is></c></row><row r="2"><c r="B2" t="s"><v>1</v></c></row></sheetData></worksheet>'),
      },
    ]);

    expect(readSheet(xlsx)).toEqual([['Sö 4/1 kl 11', '', 'Anna'], ['', 'Gudstjänst & fika']]);
  });

  it('reads a date Excel keeps as a number', () => {
    const xlsx = makeZip([
      { name: 'xl/styles.xml', data: utf8Encode('<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>') },
      { name: 'xl/worksheets/sheet1.xml', data: utf8Encode('<worksheet><sheetData><row r="1"><c r="A1" s="1"><v>46355</v></c></row></sheetData></worksheet>') },
    ]);

    expect(readSheet(xlsx)).toEqual([['2026-11-29']]);
  });
});
