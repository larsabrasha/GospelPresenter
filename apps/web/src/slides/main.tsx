// The slide renderer of the native apps (docs/native-apps.md; Lars, 2026-11-17): the web's own SlideView, so a slide
// on an iPad looks as it does on every output. Built on its own (vite.slides.config.ts) and bundled into the app; the
// app's web view loads it from the app and calls the two functions below with the core's JSON. Pictures come from the
// app's own storage, through its `gp://media/{hash}` address.
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { CustomPage, Slide, Theme } from '@gp/core';
import { SlideView } from '../ui/SlideView.tsx';
import '../fonts.css';
import '../app.css';
import './slides.css';

/** A slide to draw: the core's slide (none: only the overlay, on a clear ground), its theme and the overlay over it. */
interface Tile {
  slide: Slide | null;
  theme: Theme | null;
  overlay: CustomPage | null;
  /** The part's label on the stage, as a tile shows it; never on what the outputs show. */
  label: boolean;
}

/** Tiles laid out as a grid of `columns`, each `width` × `height`: one picture of the page gives every tile. */
interface Sheet {
  tiles: Tile[];
  width: number;
  height: number;
  columns: number;
}

const media = (hash: string) => `gp://media/${hash}`;
const root = createRoot(document.getElementById('root')!);

function TileView({ tile }: { tile: Tile }) {
  return (
    <div className={tile.slide ? 'tile' : 'tile clear'}>
      <SlideView slide={tile.slide} theme={tile.theme ?? undefined} overlay={tile.overlay} label={tile.label} credits={!tile.label} media={media} />
    </div>
  );
}

/** Answers once the page is painted: the fonts loaded, the texts fitted again to them, the pictures decoded. */
async function painted(): Promise<void> {
  await document.fonts.ready;
  await Promise.all([...document.images].map((img) => (img.complete ? null : img.decode().catch(() => undefined))));
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
}

declare global {
  interface Window {
    gpSheet: (sheet: Sheet) => Promise<boolean>;
    gpShow: (tile: Tile) => Promise<boolean>;
  }
}

/** Draws a sheet of tiles for the app to cut out of one snapshot. */
window.gpSheet = async ({ tiles, width, height, columns }) => {
  flushSync(() =>
    root.render(
      <div className="sheet" style={{ gridTemplateColumns: `repeat(${columns}, ${width}px)`, gridAutoRows: `${height}px` }}>
        {tiles.map((tile, i) => (
          <TileView key={i} tile={tile} />
        ))}
      </div>,
    ),
  );
  await painted();
  return true;
};

/** Draws one slide filling the view: the live picture. */
window.gpShow = async (tile) => {
  flushSync(() =>
    root.render(
      <div className="whole">
        <TileView tile={tile} />
      </div>,
    ),
  );
  await painted();
  return true;
};
