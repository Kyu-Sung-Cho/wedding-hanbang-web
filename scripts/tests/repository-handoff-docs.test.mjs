import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("repository handoff docs describe the current monorepo and release source of truth", async () => {
  const [agents, readme, webPackage] = await Promise.all([
    readFile(new URL("AGENTS.md", root), "utf8"),
    readFile(new URL("README.md", root), "utf8"),
    readFile(new URL("apps/web/package.json", root), "utf8").then(JSON.parse),
  ]);

  const nextMajor = String(webPackage.dependencies.next).match(/\d+/)?.[0];
  assert.ok(nextMajor, "Next.js major version must be detectable");
  assert.match(agents, new RegExp(`Next\\.js ${nextMajor}`));
  assert.doesNotMatch(agents, /Next\.js 14|lib\/ai\/Codex\.ts|hanbang-web\//);

  for (const path of [
    "apps/web",
    "apps/mobile",
    "packages/shared",
    "DESIGN.md",
    "docs/AMORA_ENGINE_V2_2026-07-16.md",
    "docs/operations/AMORA_ENGINE_V2_PRODUCTION_RELEASE_2026-07-16.md",
  ]) {
    assert.match(agents, new RegExp(escaped(path)));
    assert.match(readme, new RegExp(escaped(path)));
  }

  assert.match(readme, /pnpm qa:local/);
  assert.match(readme, /supabase:release:apply/);
  assert.match(readme, /직접.*db push|db push.*직접/i);

  for (const document of [agents, readme]) {
    assert.match(document, /docs\/operations\/CURRENT_WORKSPACE_HANDOFF_2026-07-20\.md/);
    assert.match(document, /scripts\/ingest\/README\.md/);
    assert.doesNotMatch(document, /현재 인수인계:[\s\S]{0,100}CURRENT_WORKSPACE_HANDOFF_2026-07-17\.md/);
    assert.doesNotMatch(document, /다른 컴퓨터 인수인계:[\s\S]{0,100}CURRENT_WORKSPACE_HANDOFF_2026-07-19\.md/);
  }
});
