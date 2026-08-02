/* global URL */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../components/OfflineBanner.tsx", import.meta.url),
  "utf8",
);

test("connectivity checks stay on the validated first-party site origin", () => {
  assert.doesNotMatch(source, /google\.com|generate_204/i);
  assert.match(source, /resolveMobileSiteOrigin\(/);
  assert.match(source, /buildMobileSiteUrl\("\/api\/health", SITE_ORIGIN\)/);
});
