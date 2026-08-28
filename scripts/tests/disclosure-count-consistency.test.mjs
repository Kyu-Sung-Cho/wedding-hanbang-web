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

  // 2026-07-29부터 루트(`/`)가 착지하는 서비스 랜딩도 대조 대상이다.
  //
  // **말하지 않는 것은 위반이 아니다.** 2026-08-27 재작성에서 서비스 랜딩은 이 두 수를
  // 화면에서 걷어냈다 — 공시 가격이 첫 화면 자산에서 "우리가 업체 편이 아니라는 증거"
  // 곁블록으로 내려갔고, 근거 없는 수를 앞세우지 않기로 했다. 이 테스트가 지키는 것은
  // "여러 화면이 **다른** 수를 말하는 것"이지 "모든 화면이 수를 말하는 것"이 아니다.
  //
  // 그래서 선언이 있으면 대조하고, 없으면 넘어간다. 다만 **한쪽만 선언한 상태**는
  // 막는다 — 업체 수는 지웠는데 위약금 건수만 남아 있으면 그 화면은 절반의 근거로
  // 절반의 주장을 하게 된다.
  const optional = (source, pattern) => {
    const matches = [...source.matchAll(pattern)];
    assert.ok(matches.length <= 1, "서비스 랜딩이 같은 수를 두 번 선언한다");
    return matches.length === 1 ? Number(matches[0][1]) : null;
  };
  const servicePolicies = optional(servicePage, /const PUBLISHED_POLICY_COUNT = (\d+);/g);
  const serviceVendors = optional(servicePage, /const PUBLISHED_VENDOR_COUNT = (\d+);/g);

  assert.equal(
    servicePolicies === null,
    serviceVendors === null,
    "서비스 랜딩이 두 수 중 하나만 선언했다"
      + ` (위약금 ${servicePolicies}, 업체 ${serviceVendors})`
      + " — 둘 다 말하거나 둘 다 말하지 않아야 한다",
  );

  if (servicePolicies !== null) {
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
  }
});

test("서비스 랜딩이 상수 밖에서 공시 규모를 주장하지 않는다", () => {
  // 위 테스트를 "선언이 있으면 대조" 로 바꾸면서 생긴 빈틈을 막는다.
  // 상수를 지우고 본문에 숫자를 손으로 적으면 대조를 통째로 우회할 수 있다 —
  // 실제로 이 저장소에서 랜딩 406 vs 공시 허브 829 로 두 화면이 갈린 적이 있다.
  const files = [
    "apps/web/src/app/landing/page.tsx",
    "apps/web/src/components/landing/redesign/landingContent.ts",
  ];
  for (const relativePath of files) {
    const source = read(relativePath);
    // 주석은 뺀다 — 왜 숫자를 안 쓰는지 설명하려면 그 숫자를 적어야 한다.
    const copy = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const claims = [...copy.matchAll(/(\d[\d,]{2,})\s*(곳|건|개)(?![월])/g)].map((m) => m[0]);
    assert.deepEqual(
      claims,
      [],
      `${relativePath} 가 공시 규모를 손으로 적었다: ${claims.join(", ")}`
        + " — 수를 말하려면 PUBLISHED_* 상수로 선언해 대조를 받아야 한다",
    );
  }
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

  // 이 두 줄은 slug 단위 병합표(`VERIFIED_VENDOR_IDENTITY_BY_SLUG`)를 요구했다.
  // 그 큐레이션은 이름표+지점표(2026-08-05)로 대체됐으므로, 감사가 읽어야 하는 것도
  // 바뀐 표다. 없는 설계를 요구하는 단언은 계약이 아니라 잔재다.
  assert.match(
    productionAudit,
    /const SAME_BUSINESS_DIFFERENT_NAME/,
    "운영 감사가 표기 병합표를 읽지 않는다",
  );
  assert.match(
    productionAudit,
    /const VENDOR_BRANCHES/,
    "운영 감사가 지점표를 읽지 않는다",
  );
  assert.match(
    distributionAudit,
    /vendorIdentityKey\(category,\s*row\.vendor_name,\s*row\.vendor_slug\)/,
    "유통 감사가 실제 목록의 vendorIdentityKey를 호출하지 않는다",
  );
});
