// 결혼 예절 안내 데이터 생성기 — parts.json → apps/web/src/lib/manners/data.ts
//
// `data.ts`는 **손으로 고치지 않는다.** 고쳐야 하면 `parts.json`을 고치고 이 스크립트를 돌린다.
// 손으로 고치면 다음 재생성에서 조용히 사라진다.
//
// ⚠️ 2026-08-11에 재생성 과정 자체가 사고를 냈다. 부분 일치 치환이 문단을 잘라먹었고,
//    전체 필드 치환이 문단 앞부분을 통째로 날렸다. 그래서 이 스크립트는 **직렬화만** 한다 —
//    내용 수정 로직을 여기에 넣지 마라. 수정은 parts.json에서 하고 diff로 확인한다.
//
// 사용: node scripts/manners/generate.mjs [--check] [--source <parts.json>] [--target <data.ts>]
//   --check   파일을 쓰지 않고 현재 data.ts와 다른지만 알려준다(CI용).
//   --source  읽을 parts.json. 기본은 이 폴더의 것.
//   --target  쓰거나 비교할 data.ts. 기본은 apps/web 의 것.
//
// 경로를 밖에서 받는 이유는 **검사가 공유 파일을 안 건드리게** 하기 위해서다.
// 2026-09-04: `--check` 가 어긋남을 잡는지 증명하려고 검사가 진짜 `data.ts`(633KB)를
// 덮어썼다 되돌리고 있었는데, `node --test` 는 파일을 병렬로 돌린다. 같은 순간 그 파일을
// 읽던 다른 검사가 **쓰는 중간을 봤고**(편 제목을 25개 중 14개만 읽었다) 엉뚱한 곳에서
// 빨간불이 났다. 이제 그 검사는 임시 사본을 가리킨다.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
function argValue(name) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const SOURCE = argValue("--source") ?? path.join(here, "parts.json");
const TARGET = argValue("--target")
  ?? path.join(repoRoot, "apps", "web", "src", "lib", "manners", "data.ts");

// 카테고리 = 화면의 묶음이자 파트 출력 순서. slug는 parts.json에 실재해야 한다.
//
// 2026-08-19에 레거시 25편을 여기로 이관하면서 10편 → 25편이 됐다. 묶음은 **결혼 준비의
// 시간 순서**를 따른다 — 예절 질문은 "지금 이 시점에 뭘 하지"에 붙어 있어서, 주제를
// 가나다순이나 중요도순으로 늘어놓으면 사용자가 자기 자리를 못 찾는다.
const CATEGORIES = [
  { label: "만나고 정하기", slugs: ["first-family-visit", "family-meeting", "planning-timeline", "planning-conflicts"] },
  { label: "주고받는 것", slugs: ["gifts-and-traditions", "shared-home-items", "home-conversation", "cost-saving"] },
  { label: "청첩장과 초대", slugs: ["invitation-sending", "small-wedding", "religious-weddings"] },
  { label: "결혼식 당일", slugs: ["wedding-day", "guest-manners", "photo-manners", "traditional-greetings"] },
  { label: "마음을 전하는 법", slugs: ["gift-money", "congratulatory-speech", "return-gift"] },
  { label: "식이 끝난 뒤", slugs: ["marriage-registration", "post-honeymoon-thanks", "housewarming", "digital-manners"] },
  { label: "결혼 뒤의 가족", slugs: ["family-address", "first-holiday", "family-events"] },
];

const HEADER = `import type { MannersCategory, MannersPart } from "./types";

/**
 * 결혼 예절 안내 1단계 — 하객·지인 성격의 10파트.
 *
 * **이 파일은 생성물이다.** 고치려면 \`scripts/manners/parts.json\`을 고치고
 * \`node scripts/manners/generate.mjs\`를 돌린다. 여기서 직접 고치면 다음 재생성에서 사라진다.
 *
 * 2026-07-17 \`84b54e9f\`가 지운 예절 코퍼스 25파트 중, 가족 편차가 적고 공개 자료로
 * 확인 가능한 것부터 되살렸다. 원본을 그대로 되돌리지 않았다 — 원본은 금액 61건과
 * 법률 26건을 **출처 0건**으로 주장했고, 그게 삭제 사유였다.
 *
 * 네 번 걸렀고 사람이 다섯 번째로 읽었다. 상세는
 * \`docs/operations/MANNERS_GUIDE_PHASE1_HANDOFF_2026-08-11.md\`.
 * 계약은 \`__tests__/mannersSourceContract.test.ts\`가 강제한다.
 *
 * 남은 15파트(상견례·폐백·예단·첫 명절·호칭 등)는 가족 편차가 커서 2단계로 미뤘다.
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

  let out = `${HEADER}export const MANNERS_PARTS: MannersPart[] = [\n`;
  for (const slug of order) {
    const part = bySlug.get(slug);
    out += `  {\n    slug: ${j(part.slug)},\n    legacyNumber: ${part.number},\n`;
    for (const key of ["title", "subtitle", "description", "audience", "caveat"]) {
      out += `    ${key}: ${j(part[key])},\n`;
    }
    out += "    sections: [\n";
    for (const section of part.sections) {
      out += `      {\n        heading: ${j(section.heading)},\n        blocks: [\n`;
      for (const block of section.blocks) out += `          ${j(block)},\n`;
      out += "        ],\n      },\n";
    }
    out += "    ],\n    sources: [\n";
    for (const source of part.sources) {
      const { label, url, checkedAt, scope, supports } = source;
      out += `      ${j({ label, url, checkedAt, scope, supports })},\n`;
    }
    out += "    ],\n  },\n";
  }
  out += "];\n\nexport const MANNERS_CATEGORIES: MannersCategory[] = [\n";
  for (const category of CATEGORIES) {
    out += `  { label: ${j(category.label)}, slugs: ${j(category.slugs)} },\n`;
  }
  return `${out}];\n`;
}

const parts = JSON.parse(readFileSync(SOURCE, "utf8"));
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
