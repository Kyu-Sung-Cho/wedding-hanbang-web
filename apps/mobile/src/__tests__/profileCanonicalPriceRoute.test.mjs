import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

const profileUrl = new URL("../../app/(tabs)/profile.tsx", import.meta.url);

test("profile exposes one canonical official vendor discovery entry", async () => {
  const source = await readFile(profileUrl, "utf8");
  assert.equal((source.match(/pathname: "\/market-prices"/g) ?? []).length, 1);
  assert.equal((source.match(/label="업체 탐색"/g) ?? []).length, 1);
  assert.doesNotMatch(source, /label="시세 정보"/);
});
