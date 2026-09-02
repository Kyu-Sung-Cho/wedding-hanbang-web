// 화면에 나가는 한글이 **깨진 채로 커밋되지 않는가.**
//
// ## 무엇이 있었나 (2026-09-02 실측)
//
// 저장소에 깨진 한글이 두 곳 커밋돼 있었다. 한 곳은 테스트 픽스처였고, 한 곳은
// **사용자에게 나가는 오류 문구**였다 — 신고 검토가 충돌했을 때 관리자에게 409 로
// 돌려주는 말이 통째로 물음표와 한자 범벅이었다.
//
//     apps/web/src/app/api/admin/reports/[id]/route.ts:148   (commit cedd7a1b, 2026-08-04)
//       ASCII '?'(U+003F) 19자 · 한글 음절 17자 · 한자 4자 · 한글 낱자모 2자
//
// ## 어떻게 그렇게 되나
//
// UTF-8 로 저장된 바이트를 **두 바이트 한국어 코드페이지(CP949)** 로 읽으면 한글
// 한 글자가 한자·낱자모·물음표로 흩어진다. 그 물음표는 U+FFFD 가 아니라 ASCII
// 0x3F 다 — 대체 문자를 넣은 것이 아니라 **원문 바이트를 버린** 것이라 되돌릴 수
// 없다. 이 팀은 Windows 에서 개발하고, `scripts/` 의 PowerShell 이 자식 프로세스
// stdout 을 콘솔 코드페이지로 읽는 자리가 여럿 있다. 한글이 그런 경로를 한 번
// 지나면 이렇게 된다.
//
// 사람 눈으로는 안 잡힌다. 리뷰어가 한글 문자열 하나하나를 읽지 않기 때문이다.
// 그래서 기계가 본다.
//
// ## 무엇을 잡나
//
// 이 제품의 화면 문자열은 한글·영문·숫자·문장부호다. 그 안에 **한글 낱자모**나
// **한자**가 섞여 있으면 거의 언제나 깨진 것이다. 다만 둘 다 정당한 쓰임이 있어서
// (`ㅋㅋ`·`ㅇㅇ` 같은 말버릇 처리, 예절 문서의 `축 화혼(祝華婚)`) 그런 곳은
// 예외로 적어 둔다 — **예외는 파일 단위가 아니라 이유와 함께** 적는다.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const AREAS = [
  { name: "apps/web/src", dir: resolve(repoRoot, "apps/web/src"), floor: 500 },
  { name: "apps/mobile", dir: resolve(repoRoot, "apps/mobile"), floor: 120 },
  { name: "packages/shared/src", dir: resolve(repoRoot, "packages/shared/src"), floor: 25 },
];

/** 하한은 부분 손실에 눈이 멀어 있다. 깨져 있던 두 파일을 표식으로 박아 둔다. */
const SENTINELS = [
  "apps/web/src/app/api/admin/reports/[id]/route.ts",
  "apps/web/src/app/api/chat/messages/route.test.ts",
];

const SKIP_DIRS = new Set([
  "node_modules", ".next", ".expo", ".turbo", "coverage", "ios", "android", "dist", "build",
]);

const EXTENSIONS = [".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx", ".json"];

/**
 * 한자가 정당하게 쓰이는 곳.
 *
 * 예절 안내는 `축 화혼(祝華婚)`·`죽을 사(死)`·`본(本)` 처럼 한자를 **뜻을 밝히려고**
 * 쓴다. 원문은 `scripts/manners/parts.json` 이고 `apps/web/src/lib/manners/data.ts`
 * 는 거기서 생성된다(`manners-data-is-generated.test.mjs` 가 그 관계를 든다).
 */
const CJK_ALLOWED = [
  "apps/web/src/lib/manners/data.ts",
];

/**
 * 낱자모 하나만으로는 못 가른다.
 *
 * 처음에는 「낱자모가 있으면 깨진 것」으로 봤는데 실측에서 7건이 전부 오탐이었다 —
 * 욕설 필터의 `ㅂㅅ`·`ㅅㅂ`, 조사 규칙의 `ㄹ 받침`, 문법 주석의 `-ㅂ니다`, 정규식
 * 안의 아래아(`ㆍ`), 안전망 코퍼스의 `ㅋㅋ`. 이 저장소는 낱자모를 **뜻이 있어서**
 * 쓴다.
 *
 * 깨짐의 진짜 모양은 낱자모가 **물음표에 붙어 있는 것**이다(`?ㅺ?`). 버려진
 * 바이트 자리 바로 옆에 남은 조각이라 그렇다. 그 모양만 잡는다.
 */
const JAMO_BESIDE_LOST_BYTE = /[?\uFFFD][\u3131-\u318E]|[\u3131-\u318E][?\uFFFD]/u;

const CJK = /[\u4E00-\u9FFF]/u;
const REPLACEMENT = /\uFFFD/u;

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/**
 * 한 줄이 깨진 한글인가.
 *
 * 한자는 예외 파일 밖이면 깨짐으로 본다(실측 오탐 0건). 낱자모는 버려진 바이트
 * 자리에 붙어 있을 때만 깨짐으로 본다.
 */
function mangledReason(line, relativePath) {
  if (REPLACEMENT.test(line)) return "U+FFFD 대체문자";
  if (CJK.test(line) && !CJK_ALLOWED.includes(relativePath)) return "한자가 섞여 있음";
  if (JAMO_BESIDE_LOST_BYTE.test(line)) return "버려진 바이트 옆에 한글 낱자모";
  return null;
}

test("측정기가 살아 있다", () => {
  const scanned = new Set();
  for (const area of AREAS) {
    const found = walk(area.dir, []);
    assert.ok(
      found.length >= area.floor,
      `${area.name} 에서 ${found.length}개만 찾았다(하한 ${area.floor}) — 걷기가 깨졌는지 보라`,
    );
    for (const file of found) scanned.add(relative(repoRoot, file).split("\\").join("/"));
  }
  const missing = SENTINELS.filter((file) => !scanned.has(file));
  assert.deepEqual(
    missing,
    [],
    `실제로 깨져 있던 파일이 스캔 목록에 없다: ${missing.join(" · ")}`,
  );
});

test("깨진 한글이 소스에 없다", () => {
  const offenders = [];
  for (const area of AREAS) {
    for (const file of walk(area.dir, [])) {
      const relativePath = relative(repoRoot, file).split("\\").join("/");
      readFileSync(file, "utf8").split("\n").forEach((line, index) => {
        const reason = mangledReason(line, relativePath);
        if (reason) offenders.push(`${relativePath}:${index + 1} [${reason}] ${line.trim().slice(0, 70)}`);
      });
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "깨진 한글이 소스에 들어왔습니다. UTF-8 을 CP949 로 읽는 경로(Windows 콘솔·"
      + "PowerShell 리디렉션)를 한 번 지나면 이렇게 됩니다. **되돌릴 수 없으니** "
      + "원문을 다시 적으세요.\n"
      + offenders.join("\n"),
  );
});

test("검사기가 실제로 잡는다", () => {
  // 실제로 커밋돼 있던 두 줄을 그대로 표본으로 쓴다. 답을 아는 재료다.
  const planted = [
    'error: "?\uc88c\ud1ec ?\uacf9\uae6d\u5ab2 ?\ub300? \u858a\u5be2\uc38e\ub9ba?\ub387\uad74??\u5ab2\uc219? ?\u3186? ?\u3187\u2168 ?\ubd7f\uaebc???\u3145\uc2dc?\uc12f\ubfc0?\ub4ec\ub542??",',
    'content: "\u6ce5\u2464?\u745c??\ubfa5\uc19f???\ubfa4\uc528?\ub301\uc938",',
    'const label = "\ufffd\ufffd \ufffd\ufffd\ufffd";',
  ];
  for (const line of planted) {
    assert.ok(
      mangledReason(line, "apps/web/src/x.ts"),
      `심어 둔 깨진 줄을 못 잡았다: ${line}`,
    );
  }
});

test("정당한 쓰임을 잡지 않는다", () => {
  const fine = [
    ['const JOKING = /\u314b\u314b|\u314e\u314e|\ub18d\ub2f4/;', "apps/web/src/lib/ai/amoraToolPolicy.ts"],
    ['it.each(["\uc751", "\ub124", "\u3147\u3147", "\uc608", "\ub179"])(', "apps/web/src/x.test.ts"],
    ['"\u314b\u314b\u314b \uc774\ub7f4 \ubc14\uc5d4 \ucd1d\uc608\uc0b0 1\uc5b5\uc73c\ub85c \uc62c\ub824\uc11c"', "apps/web/src/x.test.ts"],
    ['for (const syllable of ["\uac00", "\ud799", "\u3131", "\u314f", "\uac01"])', "apps/web/src/x.test.ts"],
    ['{"text":"\uc625 \ud654\ud63c(\u795d\u83ef\u5a5a)\uc744 \uc7ac\ud63c\ud560 \ub54c\ub9cc"}', "apps/web/src/lib/manners/data.ts"],
    ['const title = "\ub4dc\ub808\uc2a4 \ub9e4\uc7a5 \ubc29\ubb38";', "apps/web/src/x.ts"],
    ['const q = "\uc65c \ub450 \ubc88 \ubb3c\uc5b4\ubd10??";', "apps/web/src/x.ts"],
  ];
  for (const [line, path] of fine) {
    assert.equal(
      mangledReason(line, path),
      null,
      `멀쩡한 줄을 잡았다(${path}): ${line}`,
    );
  }
});
