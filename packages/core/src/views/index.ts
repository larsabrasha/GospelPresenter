// The views ported back from the Rust core (ADR 0008, docs/core-back-to-typescript.md), one file per group of them;
// a group adds its views here. commands.ts answers each name here, RustCore sends the rest to the WASM.
import type { PureView, View } from './sql.ts';
import { slidesPureViews, slidesViews } from './slides.ts';

export const views: Record<string, View> = {};
export const pureViews: Record<string, PureView> = {};
Object.assign(views, slidesViews);
Object.assign(pureViews, slidesPureViews);
