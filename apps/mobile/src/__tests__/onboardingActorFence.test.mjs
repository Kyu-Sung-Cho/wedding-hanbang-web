import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath, URL } from "node:url";

const source = readFileSync(fileURLToPath(new URL(
  "../../app/onboarding/index.tsx",
  import.meta.url,
)), "utf8");

test("mobile onboarding binds the entire form to its initiating account", () => {
  assert.match(source, /formOwnerUserIdRef = useRef<string \| null>\(null\)/u);
  assert.match(source, /await supabase\.auth\.getUser\(\)/u);
  assert.match(source, /supabase\.auth\.onAuthStateChange/u);
  assert.match(source, /formOwnerStillCurrentRef\.current = false/u);
  assert.match(
    source,
    /apiFetchForExpectedUser\(expectedActorUserId, "\/api\/onboarding"/u,
  );
});

test("mobile onboarding sends the rollout-safe actor headers without changing its body", () => {
  assert.match(
    source,
    /\[HANBANG_MUTATION_CONTRACT_VERSION_HEADER\]: HANBANG_MUTATION_CONTRACT_VERSION/u,
  );
  assert.match(
    source,
    /\[HANBANG_EXPECTED_ACTOR_USER_ID_HEADER\]: expectedActorUserId/u,
  );
  assert.match(source, /body: JSON\.stringify\(submissionPayload\)/u);
  const bodyStart = source.indexOf("const submissionPayload = buildOnboardingSubmissionPayload");
  const bodyEnd = source.indexOf("const res = await apiFetchForExpectedUser", bodyStart);
  assert.ok(bodyStart > 0 && bodyEnd > bodyStart);
  assert.doesNotMatch(
    source.slice(bodyStart, bodyEnd),
    /expectedActorUserId|mutationContractVersion/u,
  );
});

test("mobile onboarding fences a late response after account switching", () => {
  const responseFence = source.indexOf("const { data: { user: responseOwner } }");
  const responseRead = source.indexOf("const data = await res.json()", responseFence);
  assert.ok(responseFence > 0 && responseRead > responseFence);
  assert.match(
    source.slice(responseFence, responseRead),
    /responseOwner\?\.id !== expectedActorUserId/u,
  );
  assert.match(
    source.slice(responseFence),
    /formOwnerUserIdRef\.current !== expectedActorUserId/u,
  );
  assert.match(
    source,
    /\.start\(\(\{ finished \}\) => \{\s*if \(!finished \|\| !formOwnerStillCurrentRef\.current\) return;/u,
  );
});

test("mobile onboarding purges A and gates the form until auth, focus, and visibility reverify B", () => {
  const clearStart = source.indexOf("const clearAccountOwnedOnboardingState");
  const clearEnd = source.indexOf("const gateOnboardingUntilOwnerVerified", clearStart);
  assert.ok(clearStart > 0 && clearEnd > clearStart);
  const clearBody = source.slice(clearStart, clearEnd);
  for (const reset of [
    "setStep(1)",
    "setRole(null)",
    'setCoupleAction("create")',
    'setInviteCode("")',
    'setWeddingDate("")',
    "setWeddingDateUndecided(false)",
    'setVenue("")',
    'setBudget("")',
    'setResultCode("")',
    "setWeddingStyle(null)",
    "setPriorities([])",
    "setBudgetTendency(null)",
    "setGuestCount(null)",
  ]) {
    assert.match(clearBody, new RegExp(reset.replace(/[()[\]]/gu, "\\$&"), "u"));
  }

  assert.match(source, /useFocusEffect\([\s\S]*gateOnboardingUntilOwnerVerified\(\)[\s\S]*reconcileFormOwner\(\)/u);
  assert.match(source, /AppState\.addEventListener\("change"[\s\S]*gateOnboardingUntilOwnerVerified\(\)[\s\S]*reconcileFormOwner\(\)/u);
  assert.match(source, /onAuthStateChange[\s\S]*clearAccountOwnedOnboardingState\(\)[\s\S]*reconcileFormOwner\(\)/u);

  const safeGate = source.indexOf("if (!formOwnerReady)");
  const form = source.indexOf("<DismissKeyboard>");
  assert.ok(safeGate > 0 && form > safeGate);
  assert.match(source.slice(safeGate, form), /계정을 안전하게 확인하고 있어요/u);
});
