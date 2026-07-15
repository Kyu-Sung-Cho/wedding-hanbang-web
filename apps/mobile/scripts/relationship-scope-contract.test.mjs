import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PUBLIC_BETA_RELATIONSHIP_SCOPE } from "../../../packages/shared/src/constants/index.ts";

const onboarding = readFileSync(
  new globalThis.URL("../app/onboarding/index.tsx", import.meta.url),
  "utf8",
);
const signup = readFileSync(
  new globalThis.URL("../app/(auth)/signup.tsx", import.meta.url),
  "utf8",
);

test("mobile shows the supported couple structure before signup and role selection", () => {
  assert.deepEqual(PUBLIC_BETA_RELATIONSHIP_SCOPE.supportedRoles, [
    "bride",
    "groom",
  ]);

  for (const screen of [signup, onboarding]) {
    assert.match(screen, /PUBLIC_BETA_RELATIONSHIP_SCOPE\.notice/);
    assert.match(screen, /PUBLIC_BETA_RELATIONSHIP_SCOPE\.guidance/);
  }
});
