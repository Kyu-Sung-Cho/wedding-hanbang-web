import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";
import { bindExpectedMutationActorHeaders } from "../lib/mutationActorHeaders.mjs";

const CONTRACT = {
  version: "2",
  versionHeader: "X-Hanbang-Mutation-Contract-Version",
  actorHeader: "X-Hanbang-Expected-Actor-User-Id",
};
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

test("expected-user transport injects the canonical v2 actor pair", () => {
  const headers = bindExpectedMutationActorHeaders(
    { Accept: "application/json" },
    USER_A,
    CONTRACT,
  );

  assert.equal(headers.get("Accept"), "application/json");
  assert.equal(headers.get(CONTRACT.versionHeader), CONTRACT.version);
  assert.equal(headers.get(CONTRACT.actorHeader), USER_A);
});

test("matching caller headers are canonicalized but cannot override the expected owner", () => {
  const headers = bindExpectedMutationActorHeaders(
    {
      [CONTRACT.versionHeader]: "2",
      [CONTRACT.actorHeader]: USER_A.toUpperCase(),
    },
    USER_A,
    CONTRACT,
  );

  assert.equal(headers.get(CONTRACT.actorHeader), USER_A);
  assert.throws(
    () => bindExpectedMutationActorHeaders(
      {
        [CONTRACT.versionHeader]: "2",
        [CONTRACT.actorHeader]: USER_B,
      },
      USER_A,
      CONTRACT,
    ),
    /API_MUTATION_ACTOR_HEADER_MISMATCH/u,
  );
  assert.throws(
    () => bindExpectedMutationActorHeaders(
      { [CONTRACT.versionHeader]: "1" },
      USER_A,
      CONTRACT,
    ),
    /API_MUTATION_ACTOR_HEADER_MISMATCH/u,
  );
  assert.throws(
    () => bindExpectedMutationActorHeaders(undefined, "not-a-user-id", CONTRACT),
    /API_MUTATION_ACTOR_HEADER_MISMATCH/u,
  );
});

test("apiFetchForExpectedUser owns actor injection for every caller", () => {
  const apiSource = readFileSync(
    new URL("../lib/api.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    apiSource,
    /apiFetchForExpectedUser[\s\S]{0,500}bindExpectedMutationActorHeaders/u,
  );
  assert.match(apiSource, /HANBANG_MUTATION_CONTRACT_VERSION_HEADER/u);
  assert.match(apiSource, /HANBANG_EXPECTED_ACTOR_USER_ID_HEADER/u);
});
