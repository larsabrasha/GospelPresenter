// The views ported back from the Rust core (ADR 0008, docs/core-back-to-typescript.md), one file per group of them;
// a group adds its views here, and commands.ts answers each name here.
import * as live from './live.ts';
import type { PureView, View } from './sql.ts';
import { slidesPureViews, slidesViews } from './slides.ts';
import { startPageView } from './start-page.ts';
import { pagePureViews, pageViews } from './page.ts';
import { filesPureViews, filesViews } from './files.ts';
import { audiosView, customSlidesView, customSlideView, imagesView, overlayRowView, overlaysView, videosView } from './lists-media.ts';
import { biblesView, ccliReportView, defaultThemeIdView, ownThemesView, ownThemeView, themesPageView } from './lists-settings.ts';
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
  ...filesViews,
};
export const pureViews: Record<string, PureView> = {
  ...live.pureViews,
  ...slidesPureViews,
  ...pagePureViews,
  ...filesPureViews,
};
