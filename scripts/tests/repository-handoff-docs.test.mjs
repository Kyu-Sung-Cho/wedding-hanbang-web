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

  // 최신 세션 기록이 기준 문서 목록에 없으면 다음 세션이 그 존재를 모른다
  // (2026-07-27 실측: LAUNCH_PREP_SESSION_2026-07-26.md가 어느 쪽에도 없었다).
  assert.match(agents, /docs\/operations\/LAUNCH_PREP_SESSION_2026-07-26\.md/);
  // 공시 원본이 어느 라운드에서 왔는지 기록이 없으면 화면의 기준 시점을 대조할 수 없다.
  assert.match(agents, /docs\/operations\/DISCLOSURE_SOURCE_PROVENANCE\.md/);
  // 다른 컴퓨터에서 이어받을 때 먼저 읽을 문서. 등록만 하고 계약에 안 넣으면
  // 다음 정리 때 조용히 빠지고, 그러면 존재를 모르는 상태로 돌아간다.
  assert.match(agents, /docs\/operations\/SESSION_HANDOFF_2026-07-28\.md/);
  // 업체 병합은 79쌍 전건을 사람 판정한 결과다. 근거 문서가 목록에서 빠지면
  // 다음 세션이 근거 없이 다시 판정하거나(오배정 위험) 이미 한 일을 반복한다.
  assert.match(agents, /docs\/operations\/VENDOR_MERGE_REVIEW_2026-07-27\.md/);

  for (const document of [agents, readme]) {
    assert.match(document, /docs\/operations\/CURRENT_WORKSPACE_HANDOFF_2026-07-20\.md/);
    assert.match(document, /scripts\/ingest\/README\.md/);
    assert.doesNotMatch(document, /현재 인수인계:[\s\S]{0,100}CURRENT_WORKSPACE_HANDOFF_2026-07-17\.md/);
    assert.doesNotMatch(document, /다른 컴퓨터 인수인계:[\s\S]{0,100}CURRENT_WORKSPACE_HANDOFF_2026-07-19\.md/);
  }
});
