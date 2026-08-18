import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const source = await readFile(
  new URL("../components/common/AmoraSourceDisclosureView.tsx", import.meta.url),
  "utf8",
);

test("source disclosure is a compact accessible text contract rather than color-only authority", () => {
  assert.match(source, /disclosure\.badgeLabel/);
  assert.match(source, /disclosure\.statusLabel/);
  assert.match(source, /disclosure\.commercialRelationshipLabel/);
  assert.match(source, /disclosure\.checkedAtLabel/);
  assert.match(source, /disclosure\.limitation/);
  assert.match(source, /accessibilityLabel/);
  assert.match(source, /rankingPolicy !== "disclosure_only"/);
  assert.doesNotMatch(source, /onPress|Pressable|router|navigation/);
});
