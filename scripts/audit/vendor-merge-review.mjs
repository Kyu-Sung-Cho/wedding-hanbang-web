// 업체 병합 검수 — 같은 샵이 표기 차이로 갈려 있는 후보를 뽑는다.
//
// 왜 필요한가: 신원 규칙(`vendorIdentity.ts`)은 이름을 정규화해 합치는데
// `(주)·주식회사·㈜`와 공백·구두점만 지운다. 그래서 다음은 **다른 업체로 남는다**.
//   "메이"        ↔ "메이 스튜디오"      (카테고리 접미)
//   "아우라"      ↔ "[천안] 아우라"      (대괄호 지역 태그 — 정규화가 []는 안 지운다)
// 공시 원본이 대행사별 파일이라 같은 샵을 대행사마다 다르게 적는다.
//
// **자동으로 합치지 않는다.** 일부는 진짜 다른 업체다(실측: 랑게·메이든스튜디오·라망은
// 공식 채널이 달라 별개로 확인됨 → `SAME_NAME_DIFFERENT_BUSINESS`). 잘못 합치면 다른
// 가게 가격이 한 카드에 섞인다 — 이 서비스가 절대 하면 안 되는 일이다.
//
// 판정 근거로 **대행사 집합이 겹치는지**를 함께 낸다. 다만 힌트일 뿐이고 종류별로
// 기울기가 반대다(2026-07-27 실측).
//   · 카테고리 접미("메이" ↔ "메이 스튜디오") — 대행사가 완전히 분리되고 지역 표식이
//     없다. **같은 샵의 표기 차이일 가능성이 높다.**
//   · 대괄호 태그("아우라" ↔ "[천안] 아우라") — 대괄호를 쓰는 대행사는 (주)레브웨딩
//     하나뿐이고, 그 대행사는 지역 샵을 구분해 적는 관행이 있다. 즉 **지역이 다른 별개
//     샵일 가능성이 오히려 높다.** 같은 대행사가 `X`와 `[지역] X`를 둘 다 올린 2건은
//     사실상 확정이다.
//   겹침 있음 → 한 대행사가 둘 다 올렸다는 뜻이므로 다른 업체다(분리 유지).
//
// 실행: node scripts/audit/vendor-merge-review.mjs [--json]
// 비밀값이 필요 없다 — 공개 카탈로그만 읽으므로 어느 컴퓨터에서나 돌아간다.

const BASE = process.env.HANBANG_REVIEW_BASE_URL ?? "https://hanbang.ai";

/** `vendorIdentity.ts`의 normalizeVendorName과 같은 규칙이어야 한다. */
function normalizeVendorName(value) {
  return String(value ?? "")
    .replace(/\(주\)|주식회사|㈜/g, "")
    .replace(/[\s·\-_,.()]/g, "")
    .toLowerCase();
}

/** 카테고리별로 이름 끝에 붙는 중복 표기. 여기 없는 접미는 후보로 잡히지 않는다. */
const CATEGORY_SUFFIXES = {
  studio: ["스튜디오"],
  dress: ["웨딩", "브라이드", "드레스"],
  makeup: ["헤어", "메이크업"],
  hall: ["웨딩홀", "컨벤션"],
};

async function loadCatalog() {
  // 카테고리 페이지가 전체 카탈로그를 실어 보낸다(어느 페이지를 써도 같다).
  const response = await fetch(`${BASE}/price/hall`);
  if (!response.ok) throw new Error(`카탈로그를 읽지 못했다: HTTP ${response.status}`);
  const unescaped = (await response.text()).replace(/\\"/g, '"');

  const pattern = new RegExp(
    '"id":"([0-9a-f-]{36})","slug":"([a-z0-9-]+)","name":"([^"]{1,80})"'
    + '[\\s\\S]{0,40}?"category":"([a-z]+)"([\\s\\S]*?)'
    + '(?="id":"[0-9a-f-]{36}","slug":|$)',
    "g",
  );
  const bySlug = new Map();
  for (const match of unescaped.matchAll(pattern)) {
    if (bySlug.has(match[2])) continue;
    const agencies = [...new Set(
      [...match[5].matchAll(/"agencyName":"([^"]{1,60})"/g)].map((row) => row[1]),
    )];
    bySlug.set(match[2], {
      slug: match[2], name: match[3], category: match[4], agencies,
    });
  }
  if (bySlug.size === 0) throw new Error("업체를 하나도 추출하지 못했다 — 페이로드 형식이 바뀌었는지 확인할 것");
  return [...bySlug.values()];
}

function findCandidates(vendors) {
  const byCategory = new Map();
  for (const vendor of vendors) {
    if (!byCategory.has(vendor.category)) byCategory.set(vendor.category, []);
    byCategory.get(vendor.category).push(vendor);
  }

  const found = new Map();
  const add = (kind, base, variant, category) => {
    const key = [base.slug, variant.slug].sort().join("~");
    if (found.has(key)) return;
    const shared = base.agencies.filter((name) => variant.agencies.includes(name));
    found.set(key, { category, kind, base, variant, shared });
  };

  for (const [category, list] of byCategory) {
    const byNormalized = new Map(list.map((vendor) => [normalizeVendorName(vendor.name), vendor]));

    for (const vendor of list) {
      const normalized = normalizeVendorName(vendor.name);

      for (const suffix of CATEGORY_SUFFIXES[category] ?? []) {
        if (!normalized.endsWith(suffix)) continue;
        const stem = normalized.slice(0, -suffix.length);
        if (stem.length < 2) continue;
        const base = byNormalized.get(stem);
        if (base && base.slug !== vendor.slug) add("카테고리 접미", base, vendor, category);
      }

      if (/[[\]]/.test(vendor.name)) {
        const base = byNormalized.get(normalizeVendorName(vendor.name.replace(/\[[^\]]*\]/g, "")));
        if (base && base.slug !== vendor.slug) add("대괄호 태그", base, vendor, category);
      }
    }
  }
  return [...found.values()];
}

const vendors = await loadCatalog();
const candidates = findCandidates(vendors);
const mergeReview = candidates.filter((row) => row.shared.length === 0);
const keepSeparate = candidates.filter((row) => row.shared.length > 0);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ total: vendors.length, mergeReview, keepSeparate }, null, 1));
} else {
  const perCategory = {};
  for (const vendor of vendors) perCategory[vendor.category] = (perCategory[vendor.category] ?? 0) + 1;
  console.log(`\n출처: ${BASE}  ·  카드 ${vendors.length}개`);
  console.log(`  ${Object.entries(perCategory).map(([c, n]) => `${c} ${n}`).join(" · ")}`);

  console.log(`\n=== 병합 검토 대상 ${mergeReview.length}쌍 (대행사 겹침 없음) ===`);
  console.log("  원본과 공식 채널을 대조해 같은 업체인지 판정할 것. 같으면 표기를 통일하거나");
  console.log("  신원 규칙을 넓히고, 다르면 SAME_NAME_DIFFERENT_BUSINESS에 넣는다.");
  console.log("  ※ '카테고리 접미'는 같은 샵일 가능성이 높고, '대괄호 태그'는 지역이 다른");
  console.log("    별개 샵일 가능성이 높다 — 대괄호를 쓰는 대행사가 한 곳뿐이기 때문이다.");
  for (const row of mergeReview) {
    console.log(`  [${row.category}/${row.kind}] "${row.base.name}" (${row.base.agencies.join(", ") || "대행사 없음"})`);
    console.log(`      ↔ "${row.variant.name}" (${row.variant.agencies.join(", ") || "대행사 없음"})`);
  }

  console.log(`\n=== 분리 유지가 맞는 ${keepSeparate.length}쌍 (같은 대행사가 둘 다 공시) ===`);
  for (const row of keepSeparate) {
    console.log(`  [${row.category}/${row.kind}] "${row.base.name}" ↔ "${row.variant.name}"  공통: ${row.shared.join(", ")}`);
  }
  console.log("");
}
