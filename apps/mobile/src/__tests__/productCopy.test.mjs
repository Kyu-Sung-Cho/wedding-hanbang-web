import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const ACTIVE_PRODUCT_SOURCES = [
  "app/(auth)/login.tsx",
  "app/(tabs)/dashboard.tsx",
  "app/onboarding/index.tsx",
].map((relativePath) => readFileSync(
  fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)),
  "utf8",
));

test("active mobile journeys avoid perfection promises", () => {
  const published = ACTIVE_PRODUCT_SOURCES.join("\n");

  assert.doesNotMatch(published, /완벽한\s*(결혼|준비)/);
  assert.match(published, /우리답게 결혼을 준비하세요/);
  assert.match(published, /막막한 결혼 준비, 함께 풀어가요/);
});
