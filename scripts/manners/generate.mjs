// 결혼 예절 안내 데이터 생성기 — parts*.json → apps/web/src/lib/manners/data.ts
//
// `data.ts`는 **손으로 고치지 않는다.** 고쳐야 하면 원본 JSON을 고치고 이 스크립트를 돌린다.
// 손으로 고치면 다음 재생성에서 조용히 사라진다.
//
// ⚠️ 2026-08-11에 재생성 과정 자체가 사고를 냈다. 부분 일치 치환이 문단을 잘라먹었고,
//    전체 필드 치환이 문단 앞부분을 통째로 날렸다. 그래서 이 스크립트는 **직렬화만** 한다 —
//    내용 수정 로직을 여기에 넣지 마라. 수정은 parts.json에서 하고 diff로 확인한다.
//
// 사용: node scripts/manners/generate.mjs [--check]
//   --check  파일을 쓰지 않고 현재 data.ts와 다른지만 알려준다(CI용).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const SOURCES = [
  path.join(here, "parts.json"),
  path.join(here, "parts-family.json"),
  path.join(here, "parts-life.json"),
];
const TARGET = path.join(repoRoot, "apps", "web", "src", "lib", "manners", "data.ts");
const SOURCE_KINDS = new Set(["official", "original", "secondary"]);

// 카테고리 = 화면의 묶음이자 파트 출력 순서. slug는 parts.json에 실재해야 한다.
// 모든 커플이 먼저 판단할 공통 흐름과 특정 선택 뒤에만 필요한 안내를 섞지 않는다.
const CATEGORIES = [
  {
    id: "common-flow",
    tier: "core",
    label: "핵심",
    description: "결혼 준비의 기본 흐름에서 먼저 판단할 인사·비용·초대·본식·행정 주제예요.",
    slugs: [
      "planning-timeline",
      "planning-conflicts",
      "first-family-visit",
      "family-meeting",
      "money-home-conversation",
      "shared-home-items",
      "cost-saving",
      "invitation-sending",
      "honeymoon-preparation",
      "wedding-day",
      "gift-money",
      "guest-manners",
      "photo-manners",
      "marriage-registration",
      "digital-manners",
    ],
  },
  {
    id: "after-wedding-life",
    tier: "lifecycle",
    label: "결혼 후 생활",
    description: "식을 마친 뒤 두 사람의 생활과 가족 관계를 차분히 맞춰 갈 때 보는 안내예요.",
    slugs: [
      "post-honeymoon-thanks",
      "first-holiday",
      "housewarming",
      "family-address",
      "family-events",
    ],
  },
  {
    id: "conditional-guides",
    tier: "situation",
    label: "해당할 때만",
    description: "전통 절차, 특정 예식 형식, 별도 역할처럼 선택한 경우에만 필요한 안내예요.",
    slugs: [
      "gifts-and-traditions",
      "traditional-greetings",
      "congratulatory-speech",
      "return-gift",
      "small-wedding",
      "religious-weddings",
    ],
  },
];

const HEADER = `import type { MannersCategory, MannersPart } from "./types";

/**
 * 결혼 예절 안내 — 공개 가이드.
 *
 * **이 파일은 생성물이다.** 고치려면 \`scripts/manners/parts*.json\`을 고치고
 * \`node scripts/manners/generate.mjs\`를 돌린다. 여기서 직접 고치면 다음 재생성에서 사라진다.
 *
 * 2026-07-17 \`84b54e9f\`가 지운 예절 코퍼스 25파트에서 정보 구조만 참고했다.
 * 원본을 그대로 되돌리지 않았다 — 원본은 금액 61건과 법률 26건을 **출처 0건**으로
 * 주장했고, 그게 삭제 사유였다.
 *
 * 수치·법률·안전 관련 주장은 근거 수준과 확인일을 붙이고,
 * \`__tests__/mannersSourceContract.test.ts\`가 데이터 계약을 강제한다.
 *
 * 가족 편차가 큰 주제는 수치·고정 역할을 버리고 실제 대화와 선택지 중심으로 썼다.
 */
`;

const j = (value) => JSON.stringify(value, null, 0);

function serialize(parts) {
  const bySlug = new Map(parts.map((part) => [part.slug, part]));
  const order = CATEGORIES.flatMap((category) => category.slugs);

  const missing = order.filter((slug) => !bySlug.has(slug));
  if (missing.length > 0) throw new Error(`MANNERS_PART_MISSING: ${missing.join(", ")}`);
  const ungrouped = parts.map((part) => part.slug).filter((slug) => !order.includes(slug));
  if (ungrouped.length > 0) throw new Error(`MANNERS_PART_UNGROUPED: ${ungrouped.join(", ")}`);

  for (const part of parts) {
    for (const [sourceIndex, source] of part.sources.entries()) {
      if (!SOURCE_KINDS.has(source.kind)) {
        throw new Error(
          `MANNERS_SOURCE_KIND_INVALID: ${part.slug} source ${sourceIndex + 1} (${String(source.kind)})`,
        );
      }
    }
  }

  let out = `${HEADER}export const MANNERS_PARTS: MannersPart[] = [\n`;
  for (const slug of order) {
    const part = bySlug.get(slug);
    out += `  {\n    slug: ${j(part.slug)},\n    legacyNumber: ${part.number},\n`;
    for (const key of ["title", "subtitle", "description", "summary", "audience", "caveat"]) {
      out += `    ${key}: ${j(part[key])},\n`;
    }
    out += "    sections: [\n";
    for (const section of part.sections) {
      out += `      {\n        heading: ${j(section.heading)},\n`;
      if (section.visibility) out += `        visibility: ${j(section.visibility)},\n`;
      out += "        blocks: [\n";
      for (const block of section.blocks) out += `          ${j(block)},\n`;
      out += "        ],\n      },\n";
    }
    out += "    ],\n    sources: [\n";
    for (const source of part.sources) {
      const { kind, label, url, checkedAt, scope, supports } = source;
      out += `      ${j({ kind, label, url, checkedAt, scope, supports })},\n`;
    }
    out += "    ],\n  },\n";
  }
  out += "];\n\nexport const MANNERS_CATEGORIES: MannersCategory[] = [\n";
  for (const category of CATEGORIES) {
    out += `  { id: ${j(category.id)}, tier: ${j(category.tier)}, label: ${j(category.label)}, description: ${j(category.description)}, slugs: ${j(category.slugs)} },\n`;
  }
  return `${out}];\n`;
}

const parts = SOURCES.flatMap((source) => JSON.parse(readFileSync(source, "utf8")));
const duplicateSlugs = parts
  .map((part) => part.slug)
  .filter((slug, index, slugs) => slugs.indexOf(slug) !== index);
if (duplicateSlugs.length > 0) {
  throw new Error(`MANNERS_PART_DUPLICATE: ${[...new Set(duplicateSlugs)].join(", ")}`);
}
const next = serialize(parts);
const checkOnly = process.argv.includes("--check");

if (checkOnly) {
  const current = readFileSync(TARGET, "utf8");
  if (current === next) {
    console.log("[manners] data.ts는 parts.json과 일치합니다.");
  } else {
    console.error("[manners] data.ts가 parts.json과 다릅니다. `node scripts/manners/generate.mjs`를 돌리세요.");
    process.exit(1);
  }
} else {
  writeFileSync(TARGET, next, "utf8");
  const tables = parts.flatMap((p) => p.sections.flatMap((s) => s.blocks.filter((b) => b.kind === "table")));
  const sources = parts.reduce((n, p) => n + p.sources.length, 0);
  console.log(`[manners] data.ts 생성 — 파트 ${parts.length} · 표 ${tables.length} · 출처 ${sources}`);
}
