#!/usr/bin/env node
/**
 * 운영 DB가 이 저장소의 코드를 감당할 수 있는지 판정한다. **읽기 전용이다.**
 *
 * 왜 필요한가. 2026-08-11에 웹 프로덕션 빌드 펜스에서 `controllerReady` 요구를 뺐다
 * (`apps/web/vendorDisclosureProductionBuildFence.ts`). 그 조건은 매니페스트 status가
 * `deployment_blocked`인 한 절대 참이 되지 않아 웹 배포를 영구히 막고 있었다. 그런데
 * 그 조건이 **우연히** 막아 주던 진짜 위험이 있었다 — 코드가 요구하는 마이그레이션이
 * 운영 DB에 없는 채로 배포되는 것. 실제로 그날 실측했더니 운영 원장 head는
 * 20260727090000이고 매니페스트가 요구하는 것 중 51건이 없었다.
 *
 * 빌드 시점에 운영 DB를 조회하는 것은 옳지 않다(네트워크·권한에 빌드를 묶는다).
 * 그래서 판정을 이 스크립트로 분리했다. 배포 서명
 * (`VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION`)을 핀하기 전에 이걸 돌린다.
 * **통과했을 때만 핀할 값을 출력한다.**
 *
 * 사용:
 *   SUPABASE_ACCESS_TOKEN=<sbp_...> node ./scripts/check-production-migration-head.mjs
 *
 * 토큰은 읽기만 하고 저장하지 않으며 출력에도 넣지 않는다.
 * 쿼리는 Management API의 `read_only: true`로 보낸다 — 쓰기는 서버가 거부한다.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_RELATIVE = "supabase/release-manifests/vendor-disclosure-v2-20260718.json";
const MIGRATION_VERSION = /^(\d{14})_/;

function fail(message) {
  console.error(`PRODUCTION_MIGRATION_HEAD_CHECK_FAILED: ${message}`);
  process.exit(1);
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token || !/^sbp_[A-Za-z0-9]{20,}$/.test(token)) {
  fail("SUPABASE_ACCESS_TOKEN이 없거나 형식이 아니다 (sbp_로 시작하는 Management API 토큰)");
}

const manifestText = readFileSync(join(repoRoot, MANIFEST_RELATIVE), "utf8");
const manifest = JSON.parse(manifestText);
const projectRef = manifest.projectRef;
if (typeof projectRef !== "string" || !/^[a-z]{20}$/.test(projectRef)) {
  fail("매니페스트의 projectRef가 유효하지 않다");
}

const required = manifest.expandMigrations.map((entry) => {
  const match = MIGRATION_VERSION.exec(entry.file);
  if (!match) fail(`매니페스트 항목의 파일명이 버전 형식이 아니다: ${entry.file}`);
  return { file: entry.file, version: match[1] };
});

const response = await fetch(
  `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
  {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "select version from supabase_migrations.schema_migrations order by version",
      read_only: true,
    }),
  },
);

if (!response.ok) {
  // 응답 본문에 토큰은 없지만, 혹시 모를 노출을 피해 상태 코드만 남긴다.
  fail(`운영 원장 조회 실패 (HTTP ${response.status})`);
}

const rows = await response.json();
if (!Array.isArray(rows)) fail("운영 원장 응답이 배열이 아니다");
const applied = new Set(rows.map((row) => row.version));
const appliedHead = [...applied].sort().at(-1) ?? "(없음)";
const missing = required.filter((entry) => !applied.has(entry.version));

console.log(`project           : ${projectRef}`);
console.log(`운영 원장 head     : ${appliedHead}`);
console.log(`운영 적용 총계     : ${applied.size}`);
console.log(`매니페스트 요구    : ${required.length} (마지막 ${required.at(-1)?.version})`);
console.log(`운영에 없는 것     : ${missing.length}`);

if (missing.length > 0) {
  console.log("");
  for (const entry of missing) console.log(`  - ${entry.file}`);
  console.log("");
  console.log("NO-GO — 이 상태로 배포하면 코드가 없는 테이블·컬럼·함수를 친다.");
  console.log("        운영 DB를 먼저 따라잡힌 뒤 다시 돌린다.");
  process.exit(1);
}

const authorization = createHash("sha256")
  .update(manifestText.replace(/\r\n?/g, "\n"), "utf8")
  .digest("hex");

console.log("");
console.log("GO — 매니페스트가 요구하는 마이그레이션이 운영에 모두 있다.");
console.log("");
console.log("Vercel Production 환경변수에 핀할 값:");
console.log(`  VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION=${authorization}`);
