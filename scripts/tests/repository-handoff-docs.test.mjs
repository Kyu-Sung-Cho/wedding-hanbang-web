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
  // 상세 작업 기록. 인계 문서는 방향만 주므로, 근거·판정 이유를 다시 파야 할 때
  // 이 문서가 없으면 같은 조사를 처음부터 반복하게 된다.
  assert.match(agents, /docs\/operations\/WORK_LOG_2026-07-27_28\.md/);
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

// 스크립트가 요구하는 환경변수가 `.env.example`에 없으면, 새 컴퓨터에서 예시 파일을
// 복사한 사람은 무엇을 채워야 하는지 알 수 없다. 2026-07-28 실측:
// `SUPABASE_ACCESS_TOKEN`이 10개 파일에서 쓰이는데 예시에는 없어서
// `pnpm audit:production`이 "키가 없다"로 죽고 원인을 안내하지 못했다.
// CLAUDE.md가 `.env.example`을 환경변수의 정본으로 지정하므로 그 계약을 지킨다.
test("운영 스크립트가 요구하는 env 키가 .env.example에 문서화돼 있다", async () => {
  const [example, audit] = await Promise.all([
    readFile(new URL("apps/web/.env.example", root), "utf8"),
    readFile(new URL("scripts/audit/production-readiness-audit.mjs", root), "utf8"),
  ]);
  // 앱 런타임이 아니라 **스크립트**가 요구하는 키들. 빠지면 새 컴퓨터에서 막힌다.
  for (const key of ["SUPABASE_ACCESS_TOKEN", "SUPABASE_SERVICE_ROLE_KEY"]) {
    assert.match(
      example,
      new RegExp(`^${key}=`, "m"),
      `${key}가 .env.example에 없다 — 새 컴퓨터에서 무엇을 채울지 알 수 없다`,
    );
  }
  assert.match(
    audit,
    /SUPABASE_ACCESS_TOKEN/,
    "감사 스크립트가 더 이상 그 키를 쓰지 않으면 이 계약을 갱신할 것",
  );
});
