// Every unit test of the web: the page's own core loaded, as main.tsx loads it before the app shows a page, here from
// disk (packages/rust-core/dist), since a test has no page to fetch it into.
import { nodeRustCore } from '@gp/rust-core/node';
import { setPageCore } from '../src/db/pageCore.ts';

setPageCore(nodeRustCore());
