// All original cases/assertions run from their fixed final-B1 Git blobs in one owned241 graph.
// Current source242 rejection and B2 behavior have separate mandatory current-root suites.
import {fileURLToPath} from 'node:url';
import {registerAmoraActionViewV2HistoricalSuite} from './fixtures/amora-action-view-v2-history-repository.mjs';
await registerAmoraActionViewV2HistoricalSuite(fileURLToPath(new URL('../../',import.meta.url)),'amora-action-view-v2-runtime');
