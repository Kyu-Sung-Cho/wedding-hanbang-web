#!/usr/bin/env node
// 유통 글이 주장하는 숫자를 **지금 라이브 화면과** 대조한다.
//
// 왜 필요한가: 이 저장소가 반복해서 밟은 함정이 "글의 약속과 도착 화면이 어긋나는
// 것"이다. 유통 글은 2026-06-12에 쓰였고 그 뒤 제품이 여러 번 바뀌었는데 글은 그대로였다.
// 2026-07-29 전수 대조에서 5건이 나왔고 그중 둘은 세어 보면 바로 들키는 종류였다
// (스튜디오 313 → 실제 297, 드레스 215 → 실제 205). 502→414 사고와 같은 자리다.
//
// 이 스크립트가 잡는 것:
//   1. 카테고리별 업체 수 주장 vs 공개 카탈로그 실측
//   2. 위약금 원문 건수·업체 수 주장 vs 코드 상수(화면이 쓰는 값)
//   3. 공시 기준 시점 주장 vs DISCLOSURE_ROUND
//   4. 도착 URL이 실제 라우트에 존재하는지 (next.config 리다이렉트 포함)
//   5. 이미 제거된 기능을 약속하는 문구 (예: /check가 평균가를 보여준다)
//
// 잡지 못하는 것: 참가격 **공표 평균가**(중위가 292/350/240 등). 우리 DB에 없는
// 외부 통계라 대조할 원본이 없다. 그건 사람이 참가격 게시판에서 확인해야 한다 —
// 문서 §4 체크리스트에 그렇게 적어 두었다. 여기서 조용히 통과시키지 않고 명시적으로
// "사람 확인 필요"로 출력한다.
//
// 읽기 전용이다. 공개 뷰(anon)만 조회하고 아무것도 쓰지 않는다.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relativePath) => readFileSync(join(REPO_ROOT, relativePath), "utf8");

const DOC_PATH = "docs/DISTRIBUTION_POSTS_READY_2026-06-12.md";

const failures = [];
const warnings = [];
const passes = [];

function check(ok, label, detail) {
  if (ok) passes.push(`${label} — ${detail}`);
  else failures.push(`${label} — ${detail}`);
}

// ---------- 1. 코드 상수 (화면이 실제로 쓰는 값) ----------

function singleNumber(source, pattern, label) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    failures.push(`${label}: 정확히 한 번 선언돼야 한다 (발견 ${matches.length})`);
    return null;
  }
  return Number(matches[0][1]);
}

const priceHub = read("apps/web/src/app/price/page.tsx");
const period = read("apps/web/src/lib/price/period.ts");

const policyCount = singleNumber(
  priceHub,
  /const PUBLISHED_POLICY_COUNT = (\d+);/g,
  "공시 허브 위약금 건수",
);
const disclosureRound = /export const DISCLOSURE_ROUND = "([\d-]+)";/.exec(period)?.[1] ?? null;
const roundLabel = disclosureRound
  ? `${disclosureRound.slice(0, 4)}년 ${Number(disclosureRound.slice(5))}월`
  : null;

const landing = read("apps/web/src/components/community/CommunityLandingClient.tsx");
const vendorCount = singleNumber(
  landing,
  /const PUBLISHED_VENDOR_COUNT = (\d+);/g,
  "첫 화면 업체 수",
);

const doc = read(DOC_PATH);

// ---------- 2. 라이브 카탈로그 실측 ----------

const CATEGORY_LABELS = { studio: "스튜디오", dress: "드레스", makeup: "메이크업", hall: "웨딩홀" };

async function loadLiveCounts() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 목록 카드와 같은 병합 규칙을 쓴다. 규칙이 갈리면 이 대조 자체가 거짓말이 된다.
  const { vendorIdentityKey } = await import(
    // package script가 tsx로 실행하므로 목록과 같은 공개 함수를 그대로 쓴다.
    // 규칙을 이 파일에 다시 쓰면 row-scoped slug 병합이 추가될 때 즉시 갈린다.
    "../../apps/web/src/lib/price/vendorIdentity.ts"
  ).catch(() => ({}));
  if (!vendorIdentityKey) return "no-ts-loader";

  const rows = [];
  const PAGE = 200;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("v_public_official_prices")
      .select("vendor_slug, vendor_name, price_category")
      .eq("source", "kca_tprice")
      .eq("is_current", true)
      .not("vendor_id", "is", null)
      .order("vendor_name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`공개 카탈로그 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }

  const seen = new Map();
  for (const row of rows) {
    const category = row.price_category === "venue" ? "hall" : row.price_category;
    if (!CATEGORY_LABELS[category] || !row.vendor_name || !row.vendor_slug) continue;
    const key = vendorIdentityKey(category, row.vendor_name, row.vendor_slug);
    if (!seen.has(category)) seen.set(category, new Set());
    seen.get(category).add(key);
  }

  return Object.fromEntries(
    Object.keys(CATEGORY_LABELS).map((category) => [category, seen.get(category)?.size ?? 0]),
  );
}

// ---------- 3. 대조 ----------

// (a) 위약금 건수·업체 수
for (const [claimed, expected, label] of [
  [/위약금[^\n]*?(\d{3,4})건/g, policyCount, "위약금 원문 건수"],
  [/(\d{3,4})개 업체 \d{3,4}건/g, vendorCount, "위약금 공시 업체 수"],
]) {
  if (expected === null) continue;
  const found = [...doc.matchAll(claimed)].map((m) => Number(m[1]));
  const wrong = [...new Set(found)].filter((value) => value !== expected);
  check(
    wrong.length === 0,
    label,
    wrong.length === 0
      ? `글의 주장이 전부 ${expected}과 일치`
      : `글이 ${wrong.join(", ")}이라고 주장 · 화면은 ${expected}`,
  );
}

// (b) 공시 기준 시점 — 우리 데이터를 가리키는 문장에만 적용한다.
if (roundLabel) {
  // 출처 문단은 줄바꿈을 넘어간다 — `[^\n]`으로 잡으면 값이 있는데도 못 찾는다.
  const claimsOurData = /우리 사이트가 보여주는 것[\s\S]{0,160}?\*\*(\d{4})년 (\d{1,2})월\*\*/.exec(doc);
  const ok = claimsOurData
    && `${claimsOurData[1]}년 ${Number(claimsOurData[2])}월` === roundLabel;
  check(
    Boolean(ok),
    "공시 기준 시점",
    ok
      ? `글과 화면 모두 ${roundLabel}`
      : `화면은 ${roundLabel} — 글의 출처 문단에서 우리 데이터 시점을 찾지 못했거나 다르다`,
  );
}

// (c) 이미 제거된 기능을 약속하지 않는가
const quoteCheckLib = read("apps/web/src/lib/amora/quoteCheck.ts");
const medianStubbed = /return \{\s*median: 0,/.test(quoteCheckLib);
if (medianStubbed) {
  // `/check` 링크가 붙은 문단에서 평균가를 약속하면 도착 화면과 어긋난다.
  const checkParagraphs = doc
    .split(/\n\s*\n/)
    .filter((block) => block.includes("hanbang.ai/check"));
  const lying = checkParagraphs.filter((block) => /평균가|중위가/.test(block));
  check(
    lying.length === 0,
    "/check 약속",
    lying.length === 0
      ? "평균가를 약속하지 않는다 (제품에서 제거된 기능)"
      : `평균가를 약속하는 문단 ${lying.length}개 — quoteCheck의 기준가는 stub(median 0)이다`,
  );
}

// (d) 아모라 접근성 문구
const amoraBlocks = doc
  .split(/\n\s*\n/)
  .filter((block) => block.includes("hanbang.ai/wedding"));
const openAccessLies = amoraBlocks.filter(
  (block) => /열어뒀|무료 시작/.test(block) && !/가입/.test(block),
);
check(
  openAccessLies.length === 0,
  "아모라 접근 조건",
  openAccessLies.length === 0
    ? "가입 필요를 숨기지 않는다"
    : `가입 없이 쓸 수 있는 것처럼 읽히는 문단 ${openAccessLies.length}개`,
);

// (e) 도착 경로가 실제로 존재하는가
const nextConfig = read("apps/web/next.config.ts");
const routes = [...doc.matchAll(/hanbang\.ai(\/[a-z0-9/-]*)\?/g)].map((m) => m[1]);
for (const route of [...new Set(routes)]) {
  const known = route === "/check"
    ? nextConfig.includes('source: "/check"')
    : route === "/wedding"
      ? nextConfig.includes('source: "/wedding"') || nextConfig.includes('destination: "/community"')
      : route.startsWith("/price");
  check(known, `도착 경로 ${route}`, known ? "라우트 존재" : "next.config·앱 라우트에서 못 찾음");
}

// (f) 카테고리별 업체 수 — 라이브 조회
let liveCounts = null;
try {
  liveCounts = await loadLiveCounts();
} catch (error) {
  warnings.push(`라이브 카탈로그 조회 실패 — 카테고리 업체 수는 대조하지 못했다: ${error.message}`);
}

if (liveCounts === null) {
  warnings.push(
    "NEXT_PUBLIC_SUPABASE_URL/ANON_KEY가 없어 카테고리 업체 수를 대조하지 못했다"
    + " (게시 전에는 반드시 채워서 다시 돌릴 것)",
  );
} else if (liveCounts === "no-ts-loader") {
  warnings.push(
    "vendorIdentity.ts를 이 런타임에서 불러오지 못해 카테고리 업체 수를 대조하지 못했다"
    + " — `corepack pnpm exec tsx scripts/audit/distribution-claims-audit.mjs`로 실행할 것",
  );
} else {
  for (const [category, label] of Object.entries(CATEGORY_LABELS)) {
    const pattern = new RegExp(`${label} (\\d{2,4})곳`, "g");
    const claims = [...new Set([...doc.matchAll(pattern)].map((m) => Number(m[1])))];
    if (claims.length === 0) continue;
    const wrong = claims.filter((value) => value !== liveCounts[category]);
    check(
      wrong.length === 0,
      `${label} 업체 수`,
      wrong.length === 0
        ? `글의 주장 ${claims.join(", ")} = 라이브 ${liveCounts[category]}`
        : `글이 ${wrong.join(", ")}곳이라고 주장 · 라이브는 ${liveCounts[category]}곳`,
    );
  }
}

// 외부 통계는 자동 대조가 불가능하다는 사실을 침묵시키지 않는다.
warnings.push(
  "참가격 공표 평균가(중위가 292/350/240/278 · 145 · 80.5 · 340 · 5.9)는 우리 DB에 없어"
  + " 자동 대조 대상이 아니다 — 사람이 참가격 게시판에서 회차와 값을 확인해야 한다",
);

// ---------- 4. 출력 ----------

console.log("\n=== 유통 글 주장 대조 ===\n");
for (const line of passes) console.log(`  ✅ ${line}`);
for (const line of warnings) console.log(`  ⚠️  ${line}`);
for (const line of failures) console.log(`  ❌ ${line}`);
console.log(
  `\n통과 ${passes.length} · 사람 확인 ${warnings.length} · 실패 ${failures.length}\n`,
);

if (failures.length > 0) {
  console.error("글의 주장이 라이브와 다르다. 고치기 전에는 게시하지 않는다.");
  process.exit(1);
}
