import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const settingsPath = fileURLToPath(
  new URL("../../app/settings/index.tsx", import.meta.url),
);
const settingsSource = readFileSync(settingsPath, "utf8");

test("mobile settings binds profile saves to the submitted owner and advances only confirmed baselines", () => {
  const handleSaveStart = settingsSource.indexOf("async function handleSave()");
  const handleSave = settingsSource.slice(
    handleSaveStart,
    settingsSource.indexOf(
      "async function handleRevokeLegacyCareConsent()",
      handleSaveStart,
    ),
  );

  assert.match(handleSave, /const saveSnapshot = settingsSnapshot/);
  assert.match(handleSave, /apiFetchForExpectedUser\(saveSnapshot\.userId, "\/api\/settings\/wedding-profile"/);
  assert.equal((handleSave.match(/method:\s*"PATCH"/g) ?? []).length, 1);
  assert.doesNotMatch(handleSave, /\.from\("wedding_journeys"\)/);
  assert.doesNotMatch(handleSave, /parseInt\(/);
  assert.doesNotMatch(
    handleSave,
    /apiFetch\("\/api\/community\/profile",\s*\{\s*method:\s*"PATCH"/s,
  );
  assert.ok(
    handleSave.indexOf("current === committedInitialData ? savedSettings.data : current") >
      handleSave.indexOf("if (!response.ok)"),
    "the last-known-good snapshot must advance only after a successful response",
  );
  assert.match(handleSave, /if \(planChanges && planOutcome === "applied"\)[\s\S]*advanceWeddingPlanBaseline\(saveSnapshot, planChanges\)/);
  // 화면 데이터가 낡았을 때는 다시 불러와야 한다 — 낡은 스냅샷을 들고 있으면 안 된다.
  assert.match(
    handleSave,
    /response\.status === 409 && errorCode === "SETTINGS_CHANGED"[\s\S]{0,80}setLoadError\(errorMessage\)/,
  );
  // 다만 저장이 거부된 것은 화면이 낡았다는 뜻이 아니다. 상태 코드만 보고 화면을
  // 날리면 사람이 방금 입력한 값까지 잃는다.
  assert.doesNotMatch(handleSave, /if \(response\.status === 409\) setLoadError/);
});
