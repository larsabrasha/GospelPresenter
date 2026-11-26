// What the website's pictures show beyond text (website.spec.ts): a sermon's slideshow, drawn by Chromium from HTML
// here, so nothing is fetched and nothing is anyone else's. Their theme is the built-in Blått.
import type { Browser } from '@playwright/test';
import type { Language } from '../../web/src/i18n.ts';

/** The sermon's ground: Blått's picture (apps/web/src/themes.ts), so the slideshow and the songs belong together. */
const BACKDROP = `
  background:
    radial-gradient(60% 55% at 30% 18%, rgba(56, 189, 248, 0.55), transparent 70%),
    radial-gradient(50% 45% at 78% 30%, rgba(129, 140, 248, 0.45), transparent 70%),
    radial-gradient(70% 60% at 55% 110%, rgba(14, 116, 144, 0.6), transparent 70%),
    linear-gradient(160deg, #0b1f3a, #071226 60%, #050b18);`;

/** A sermon's three slides in each language: its title, its points, and the verse it is on (in the public domain). */
const SERMON: Record<Language, { file: string; title: string; by: string; heading: string; points: string[]; verse: string; reference: string }> = {
  sv: {
    file: 'Predikan.pdf',
    title: 'Ljuset i mörkret',
    by: 'Predikan · Anna Lind',
    heading: 'Tre saker att ta med',
    points: ['Ljuset kommer till oss', 'Mörkret får inte sista ordet', 'Vi får bära ljuset vidare'],
    verse: 'Och ljuset lyser i mörkret, och mörkret har icke fått makt därmed.',
    reference: 'Joh. 1:5',
  },
  en: {
    file: 'Sermon.pdf',
    title: 'The Light in the Darkness',
    by: 'Sermon · Anne Lind',
    heading: 'Three things to take home',
    points: ['The light comes to us', 'Darkness does not have the last word', 'We carry the light on'],
    verse: 'And the light shineth in darkness; and the darkness comprehended it not.',
    reference: 'John 1:5',
  },
};

/** The sermon's file name, as the item is named after it. */
export const sermonFile = (lang: Language) => SERMON[lang].file;

/** The sermon as a three-page 16:9 PDF, as a church exports one from PowerPoint or Keynote. */
export async function sermonPdf(browser: Browser, lang: Language): Promise<Buffer> {
  const s = SERMON[lang];
  const slide = (inner: string) =>
    `<section style="width:1920px;height:1080px;box-sizing:border-box;padding:140px 180px;display:flex;flex-direction:column;justify-content:center;color:white;${BACKDROP}page-break-after:always">${inner}</section>`;
  const html = `<html><head><style>@page{size:1920px 1080px;margin:0}body{margin:0;font-family:Helvetica,Arial,sans-serif}</style></head><body>
    ${slide(`<div style="font-size:120px;font-weight:700;line-height:1.1">${s.title}</div><div style="margin-top:40px;font-size:48px;color:#bae6fd">${s.by}</div>`)}
    ${slide(`<div style="font-size:80px;font-weight:700;margin-bottom:60px">${s.heading}</div>${s.points.map((p, i) => `<div style="font-size:60px;margin:18px 0"><span style="color:#7dd3fc;font-weight:700">${i + 1}.</span> ${p}</div>`).join('')}`)}
    ${slide(`<div style="font-size:76px;line-height:1.3;font-style:italic">“${s.verse}”</div><div style="margin-top:48px;font-size:52px;color:#bae6fd">${s.reference}</div>`)}
  </body></html>`;
  const page = await browser.newPage();
  await page.setContent(html);
  const pdf = await page.pdf({ width: '1920px', height: '1080px', printBackground: true });
  await page.close();
  return pdf;
}
