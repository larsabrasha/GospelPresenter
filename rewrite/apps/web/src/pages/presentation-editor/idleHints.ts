// The quotes and Bible verses the editor shows when nothing is selected (SlideGrid.razor's idle hints).
// Each icon is the inside of a 24×24 stroked SVG, as markup.

export interface IdleHint {
  icon: string;
  text: string;
  source?: string;
}

const MUSIC = '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>';
const BOOK = '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>';
const HEART = '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/>';
const SUN = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
const STAR = '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>';
const FEATHER = '<path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/>';
const MIC = '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>';
const CLOUD = '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>';
const FLAME = '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>';
const COFFEE = '<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>';
const MOUNTAIN = '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>';
const DOVE = '<path d="M12 22c-4-3-8-6-8-10a4 4 0 0 1 8 0 4 4 0 0 1 8 0c0 4-4 7-8 10z"/>';
const SPARKLE = '<path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z"/><path d="M19 1l.5 2 2 .5-2 .5-.5 2-.5-2-2-.5 2-.5L19 1z" opacity="0.6"/><path d="M5 19l.5 2 2 .5-2 .5-.5 2-.5-2-2-.5 2-.5L5 19z" opacity="0.6"/>';

export const IDLE_HINTS: IdleHint[] = [
  { icon: MUSIC, text: '"Utan musik vore livet ett misstag."', source: 'Friedrich Nietzsche' },
  { icon: MUSIC, text: '"Musik uttrycker det som inte kan sägas med ord."', source: 'Victor Hugo' },
  { icon: MUSIC, text: '"Bortom orden tar musiken vid."' },
  { icon: MUSIC, text: '"En värld utan musik är som en kropp utan själ."' },
  { icon: MIC, text: '"Sång är glädjens modersmål."' },
  { icon: MIC, text: '"Rösten är det mest personliga instrumentet."' },
  { icon: BOOK, text: '"Herren är min kraft och mitt värn, han blev min räddning."', source: '2 Mos 15:2' },
  { icon: BOOK, text: '"Sjung till Herrens ära, sjung en ny sång, sjung till Herrens ära, hela världen!"', source: 'Psalm 96:1' },
  { icon: BOOK, text: '"Allt som lever och andas skall prisa Herren. Halleluja!"', source: 'Psalm 150:6' },
  { icon: BOOK, text: '"Hylla Herren, hela världen!"', source: 'Psalm 100:1' },
  { icon: BOOK, text: '"Tacka Herren, ty han är god, evigt varar hans nåd."', source: 'Psalm 136:1' },
  { icon: BOOK, text: '"Herren är god, evigt varar hans nåd, från släkte till släkte hans trofasthet."', source: 'Psalm 100:5' },
  { icon: BOOK, text: '"Lugn! Besinna att jag är Gud, upphöjd över folken, upphöjd över jorden."', source: 'Psalm 46:11' },
  { icon: BOOK, text: '"Herren är mitt ljus och min räddning, vem skulle jag frukta?"', source: 'Psalm 27:1' },
  { icon: BOOK, text: '"Tacka Herren, ty han är god, evigt varar hans nåd."', source: 'Psalm 107:1' },
  { icon: BOOK, text: '"Om Herrens nåd vill jag alltid sjunga."', source: 'Psalm 89:2' },
  { icon: BOOK, text: '"Herren är nära alla som ropar, alla som av hjärtat ropar till honom."', source: 'Psalm 145:18' },
  { icon: BOOK, text: '"Se, jag gör allting nytt."', source: 'Upp 21:5' },
  { icon: BOOK, text: '"Gud är min räddning, jag är trygg och utan fruktan."', source: 'Jes 12:2' },
  { icon: BOOK, text: '"Lova Herren, min själ, minns allt det goda han gör."', source: 'Psalm 103:2' },
  { icon: BOOK, text: '"Se och smaka Herrens godhet, lycklig den som flyr till honom!"', source: 'Psalm 34:9' },
  { icon: BOOK, text: '"Herren är min herde, ingenting skall fattas mig."', source: 'Psalm 23:1' },
  { icon: HEART, text: '"Där Guds folk samlas, där klingar lovsången."' },
  { icon: HEART, text: '"Lovsång är hjärtats naturliga svar på nåd."' },
  { icon: HEART, text: '"Glädjens frukt är tacksamhet."' },
  { icon: HEART, text: '"Tillbedjan är inte en del av livet – det är livet."' },
  { icon: FLAME, text: '"Elden i lovsången tänds i bönens stillhet."' },
  { icon: FLAME, text: '"Herren, det är Anden, och där Herrens ande är, där är frihet."', source: '2 Kor 3:17' },
  { icon: DOVE, text: '"Frid lämnar jag kvar åt er, min frid ger jag er."', source: 'Joh 14:27' },
  { icon: STAR, text: '"En sång kan förändra ett ögonblick, en lovsång kan förändra en evighet."' },
  { icon: STAR, text: '"Varje gudstjänst är en ny början."' },
  { icon: STAR, text: '"Det finns en melodi i varje morgon."' },
  { icon: SUN, text: '"Varje dag är en gåva att tacka för."' },
  { icon: SUN, text: '"Herrens nåd tar inte slut, hans barmhärtighet upphör aldrig. Varje morgon är den ny."', source: 'Klag 3:22–23' },
  { icon: SUN, text: '"Ljuset lyser i mörkret, och mörkret har inte övervunnit det."', source: 'Joh 1:5' },
  { icon: MOUNTAIN, text: '"Jag ser upp emot bergen: varifrån skall jag få hjälp?"', source: 'Psalm 121:1' },
  { icon: CLOUD, text: '"Han för mig i vall på gröna ängar, han låter mig vila vid lugna vatten."', source: 'Psalm 23:2' },
  { icon: FEATHER, text: '"De som litar till Herren får ny kraft, de får vingar som örnar."', source: 'Jes 40:31' },
  { icon: SPARKLE, text: '"Guds nåd är alltid större."' },
  { icon: COFFEE, text: '"Även Jesus tog en paus ibland."' },
];
