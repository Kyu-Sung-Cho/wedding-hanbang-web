// 위약금 공시 규모(건수·업체수)가 여러 파일에 하드코딩돼 있다.
//
// 분기마다 공시가 갱신되면 이 값들이 함께 바뀌어야 한다. 하나만 고치면
// ① 첫 화면이 DB와 다른 숫자를 사용자에게 주장하고
// ② 운영 점검 스크립트가 같은 순간에 FAIL한다.
// 어느 쪽도 조용히 일어나면 안 되므로 세 곳을 한 테스트로 묶는다.
//
// 값을 갱신할 때는 반드시 `pnpm audit:production`으로 실제 DB 수치를 먼저 확인한다.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const read = (relativePath) => readFileSync(join(REPO_ROOT, relativePath), "utf8");

function single(source, pattern, label) {
  const matches = [...source.matchAll(pattern)];
  assert.equal(matches.length, 1, `${label}: 정확히 한 곳에서 선언돼야 한다 (발견 ${matches.length})`);
  return Number(matches[0][1]);
}

test("첫 화면·공시 허브·운영 점검이 같은 공시 규모를 말한다", () => {
  const landing = read("apps/web/src/components/community/CommunityLandingClient.tsx");
  const priceHub = read("apps/web/src/app/price/page.tsx");
  const servicePage = read("apps/web/src/app/landing/page.tsx");
  const audit = read("scripts/audit/production-readiness-audit.mjs");

  const landingVendors = single(
    landing,
    /const PUBLISHED_VENDOR_COUNT = (\d+);/g,
    "랜딩 업체 수",
  );
  const landingPolicies = single(
    landing,
    /const PUBLISHED_POLICY_COUNT = (\d+);/g,
    "랜딩 위약금 건수",
  );
  const hubPolicies = single(
    priceHub,
    /const PUBLISHED_POLICY_COUNT = (\d+);/g,
    "공시 허브 위약금 건수",
  );
  const auditPolicies = single(
    audit,
    /Number\(counts\.policies\) === (\d+)/g,
    "감사 위약금 건수",
  );
  // 업체 수는 **DB 행 수와 다른 수량**이다. `count(distinct vendor_id)`는 502지만
  // 같은 샵이 대행사별로 여러 행에 들어와 있고 목록은 한 카드로 묶는다.
  // 2026-07-26~30 첫 화면이 502를 주장해 실제(414)보다 약 21% 부풀어 있었는데,
  // 예전 이 테스트는 두 값이 **같아야 한다**고 봐서 오히려 틀린 값을 고정하고 있었다.
  // 이제는 감사가 화면 기준으로 대조하는지만 확인하고, 값 자체의 검증은
  // DB를 볼 수 있는 `audit:production`(=== 1-c ===)에 맡긴다.
  const auditVendorRows = single(
    audit,
    /Number\(counts\.policy_vendors\) === (\d+)/g,
    "감사 vendor 행 수",
  );
  assert.ok(
    auditVendorRows >= landingVendors,
    `vendor 행 수(${auditVendorRows})가 화면 업체 수(${landingVendors})보다 적을 수 없다`
    + " — 병합은 행을 줄이지 늘리지 않는다",
  );
  assert.match(
    audit,
    /=== 1-c\. 공시 규모 표기 \(화면 기준\) ===/,
    "감사에 화면 기준 대조 구간이 없다 — 첫 화면 숫자가 틀려도 아무도 모른다",
  );
  // 감사가 첫 화면 파일을 실제로 읽어 그 상수를 꺼내는지 본다. 값을 베껴 두면
  // 첫 화면이 바뀌어도 감사는 옛 값과 비교하게 되어 대조가 무의미해진다.
  assert.ok(
    audit.includes("CommunityLandingClient.tsx") && audit.includes("PUBLISHED_VENDOR_COUNT"),
    "감사가 첫 화면의 업체 수를 읽지 않는다 — 대조가 성립하지 않는다",
  );

  assert.equal(
    landingPolicies,
    auditPolicies,
    `위약금 건수 불일치: 첫 화면 ${landingPolicies} vs 감사 ${auditPolicies}`,
  );
  assert.equal(
    hubPolicies,
    auditPolicies,
    `위약금 건수 불일치: 공시 허브 ${hubPolicies} vs 감사 ${auditPolicies}`,
  );

  // 2026-07-29부터 루트(`/`)가 착지하는 서비스 랜딩도 같은 두 숫자를 말한다.
  // 표면이 하나 늘었으니 대조 대상도 함께 늘린다 — 안 그러면 이 페이지만
  // 조용히 옛 값을 주장하게 된다.
  const servicePolicies = single(
    servicePage,
    /const PUBLISHED_POLICY_COUNT = (\d+);/g,
    "서비스 랜딩 위약금 건수",
  );
  const serviceVendors = single(
    servicePage,
    /const PUBLISHED_VENDOR_COUNT = (\d+);/g,
    "서비스 랜딩 업체 수",
  );
  assert.equal(
    servicePolicies,
    auditPolicies,
    `위약금 건수 불일치: 서비스 랜딩 ${servicePolicies} vs 감사 ${auditPolicies}`,
  );
  assert.equal(
    serviceVendors,
    landingVendors,
    `업체 수 불일치: 서비스 랜딩 ${serviceVendors} vs 첫 화면 ${landingVendors}`,
  );
});

test("업체 수는 위약금 공시 업체로만 쓴다", () => {
  const landing = read("apps/web/src/components/community/CommunityLandingClient.tsx");
  const vendorCount = single(landing, /const PUBLISHED_VENDOR_COUNT = (\d+);/g, "랜딩 업체 수");

  // 이 숫자는 `count(distinct vendor_id) from v_public_vendor_policies`다.
  // 가격을 공개한 업체는 이보다 많으므로, 이 수에 기본가·추가금까지 묶어
  // "N곳의 기본가·추가금·위약금"이라고 주장하면 틀린 문장이 된다.
  const claimsAllThreeOnVendorCount = new RegExp(
    `\\$\\{PUBLISHED_VENDOR_COUNT[^}]*\\}곳의[^\`]*기본가`,
  ).test(landing);

  assert.equal(
    claimsAllThreeOnVendorCount,
    false,
    "위약금 공시 업체 수에 기본가·추가금을 함께 붙여 주장하고 있다"
      + " — 가격 공개 업체 수는 이보다 많다",
  );
  assert.ok(vendorCount > 0);
});

test("운영·유통 감사도 행 단위 검증 신원을 카드 수에 반영한다", () => {
  const productionAudit = read("scripts/audit/production-readiness-audit.mjs");
  const distributionAudit = read("scripts/audit/distribution-claims-audit.mjs");

  assert.match(
    productionAudit,
    /VERIFIED_VENDOR_IDENTITY_BY_SLUG/,
    "운영 감사가 row-scoped slug 병합표를 읽지 않는다",
  );
  assert.match(
    productionAudit,
    /verifiedRowIdentity/,
    "운영 감사가 각 vendor slug의 검증 신원을 카드 키보다 먼저 적용하지 않는다",
  );
  assert.match(
    distributionAudit,
    /vendorIdentityKey\(category,\s*row\.vendor_name,\s*row\.vendor_slug\)/,
    "유통 감사가 실제 목록의 vendorIdentityKey를 호출하지 않는다",
  );
});
