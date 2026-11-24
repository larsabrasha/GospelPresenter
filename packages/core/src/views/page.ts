// The page group of wave 3 (ADR 0008, docs/core-back-to-typescript.md): a presentation page's state and its events,
// presenting's reads (the slide shown, overlays, the video and audio to play, CCLI, the outputs, the remote control
// policy), and the presentation page's view, as the Rust core answered them.
import {
  ccliUseView,
  displaysView,
  itemAudioView,
  itemOverlaysView,
  livePlaybackView,
  liveSlideView,
  liveTargetsView,
  overlayView,
  remoteControlView,
} from './page-live.ts';
import { presentationPageView } from './page-presentation.ts';
import { pageEventView, pageModelView } from './page-state.ts';
import type { PureView, View } from './sql.ts';

export const pageViews: Record<string, View> = {
  liveSlideView,
  overlayView,
  itemOverlaysView,
  liveTargetsView,
  livePlaybackView,
  itemAudioView,
  ccliUseView,
  displaysView,
  remoteControlView,
  presentationPageView,
};
export const pagePureViews: Record<string, PureView> = {
  pageEventView,
  pageModelView,
};
