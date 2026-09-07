import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

test("web and mobile both consume the shared journey realtime stream", () => {
  const webSync = source("../../../web/src/components/app/JourneyRealtimeSync.tsx");
  const webLayout = source("../../../web/src/app/(app)/layout.tsx");
  const migration = source(
    "../../../../supabase/migrations/20260630233211_enable_booking_progress_realtime.sql",
  );

  assert.match(webLayout, /<JourneyRealtimeSync\s*\/>/);
  assert.match(webSync, /table:\s*"wedding_journeys"/);
  assert.match(webSync, /filter:\s*`couple_id=eq\.\$\{coupleId\}`/);
  assert.match(webSync, /refreshJourney\(userId,\s*controller\.signal\)/);
  assert.match(
    migration,
    /ALTER PUBLICATION supabase_realtime ADD TABLE public\.wedding_journeys/,
  );

  for (const path of [
    "../../app/(tabs)/lounge.tsx",
    "../../app/budget/index.tsx",
    "../../app/schedule/index.tsx",
  ]) {
    const mobileScreen = source(path);
    assert.match(mobileScreen, /table:\s*["']wedding_journeys["']/);
    assert.match(mobileScreen, /postgres_changes/);
  }
});

test("mobile verifies the exact web and Supabase destination before session use", () => {
  const rootGate = source("../../app/index.tsx");
  const runtimeVerifier = source("../lib/mobileWebRuntime.ts");
  const contractRoute = source(
    "../../../web/src/app/api/mobile/runtime-contract/route.ts",
  );

  assert.ok(
    rootGate.indexOf("await verifyMobileWebRuntime")
      < rootGate.indexOf("supabase.auth.getSession"),
  );
  assert.match(runtimeVerifier, /validateMobileWebRuntimeContract/);
  assert.match(runtimeVerifier, /RUNTIME_CONTRACT_TIMEOUT_MS\s*=\s*5_000/);
  assert.match(contractRoute, /NEXT_PUBLIC_SUPABASE_URL/);
  assert.doesNotMatch(contractRoute, /SERVICE_ROLE|ANON_KEY|OPENAI|ANTHROPIC/);
});

test("profile returns with fresh web-edited identity and wedding context", () => {
  const profile = source("../../app/(tabs)/profile.tsx");

  assert.match(profile, /useFocusEffect\(/);
  assert.match(profile, /void loadProfile\(\)/);
});
