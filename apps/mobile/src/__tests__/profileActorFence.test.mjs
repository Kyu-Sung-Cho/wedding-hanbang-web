import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const profileSource = readFileSync(fileURLToPath(new URL(
  "../../app/(tabs)/profile.tsx",
  import.meta.url,
)), "utf8");

test("profile clears account-owned data and invalidates every A load on auth change", () => {
  assert.match(profileSource, /const profileOwnerRef = useRef<string \| null>\(null\)/u);
  assert.match(profileSource, /createLatestSettingsLoadGate\(\)/u);
  assert.match(profileSource, /supabase\.auth\.onAuthStateChange/u);
  assert.match(
    profileSource,
    /profileLoadGate\.begin\(\)[\s\S]{0,220}profileOwnerRef\.current = nextOwnerId[\s\S]{0,220}setProfile\(null\)[\s\S]{0,160}setStats\(EMPTY_ACTIVITY_STATS\)/u,
  );
});

test("a delayed A profile response commits only while canonical auth is still A", () => {
  assert.match(profileSource, /const loadToken = profileLoadGate\.begin\(\)/u);
  assert.match(
    profileSource,
    /data: \{ user: responseOwner \}[\s\S]{0,260}!loadToken\.isCurrent\(\)[\s\S]{0,180}responseOwner\?\.id !== expectedActorUserId[\s\S]{0,180}profileOwnerRef\.current !== expectedActorUserId[\s\S]{0,120}return/u,
  );
  const responseFence = profileSource.indexOf("data: { user: responseOwner }");
  assert.ok(responseFence >= 0);
  assert.ok(profileSource.indexOf("setStats({", responseFence) > responseFence);
  assert.ok(profileSource.indexOf("setProfile({", responseFence) > responseFence);
});

test("profile and settings delayed logout callbacks keep the initiating owner", () => {
  assert.match(
    profileSource,
    /function handleLogout\(\)[\s\S]{0,180}const expectedActorUserId = profileOwnerRef\.current[\s\S]{0,700}performLogout\(expectedActorUserId\)/u,
  );
  assert.match(
    profileSource,
    /await signOut\(\{ expectedOwnerId: expectedActorUserId \}\)/u,
  );
});
