#!/usr/bin/env node
/**
 * 화면에 직접 박힌 색 리터럴을 **역할 변수**로 바꾼다.
 *
 *   node apps/web/scripts/migrate-color-literals.mjs --report
 *   node apps/web/scripts/migrate-color-literals.mjs --check
 *   node apps/web/scripts/migrate-color-literals.mjs --write
 *
 * ## 왜 필요한가
 *
 * 2026-08-28 실측: 화면 코드가 색을 직접 박은 자리가 **7,354곳**이고 서로 다른 색이
 * 514종이다(`#243832` 534회 옆에 거의 같은 `#263832` 182회가 따로 논다). 그래서
 * `colors.ts` 를 바꿔도 화면은 안 따라온다 — 같은 날 역할 변수를 종이 언어로 옮겼는데
 * 커뮤니티 화면에서 실제로 바뀐 것은 **15%** 뿐이었다(브라우저에서 그려진 색을 세어
 * 확인: 종이 182 · 옛색 1038).
 *
 * ## 왜 색 하나에 값 하나가 아닌가
 *
 * **같은 색이 속성마다 다른 뜻을 진다.** `#36534E` 는
 *
 *   - `text-` 일 때 본문 잉크
 *   - `bg-`  일 때 어두운 버튼 바탕
 *   - `border-` 일 때 **진한** 테두리
 *
 * 셋을 한 값으로 바꾸면 진한 테두리가 연한 실선이 되어 화면이 무너진다. 그래서
 * 매핑은 `속성 → 색 → 역할` 세 단계다.
 *
 * ## 무엇을 안 바꾸는가
 *
 * - **강조색(로즈·세이지 계열)**: 뜻을 지는 색이라 기계로 옮기면 의미가 바뀐다.
 *   눈으로 보면서 따로 옮긴다.
 * - **그라디언트·그림자 안의 색**: 문법이 달라 같은 규칙으로 못 바꾼다.
 * - **랜딩(`components/landing/`)**: 이미 종이 언어다.
 *
 * 그래서 이 스크립트는 "전부"가 아니라 **중립색(글자·바탕·선)**만 옮긴다. 남는 것은
 * `--report` 가 숫자로 보여 준다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(HERE, "..");
const SRC = path.join(WEB_ROOT, "src");

/**
 * 속성 → (색 → 역할 변수).
 *
 * 색은 대문자로 정규화해 비교한다. 소문자 표기도 코드에 섞여 있다.
 *
 * 역할 이름은 **`:root` 에 정의된 것만** 쓴다. 테마 블록에만 있는 이름
 * (`--hb-ivory` 등)을 쓰면 공개 화면에서 값이 없어 투명해진다 —
 * `webCssVars.ts` 가 그래서 `surface-page`·`accent`·`success` 를 `:root` 로 올렸다.
 */
const MAP = {
  text: {
    "#36534E": "--hb-text-strong",
    "#243832": "--hb-text-strong",
    "#263832": "--hb-text-strong",
    "#1A1A1F": "--hb-text-strong",
    "#635B51": "--hb-text-body",
    "#504444": "--hb-text-body",
    "#5F5B52": "--hb-text-body",
    // 2026-08-28 2차: 아래 셋이 빠져 있어서 **그라디언트 한쪽만 바뀌는** 일이 생겼다.
    // 로그인 버튼이 `from-[#36534E] to-[#2B423E]` 였는데 앞만 잉크가 되고 뒤가
    // 유칼립투스로 남아 초록 버튼이 됐다. 짝이 되는 색은 함께 옮겨야 한다.
    "#2B423E": "--hb-text-strong",
    "#4E6A62": "--hb-text-body",
    "#5E665F": "--hb-text-body",
    "#B5ADA3": "--hb-text-muted",
    "#928980": "--hb-text-muted",
    "#7D7166": "--hb-text-muted",
  },
  bg: {
    "#36534E": "--hb-primary",
    "#243832": "--hb-primary",
    "#263832": "--hb-primary",
    "#FBF8F2": "--hb-surface-page",
    "#FFFFFF": "--hb-surface-raised",
    "#F6EFE5": "--hb-surface-hover",
    "#F7F1E8": "--hb-surface-hover",
    // 그라디언트 짝. `from-[#36534E] to-[#2B423E]` 처럼 둘이 함께 온다.
    "#2B423E": "--hb-primary-hover",
  },
  border: {
    // 진한 테두리는 **진한 채로** 옮긴다. 여기서 hairline 을 쓰면 선이 사라진다.
    "#36534E": "--hb-primary",
    "#243832": "--hb-primary",
    "#E5D8CA": "--hb-hairline",
    "#EADFC9": "--hb-hairline",
    "#EFE4D7": "--hb-hairline",
  },
};

/**
 * **이름 있는 클래스** → 역할 변수.
 *
 * `text-[#36534E]` 말고 `text-noir-800` 형태다. 2026-08-28 실측으로 816곳이 있었고,
 * `/terms`·`/privacy` 는 색 리터럴이 **0개**인데 화면은 옛 색이었다 — 전부 이 형태였다.
 * 리터럴만 옮기면 그런 화면은 영원히 안 바뀐다.
 *
 * 중립색(글자·바탕·선)만 옮긴다. 강조색(rose·sage)은 **뜻을 지는 색**이라 기계로
 * 옮기면 의미가 바뀐다 — 눈으로 보면서 따로 한다.
 */
const NAMED = {
  text: {
    "noir-800": "--hb-text-strong",
    "noir-900": "--hb-text-strong",
    "noir-soft": "--hb-text-body",
    "taupe-500": "--hb-text-body",
    "taupe-400": "--hb-text-muted",
    "ivory-50": "--hb-on-primary",
  },
  bg: {
    "noir-800": "--hb-primary",
    "noir-900": "--hb-primary",
    "ivory-50": "--hb-surface-page",
    "ivory-100": "--hb-surface-hover",
    "ivory-warm": "--hb-surface-hover",
    "ivory-200": "--hb-surface-hover",
  },
  border: {
    "noir-800": "--hb-primary",
    "ivory-200": "--hb-hairline",
    "taupe-400": "--hb-hairline",
  },
};

/** `text-[#36534E]` 처럼 붙는 접두사들. 뜻이 같은 것끼리 묶는다. */
const PREFIX_GROUP = {
  text: ["text", "decoration", "caret", "accent"],
  bg: ["bg", "from", "to", "via"],
  border: ["border", "border-t", "border-b", "border-l", "border-r", "border-x", "border-y", "ring", "outline", "divide"],
};

/** 이 폴더 밑은 건드리지 않는다. */
const SKIP = [
  // ⚠️ `components/landing` **전체**가 아니라 `redesign` 만 건너뛴다.
  // 처음에 폴더째 건너뛰었다가 `/about`·`/beta`·`/demo` 가 하나도 안 바뀌었다 —
  // 그 화면들은 `components/landing/` 의 **옛 마케팅 컴포넌트**
  // (`CelebrationHero` 37곳 · `PreparationOutcomePreview` 31곳 등)를 쓰는데,
  // 그것들은 종이 언어가 아니었다(2026-08-28 화면 실측으로 드러났다).
  path.join("src", "components", "landing", "redesign"), // 이미 종이 언어
  path.join("src", "lib", "weddingCode", "research"), // 연구 프로토타입 (DESIGN.md 예외)
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** 한 파일에서 바꿀 자리를 찾는다. 실제로 바꾸지는 않는다. */
function planFor(text) {
  const edits = [];
  for (const [group, prefixes] of Object.entries(PREFIX_GROUP)) {
    const table = MAP[group];
    for (const prefix of prefixes) {
      // `text-[#36534E]` · `hover:text-[#36534e]/40` · `sm:bg-[#FBF8F2]`
      const re = new RegExp(
        `(^|[\\s"'\`])((?:[\\w[\\]@&().#%/*+~:-]+:)?${prefix}-\\[)(#[0-9A-Fa-f]{6})(\\])`,
        "gu",
      );
      let m;
      while ((m = re.exec(text)) !== null) {
        const role = table[m[3].toUpperCase()];
        if (!role) continue;
        edits.push({
          at: m.index + m[1].length,
          length: m[2].length + m[3].length + m[4].length,
          from: m[2] + m[3] + m[4],
          to: `${m[2]}var(${role})${m[4]}`,
        });
      }

      // 이름 있는 클래스도 같은 접두사 묶음을 쓴다: `text-noir-800` → `text-[var(--hb-text-strong)]`
      const namedTable = NAMED[group] ?? {};
      for (const [name, role] of Object.entries(namedTable)) {
        const nre = new RegExp(
          `(^|[\\s"'\`])((?:[\\w[\\]@&().#%/*+~:-]+:)?${prefix}-)(${name})(?![\\w-])`,
          "gu",
        );
        let nm;
        while ((nm = nre.exec(text)) !== null) {
          edits.push({
            at: nm.index + nm[1].length,
            length: nm[2].length + nm[3].length,
            from: nm[2] + nm[3],
            to: `${nm[2]}[var(${role})]`,
          });
        }
      }
    }
  }
  // 뒤에서부터 적용해야 앞의 인덱스가 안 밀린다
  return edits.sort((a, b) => b.at - a.at);
}

function apply(text, edits) {
  let out = text;
  for (const e of edits) {
    out = out.slice(0, e.at) + e.to + out.slice(e.at + e.length);
  }
  return out;
}

const files = walk(SRC).filter((f) => !SKIP.some((s) => f.includes(s)));
const mode = process.argv[2] ?? "--report";

let changedFiles = 0;
let changedSites = 0;
const perColor = new Map();

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const edits = planFor(text);
  if (edits.length === 0) continue;
  changedFiles += 1;
  changedSites += edits.length;
  for (const e of edits) {
    const color = /#[0-9A-Fa-f]{6}/u.exec(e.from)?.[0].toUpperCase() ?? "?";
    perColor.set(color, (perColor.get(color) ?? 0) + 1);
  }
  if (mode === "--write") {
    const next = apply(text, edits);
    // no-op 을 잡는다 — 정규식이 낡으면 파일을 안 고치고 "바꿨다"고 말한다.
    if (next === text) {
      console.error(`  [no-op] ${path.relative(WEB_ROOT, file)} — 계획은 ${edits.length}개인데 내용이 그대로다`);
      process.exitCode = 1;
      continue;
    }
    writeFileSync(file, next);
  }
}

console.log(`  파일 ${changedFiles}개 · 자리 ${changedSites}곳`);
console.log("");
console.log("  색별:");
for (const [color, n] of [...perColor.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${color}  ${n}곳`);
}

// 남는 것도 함께 보고한다 — "다 됐다"로 읽히지 않게.
let remaining = 0;
for (const file of files) {
  const text = mode === "--write" ? readFileSync(file, "utf8") : readFileSync(file, "utf8");
  remaining += (text.match(/#[0-9A-Fa-f]{6}/gu) ?? []).length;
}
console.log("");
console.log(`  이 스크립트가 못 옮기는 색 리터럴: ${remaining}곳 (강조색·그라디언트·인라인 스타일 등)`);

if (mode === "--check" && changedSites > 0) {
  console.error("  --check: 아직 옮기지 않은 자리가 있습니다.");
  process.exitCode = 1;
}
