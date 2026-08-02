import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const currentProductDefinition =
  "웨딩한방은 아모라에게 결혼 준비를 말하면, 예산·체크리스트·일정이 함께 정리되는 서비스입니다.";
const currentReleaseHandoffPath =
  "docs/operations/FULL_WORKSPACE_RELEASE_HANDOFF_2026-07-31.md";
const crossMachineHandoffPath =
  "docs/operations/CROSS_MACHINE_DEVELOPMENT_HANDOFF_2026-08-02.md";
const latestSupplementalHandoffPath =
  "docs/operations/SESSION_HANDOFF_2026-08-02_COMMUNITY_AND_WORKSPACE.md";
const currentReleaseInventoryPath =
  "docs/operations/evidence/full-workspace-release-inventory-2026-07-31.json";
const lazywebRunbookPath =
  "docs/operations/LAZYWEB_MCP_DESIGN_WORKFLOW_2026-08-02.md";

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalized(value) {
  return value.replace(/\s+/g, " ").trim();
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
    assert.match(document, new RegExp(escaped(currentReleaseHandoffPath)));
    assert.match(document, new RegExp(escaped(crossMachineHandoffPath)));
    assert.match(document, new RegExp(escaped(latestSupplementalHandoffPath)));
    assert.match(document, /docs\/operations\/CURRENT_WORKSPACE_HANDOFF_2026-07-20\.md/);
    assert.match(document, /scripts\/ingest\/README\.md/);
    assert.doesNotMatch(document, /현재 인수인계:[\s\S]{0,100}CURRENT_WORKSPACE_HANDOFF_2026-07-17\.md/);
    assert.doesNotMatch(document, /다른 컴퓨터 인수인계:[\s\S]{0,100}CURRENT_WORKSPACE_HANDOFF_2026-07-19\.md/);
  }
});

test("cross-machine handoff links the machine-local Lazyweb runbook without committing credentials", async () => {
  const [agents, claude, readme, docsIndex, crossMachine, lazywebRunbook] =
    await Promise.all([
      readFile(new URL("AGENTS.md", root), "utf8"),
      readFile(new URL("CLAUDE.md", root), "utf8"),
      readFile(new URL("README.md", root), "utf8"),
      readFile(new URL("docs/README.md", root), "utf8"),
      readFile(new URL(crossMachineHandoffPath, root), "utf8"),
      readFile(new URL(lazywebRunbookPath, root), "utf8"),
    ]);

  for (const document of [agents, claude, readme, docsIndex, crossMachine]) {
    assert.match(document, new RegExp(escaped(lazywebRunbookPath)));
  }

  assert.match(lazywebRunbook, /https:\/\/www\.lazyweb\.com\/mcp/);
  assert.match(lazywebRunbook, /https:\/\/github\.com\/aboul3ata\/lazyweb-skill/);
  assert.match(lazywebRunbook, /LAZYWEB_MCP_TOKEN/);
  assert.match(lazywebRunbook, /v0\.14\.9/);
  assert.match(lazywebRunbook, /MACHINE-LOCAL/);
  assert.match(crossMachine, /\/artifacts\/[\s\S]*GitHub 인계 대상이 아니다/);
  assert.match(crossMachine, /\/\.lazyweb\/[\s\S]*GitHub 인계 대상이 아니다/);

  for (const document of [crossMachine, lazywebRunbook]) {
    assert.doesNotMatch(document, /lazyweb\.com\/agent\/[0-9a-f-]{36}\.md/i);
    assert.doesNotMatch(
      document,
      /Authorization\s*:\s*Bearer\s+[A-Za-z0-9._-]{16,}/i,
    );
  }
});

test("current cross-machine handoff pins the implementation and evidence boundaries", async () => {
  const [agents, readme, docsIndex, crossMachine, fullHandoff, envExample] =
    await Promise.all([
      readFile(new URL("AGENTS.md", root), "utf8"),
      readFile(new URL("README.md", root), "utf8"),
      readFile(new URL("docs/README.md", root), "utf8"),
      readFile(new URL(crossMachineHandoffPath, root), "utf8"),
      readFile(new URL(currentReleaseHandoffPath, root), "utf8"),
      readFile(new URL("apps/web/.env.example", root), "utf8"),
    ]);

  for (const document of [agents, readme, docsIndex, crossMachine]) {
    assert.match(document, /docs\/AMORA_CONVERSATION_FOUNDATION_2026-08-01\.md/);
    assert.match(document, /docs\/AMORA_INTEGRATED_CARE_PRODUCT_SPEC_2026-07-30\.md/);
  }
  for (const document of [agents, readme, docsIndex]) {
    assert.match(
      document,
      /docs\/AMORA_NEUTRAL_COUPLE_MEMBER_MIGRATION_PROPOSAL_2026-08-02\.md/,
    );
    assert.match(document, /PLAN|제안/);
    assert.match(document, /미구현/);
  }

  for (const document of [crossMachine, fullHandoff]) {
    assert.match(document, /a617d268cdadd9d7a348222942b0f0e1851467de/);
    assert.match(document, /478 files/);
    assert.match(document, /79,766/);
    assert.match(document, /5,293/);
    assert.match(document, /41686ad60721092b6f1fd7088cb674ed5e7b43eb/);
    assert.match(document, /UNVERIFIED|증명하지 않는다/);
  }

  assert.match(crossMachine, /20\.19\.6/);
  assert.match(crossMachine, /37 scenarios/);
  assert.match(crossMachine, /19 domains/);
  assert.match(crossMachine, /externalAiCalls=0/);
  assert.match(crossMachine, /humanReviews=0/);
  assert.match(crossMachine, /liveMatrixVerified=false/);
  assert.match(crossMachine, /production artifact 2,365개 clean/);
  assert.match(crossMachine, /AMORA_EVAL_SECRET/);
  assert.match(envExample, /^AMORA_EVAL_SECRET=$/m);
});

test("current MVP source is explicit and historical briefs cannot masquerade as current", async () => {
  const [
    agents,
    readme,
    currentMvp,
    serviceOverview,
    oldMasterBrief,
    oldVendorHandoff,
  ] = await Promise.all([
    readFile(new URL("AGENTS.md", root), "utf8"),
    readFile(new URL("README.md", root), "utf8"),
    readFile(new URL("docs/MVP_PRODUCT_DIRECTION_2026-07-30.md", root), "utf8"),
    readFile(new URL("WEDDINGHANBANG_SERVICE_DOC.md", root), "utf8"),
    readFile(
      new URL("docs/WEDDINGHANBANG_MASTER_BRIEF_2026-07-29.md", root),
      "utf8",
    ),
    readFile(
      new URL(
        "docs/operations/CURRENT_WORKSPACE_HANDOFF_2026-07-20.md",
        root,
      ),
      "utf8",
    ),
  ]);

  for (const document of [readme, currentMvp, serviceOverview]) {
    assert.ok(
      normalized(document).includes(currentProductDefinition),
      "current product definition must stay exact",
    );
  }

  for (const document of [agents, readme, serviceOverview, oldMasterBrief, oldVendorHandoff]) {
    assert.match(document, /docs\/MVP_PRODUCT_DIRECTION_2026-07-30\.md/);
    assert.match(
      document,
      /docs\/operations\/CTO_TRUST_AND_WEDDINGCODE_HANDOFF_2026-07-30\.md/,
    );
  }
  for (const document of [agents, readme]) {
    assert.match(document, new RegExp(escaped(currentReleaseHandoffPath)));
  }

  assert.match(
    oldMasterBrief,
    /SUPERSEDED 2026-07-29 SNAPSHOT — NOT A CURRENT SINGLE SOURCE/,
  );
  assert.match(oldVendorHandoff, /SUPERSEDED HISTORICAL HANDOFF/);
  assert.match(
    serviceOverview,
    /LONG-TERM \/ HISTORICAL OVERVIEW — NOT THE CURRENT MVP CONTRACT/,
  );
  assert.match(agents, /과거 업체 공시 브랜치 인수인계/);
});

test("document authority chain is complete and old status claims stay historical", async () => {
  const paths = {
    agents: "AGENTS.md",
    claude: "CLAUDE.md",
    rootReadme: "README.md",
    docsIndex: "docs/README.md",
    currentRelease: currentReleaseHandoffPath,
    audit: "docs/operations/FULL_REPOSITORY_AUDIT_2026-07-30.md",
    handoff:
      "docs/operations/CTO_TRUST_AND_WEDDINGCODE_HANDOFF_2026-07-30.md",
    oldAudit: "AUDIT_2026-04-28.md",
    oldMigration: "MIGRATION_20260423_GUIDE.md",
    oldDemo: "docs/DEMO_SCRIPT_90s.md",
    oldSynthesis: "docs/SESSION_SYNTHESIS_2026-06-11.md",
    oldSession: "docs/SESSION_SYNTHESIS_2026-07-06.md",
    oldCodexSession: "docs/codex-tasks/SESSION_HANDOFF_2026-07-02.md",
    oldBacklog: "docs/BACKLOG.md",
    updateLog: "UPDATE_LOG.md",
  };
  const entries = await Promise.all(
    Object.entries(paths).map(async ([key, path]) => [
      key,
      await readFile(new URL(path, root), "utf8"),
    ]),
  );
  const documents = Object.fromEntries(entries);
  const auditPath =
    "docs/operations/FULL_REPOSITORY_AUDIT_2026-07-30.md";

  for (const document of [
    documents.agents,
    documents.claude,
    documents.rootReadme,
    documents.docsIndex,
  ]) {
    assert.match(
      document,
      new RegExp(escaped(currentReleaseHandoffPath)),
    );
    assert.match(document, new RegExp(escaped(crossMachineHandoffPath)));
    assert.match(document, new RegExp(escaped(latestSupplementalHandoffPath)));
  }

  assert.match(documents.currentRelease, new RegExp(escaped(crossMachineHandoffPath)));
  assert.match(
    documents.currentRelease,
    new RegExp(escaped(latestSupplementalHandoffPath)),
  );

  for (const document of [
    documents.agents,
    documents.claude,
    documents.docsIndex,
    documents.handoff,
  ]) {
    assert.match(document, new RegExp(escaped(auditPath)));
  }

  assert.ok(
    normalized(documents.currentRelease).includes(currentProductDefinition),
  );
  assert.match(
    documents.currentRelease,
    /GitHub[\s\S]*PUSHED \/ DRAFT PR[\s\S]*pull\/79/,
  );
  assert.match(
    documents.currentRelease,
    /Production Web[\s\S]*READY[\s\S]*0f84665e9b8828f30e5a83ca5854ef618c3f4518/,
  );
  assert.match(
    documents.currentRelease,
    /New worktree[\s\S]*PREVIEW READY \/ PRODUCTION BLOCKED[\s\S]*wedding-hanbang-web-git-agent-release-handoff-20260731-hanbang\.vercel\.app/,
  );
  assert.match(
    documents.currentRelease,
    /REMOTE RELEASE CANDIDATE \/ PROTECTED PREVIEW \/ PRODUCTION DB NO-GO/,
  );
  assert.match(
    documents.currentRelease,
    /마지막 code\/config 검증 commit: `a66da0d8857e75eb404a7b9a34ff1069b6be889e`/,
  );
  assert.match(
    documents.currentRelease,
    /62f2035c3a1d7eaa668472a46be496432138ad64[\s\S]*461 files \/ 3,948 tests PASS/,
  );
  const freshCloneBlocks = [
    ...documents.currentRelease.matchAll(
      /git clone https:\/\/github\.com\/Kyu-Sung-Cho\/wedding-hanbang-web\.git[\s\S]*?git status --short --branch/g,
    ),
  ];
  assert.equal(freshCloneBlocks.length, 3);
  for (const [block] of freshCloneBlocks) {
    assert.ok(
      block.indexOf("git switch --track origin/agent/release-handoff-20260731")
        < block.indexOf("corepack pnpm install --frozen-lockfile"),
    );
  }
  assert.match(
    documents.currentRelease,
    /vercel link --project wedding-hanbang-web --scope hanbang --yes/,
  );
  assert.match(documents.currentRelease, /Database[\s\S]*BLOCKED/);
  assert.match(documents.currentRelease, /Community[\s\S]*NO-GO/);
  assert.match(documents.currentRelease, /Mobile[\s\S]*NOT RELEASED/);
  assert.match(
    documents.currentRelease,
    /16개 migration은 최초 통합 snapshot 직전에는 untracked source였고[\s\S]*현재 후보[\s\S]*04f0ea16[\s\S]*운영 DB에는 적용되지 않았다/,
  );
  assert.match(
    documents.currentRelease,
    /최초 snapshot의 tracked 삭제 46개[\s\S]*clean clone의[\s\S]*git status[\s\S]*나타나지 않는다/,
  );
  assert.match(
    documents.currentRelease,
    /Expo Web 정적 export를 올리는 공식 외부 preview 경로는 아직 없다[\s\S]*root Vercel project[\s\S]*배포하지 않는다/,
  );
  for (const path of [
    currentReleaseInventoryPath,
    "docs/operations/SUCCESSOR_SUPABASE_RELEASE_CONTROLLER_2026-07-31.md",
    "docs/operations/COMMUNITY_PRODUCTION_RELEASE_GATE_2026-07-31.md",
    "docs/operations/VENDOR_DISCLOSURE_PRODUCTION_BUILD_FENCE.md",
  ]) {
    assert.match(documents.currentRelease, new RegExp(escaped(path)));
  }

  assert.ok(normalized(documents.audit).includes(currentProductDefinition));
  assert.match(documents.audit, /NOT COMMITTED \/ NOT PUSHED \/ NOT DEPLOYED/);
  assert.match(documents.audit, /모든 줄을 사람이 같은 깊이로 의미 검토했다.*뜻이 아니다/);
  for (const document of [documents.audit, documents.handoff]) {
    assert.match(document, /SUPERSEDED FOR CURRENT RELEASE STATUS/);
    assert.match(
      document,
      new RegExp(escaped(currentReleaseHandoffPath)),
    );
  }
  assert.match(documents.docsIndex, /현재 권한 순서/);
  assert.match(documents.docsIndex, /HISTORICAL.*SUPERSEDED/);
  assert.match(documents.claude, /P6/);
  assert.ok(normalized(documents.claude).includes(currentProductDefinition));
  assert.doesNotMatch(documents.claude, /최상위 전략 문서|cancel_booking/);
  assert.doesNotMatch(
    documents.claude,
    /모든 AI (호출|대화).*(원문|전체).*기록|모든 결정.*기록/,
  );

  assert.match(documents.oldAudit, /SUPERSEDED HISTORICAL AUDIT/);
  assert.match(documents.oldMigration, /역사 기록 \/ 실행 금지/);
  assert.match(documents.oldDemo, /역사 기록 \/ 현재 데모에 사용 금지/);
  assert.match(documents.oldSynthesis, /SUPERSEDED HISTORICAL HANDOFF/);
  assert.match(documents.oldSession, /SUPERSEDED HISTORICAL SESSION RECORD/);
  assert.match(documents.oldCodexSession, /SUPERSEDED HISTORICAL HANDOFF/);
  assert.match(documents.oldBacklog, /역사 백로그 \/ 현재 우선순위 아님/);
  assert.match(documents.updateLog, /과거 배포 기록/);
});

test("current release inventory is exhaustive, minimal, and fail-closed", async () => {
  const inventory = JSON.parse(
    await readFile(new URL(currentReleaseInventoryPath, root), "utf8"),
  );

  assert.equal(inventory.schemaVersion, 1);
  assert.equal(inventory.basis.command, "git status --porcelain=v1 -uall");
  assert.equal(
    inventory.basis.baseHead,
    "0f84665e9b8828f30e5a83ca5854ef618c3f4518",
  );
  assert.equal(inventory.basis.originMain, inventory.basis.baseHead);
  assert.equal(inventory.basis.branch, "agent/release-handoff-20260731");
  assert.equal(inventory.entries.length, inventory.basis.entryCount);
  assert.ok(inventory.entries.length > 500);

  const allowedKeys = [
    "area",
    "intentStatus",
    "path",
    "releaseFacet",
    "status",
    "verificationStatus",
  ];
  const paths = new Set();
  for (const entry of inventory.entries) {
    assert.deepEqual(Object.keys(entry).sort(), allowedKeys);
    assert.ok([" M", " D", "??"].includes(entry.status));
    assert.ok(entry.path.length > 0);
    assert.ok(entry.area.length > 0);
    assert.ok(entry.releaseFacet.length > 0);
    assert.ok(["confirmed", "review_required"].includes(entry.intentStatus));
    assert.ok(entry.verificationStatus.length > 0);
    assert.ok(!paths.has(entry.path), `duplicate inventory path: ${entry.path}`);
    paths.add(entry.path);
  }

  const trackedDeletions = inventory.entries.filter(
    (entry) => entry.status === " D",
  );
  assert.equal(trackedDeletions.length, 46);
  assert.ok(
    trackedDeletions.every(
      (entry) => entry.intentStatus === "review_required",
    ),
  );
  for (const path of [currentReleaseHandoffPath, currentReleaseInventoryPath]) {
    assert.ok(paths.has(path), `inventory must include ${path}`);
  }
});

// 스크립트가 요구하는 환경변수가 `.env.example`에 없으면, 새 컴퓨터에서 예시 파일을
// 복사한 사람은 무엇을 채워야 하는지 알 수 없다. 2026-07-28 실측:
// `SUPABASE_ACCESS_TOKEN`이 10개 파일에서 쓰이는데 예시에는 없어서
// `pnpm audit:production`이 "키가 없다"로 죽고 원인을 안내하지 못했다.
// CLAUDE.md가 `.env.example`을 환경변수의 정본으로 지정하므로 그 계약을 지킨다.
test("운영 스크립트가 요구하는 env 키가 .env.example에 문서화돼 있다", async () => {
  const [example, audit, amoraEval] = await Promise.all([
    readFile(new URL("apps/web/.env.example", root), "utf8"),
    readFile(new URL("scripts/audit/production-readiness-audit.mjs", root), "utf8"),
    readFile(new URL("scripts/amora-conversation-eval.mjs", root), "utf8"),
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
  assert.match(example, /^AMORA_EVAL_SECRET=$/m);
  assert.match(amoraEval, /AMORA_EVAL_SECRET must be set to at least 32 characters/);
});
