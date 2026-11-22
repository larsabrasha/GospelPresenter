// The views ported back from the Rust core (ADR 0008, docs/core-back-to-typescript.md), one file per group of them;
// a group adds its views here. commands.ts answers each name here, RustCore sends the rest to the WASM.
import * as live from './live.ts';
import type { PureView, View } from './sql.ts';
import { slidesPureViews, slidesViews } from './slides.ts';
import { startPageView } from './start-page.ts';
import { pagePureViews, pageViews } from './page.ts';
import { audiosView, customSlidesView, customSlideView, imagesView, overlayRowView, overlaysView, videosView } from './lists-media.ts';
import { libraryPageView, settingsListView, settingsSearchView } from './lists-pages.ts';
import { biblesView, ccliReportView, coreInfoView, defaultThemeIdView, freshNameView, ownThemesView, ownThemeView, rulesView, themesPageView } from './lists-settings.ts';
import { songHistoryView, songMaterialsView, songPageView, songPresentationsView, songSearchPrepare, songSearchView, songsView, songView } from './lists-songs.ts';
import { itemsView, labelsView, pinnedView, presentationListView, songPartsView, templatesView, trashEntriesView } from './lists.ts';

export const views: Record<string, View> = {
  ...slidesViews,
  // lists (wave 4)
  presentationListView, templatesView, itemsView, labelsView, songPartsView, pinnedView, trashEntriesView,
  imagesView, audiosView, videosView, customSlidesView, customSlideView, overlaysView, overlayRowView,
  songsView, songSearchPrepare, songSearchView, songView, songPageView, songPresentationsView, songHistoryView, songMaterialsView,
  biblesView, ownThemesView, ownThemeView, defaultThemeIdView, ccliReportView, themesPageView,
  startPageView,
  ...pageViews,
};
export const pureViews: Record<string, PureView> = {
  ...live.pureViews,
  ...slidesPureViews,
  // lists (wave 4)
  settingsListView, settingsSearchView, freshNameView, libraryPageView, rulesView, coreInfoView,
  ...pagePureViews,
};
