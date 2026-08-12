import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath, URL } from "node:url";

const source = readFileSync(fileURLToPath(new URL(
  "../../app/settings/index.tsx",
  import.meta.url,
)), "utf8");

test("mobile settings reads the invite code only for its captured account", () => {
  assert.match(
    source,
    /apiFetchForExpectedUser\(user\.id, "\/api\/couple\/code"/u,
  );
  assert.match(
    source,
    /\[HANBANG_MUTATION_CONTRACT_VERSION_HEADER\]: HANBANG_MUTATION_CONTRACT_VERSION/u,
  );
  assert.match(
    source,
    /\[HANBANG_EXPECTED_ACTOR_USER_ID_HEADER\]: user\.id/u,
  );
  assert.match(
    source,
    /loadToken\.isCurrent\(\) && responseOwner\?\.id === user\.id/u,
  );
});
