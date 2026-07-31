import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const settingsPath = fileURLToPath(
  new URL("../../app/settings/index.tsx", import.meta.url),
);
const settingsSource = readFileSync(settingsPath, "utf8");

test("mobile settings saves every editable identity and journey field through one API patch", () => {
  const handleSaveStart = settingsSource.indexOf("async function handleSave()");
  const handleSave = settingsSource.slice(
    handleSaveStart,
    settingsSource.indexOf(
      "async function handleRevokeLegacyCareConsent()",
      handleSaveStart,
    ),
  );

  assert.match(handleSave, /apiFetch\("\/api\/settings\/wedding-profile"/);
  assert.equal((handleSave.match(/method:\s*"PATCH"/g) ?? []).length, 1);
  assert.doesNotMatch(handleSave, /\.from\("wedding_journeys"\)/);
  assert.doesNotMatch(handleSave, /parseInt\(/);
  assert.doesNotMatch(
    handleSave,
    /apiFetch\("\/api\/community\/profile",\s*\{\s*method:\s*"PATCH"/s,
  );
  assert.ok(
    handleSave.indexOf("setInitialData(savedSettings.data)") >
      handleSave.indexOf("if (!response.ok)"),
    "the last-known-good snapshot must advance only after a successful response",
  );
  assert.match(handleSave, /if \(response\.status === 409\) setLoadError\(errorMessage\)/);
});
