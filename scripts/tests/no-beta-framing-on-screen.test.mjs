// 화면에 **"베타" 라는 틀이 남아 있지 않은가** — 랜딩만이 아니라 제품 전체에서.
//
// ## 무엇이 있었나
//
// 2026-08-29 파운더 결정: "베타 우리 안할거야 알아둬". 화면·문서에서 "계정 베타",
// "사전등록", "베타 신청", "승인 대기" 같은 틀을 쓰지 않는다. 계정은 그냥 만들 수
// 있는 것이고, 기능은 그냥 있는 기능이다.
//
// 그날 랜딩에서는 걷어냈는데 **제품 화면 18곳이 그대로 남아 있었다** —
// 커뮤니티 글쓰기·이미지 API 7곳("통제 베타에서는 …"), 아모라 사용량 안내 7곳
// ("베타 무료 상담이 N회 남았어요", "(베타 기간 한도)"), 소개·푸터·커플 역할 4곳.
// 랜딩 가드들은 `components/landing/redesign` 디렉터리만 훑기 때문에 하나도 못 봤다.
//
// ## 없어지는 것은 틀이지 사실이 아니다
//
// 문구를 지운 게 아니라 **틀만 뺐다.** 사실은 그대로 남아 있다:
//   "통제 베타에서는 텍스트 게시물만"  → "지금은 텍스트 게시물만"
//   "베타 무료 상담이 3회 남았어요"     → "무료 상담이 3회 남았어요"
// 그리고 "이용 방법과 비용은 아직 정해지지 않았고 … 결제를 요청하지 않아요" 는
// 계속 참이므로 남는다 — 베타라서가 아니라 오늘 그렇기 때문이다.
//
// ## 왜 저장소 검사인가
//
// 웹 테스트는 파일별로 흩어져 있어 "제품 전체에 이 낱말이 없다"를 아무도 못 본다.
// 여기서 한 번에 훑는다. 주석은 걷어낸다 — 왜 없앴는지 적어 둔 기록까지 지우면
// 다음 사람이 같은 틀을 다시 만든다.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/**
 * 훑을 영역과 **영역별** 하한.
 *
 * ⚠️ 하한이 하나의 총합(`files.length > 200`)이었다. `apps/web/src` 혼자 771개라
 * **모바일이 0개여도 통과**했다 — 영역 하나가 통째로 사라지는 것을 구조적으로 못 본다.
 *
 * `packages/shared/src` 를 새로 넣는다. 웹·모바일이 함께 쓰는 화면 문구가 거기 있다:
 * `constants/preparationStage.ts`("이제 막 시작했어요"), `constants/accountDeletionPolicy.ts`
 * ("한 번 삭제하면 되돌릴 수 없어요"), `constants/weddingPlanning.ts`(체크리스트 label).
 *
 * 하한은 **오늘 값의 55~70%** 다. 오늘에 붙여 놓으면 정상 삭제 PR 이 걸리고, 사람은
 * 숫자를 내린다 — 두세 번이면 하한이 보증을 잃는다. origin/main 을 시점별로 세면
 * web/src 가 한 달 만에 475 → 380 으로 20% 줄어든 전례가 있다.
 */
const AREAS = [
  { name: "apps/web/src", dir: resolve(repoRoot, "apps/web/src"), floor: 500 },       // 2026-08-29 실측 771
  { name: "apps/mobile", dir: resolve(repoRoot, "apps/mobile"), floor: 120 },         // 2026-08-29 실측 171
  { name: "packages/shared/src", dir: resolve(repoRoot, "packages/shared/src"), floor: 25 }, // 실측 45
];

/**
 * 하한이 못 보는 회귀를 표식으로 잡는다.
 *
 * 숫자는 **부분 손실에 눈이 멀어 있다.** 확장자 목록에서 `.mjs` 만 빠져도 모바일은
 * 171 → 139 로 하한 120 을 넘고, 웹에서 `components/` 166개가 통째로 빠져도
 * 771 → 605 로 하한 500 을 넘는다. 그래서 "이 파일들이 목록에 있는가"를 따로 묻는다.
 *
 * 7개를 넘기지 마라 — 리팩터링마다 깨지기 시작하면 하한을 내리는 것과 같은 마모가 온다.
 * 커버가 더 필요하면 표식이 아니라 영역을 늘려라.
 */
const SENTINELS = [
  "apps/web/src/app/about/page.tsx",
  "apps/web/src/components/customer-landing/CustomerNav.tsx",
  "apps/mobile/app/_layout.tsx",
  "apps/mobile/src/lib/communityPostMutations.mjs",   // .mjs 가 빠지면 여기서 걸린다
  "apps/mobile/app.json",                             // .json 이 빠지면 여기서 걸린다
  "packages/shared/src/constants/weddingPlanning.ts",
  "packages/shared/src/constants/accountDeletionPolicy.ts",
];

const SKIP_DIRS = new Set([
  "node_modules", "__tests__", ".next", ".expo", ".turbo", "coverage",
  "ios", "android", "dist", "build",
]);

/**
 * `.tsx?` 만 보고 있었다. 그러면 모바일의 화면 문구가 통째로 빠진다 —
 * `src/lib/communityTrust.mjs`("일반 회원 · 경험 미인증"),
 * `src/lib/communityPostMutations.mjs`("로그인이 필요해요. 다시 로그인해주세요."),
 * 그리고 `app.json` 의 앱 이름·권한 문구.
 */
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".mjs", ".cjs", ".js", ".jsx", ".json"];

/** 주석을 걷어낸다. 기록은 남아도 되고, 화면에 나가는 문자열만 본다. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");
}

// ⚠️ 여기 `try { … } catch { return out }` 가 있었다. 경로가 어긋나면 **조용히 0개**를
// 돌려준다 — 이 검사에서 가장 나쁜 실패다. 형제 검사
// `source-has-no-control-characters.test.mjs` 도 catch 없이 걷는다. ENOENT 로 죽어라.
function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (EXTENSIONS.some((ext) => entry.name.endsWith(ext)) && !/\.(test|spec)\./u.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/**
 * 막는 말들.
 *
 * ⚠️ 여기 "`베타` 가 파운더가 이름으로 든 넷을 통째로 덮는다" 고 적혀 있었다. **거짓이었다.**
 * 이건 부분문자열 검사라 `베타` 가 실제로 덮는 것은 "계정 베타"·"베타 신청" **둘뿐**이다 —
 * "사전등록"·"승인 대기" 에는 그 두 글자가 없다.
 *
 * 그 둘을 목록에 넣지 않은 이유는 따로 있다.
 *
 * **"사전등록"** — 이 검사 범위 안의 출현 3건이 전부 관리자 내부 라벨이다
 * (`app/(admin)/admin/page.tsx` 의 탭 이름과 카운터, `api/admin/registrations/route.ts`
 * 의 오류 문구). 셋 다 `preregistrations` 테이블의 **행 수를 가리키는 이름**이고, 그
 * 수집 폼과 `/api/preregister` 는 2026-08-23에 없어졌다. 막으면 사실 라벨을 틀로
 * 오인한다 — 이 파일 머리말의 "없어지는 것은 틀이지 사실이 아니다" 를 스스로 어긴다.
 *
 * **"승인 대기"** — 범위 안 출현이 0건이라 넣어도 오늘은 아무것도 안 잡는다. 대신
 * **참인 상태를 말할 길을 막는다.** 파트너 승인 보류(`pending_partner`)는 지금도
 * 살아 있는 상태이고(`app/(auth)/onboarding/page.tsx`,
 * `components/app/schedule/ScheduleContent.tsx` 의 "파트너 승인 전 …"), 그것을
 * "승인 대기" 라 부르는 것은 정직한 문구다. 파운더가 든 "승인 대기" 는 그 뜻이 아니라
 * **없어진 `/beta` 대기열**이었다(`app/(auth)/login/page.test.tsx` 에 그렇게 적혀 있다).
 *
 * 낱말 목록으로는 절의 화제를 가를 수 없다. 넓히려면 **오탐이 0인지 실제 출현으로**
 * 증명하고 나서 넓혀라.
 *
 * ⚠️ 2026-08-29에 **"미리 체험하기" 를 추가**했다. 그 낱말에는 "베타" 가 없지만
 * `NEXT_PUBLIC_LAUNCH_MODE=coming_soon` 이 켜지면 주 행동 버튼이 "시작하기" 대신
 * 그것으로 바뀌었고, 그 env 가 **운영에 켜져 있어 `/about` 이 실제로 그렇게 나가고
 * 있었다**(라이브 실측). "아직 정식이 아니다" 라는 같은 틀이라 파운더가 함께 없앴다.
 * 분기는 `CustomerNav` 에서 지웠고, 이 줄은 그것이 돌아오는 것을 막는다.
 */
const BANNED = ["베타", "미리 체험하기", "coming_soon"];

test("화면 문자열에 '아직 정식이 아니다' 라는 틀이 없다", () => {
  const files = [];
  for (const area of AREAS) {
    const found = walk(area.dir, []);
    assert.ok(
      found.length >= area.floor,
      `${area.name} 에서 ${found.length}개만 찾았다(하한 ${area.floor}) — 걷기가 깨졌는지 보라(경로·SKIP_DIRS·EXTENSIONS)`,
    );
    files.push(...found);
  }

  // 하한은 부분 손실에 눈이 멀어 있다. 표식 파일이 목록에 들어 있는지 따로 묻는다.
  const scanned = new Set(files.map((f) => relative(repoRoot, f).split("\\").join("/")));
  const missing = SENTINELS.filter((f) => !scanned.has(f));
  assert.deepEqual(
    missing,
    [],
    `표식 파일이 스캔 목록에 없다 — 확장자 목록이나 영역이 좁아졌다: ${missing.join(" · ")}`,
  );

  const offenders = [];
  for (const file of files) {
    const source = stripComments(readFileSync(file, "utf8"));
    source.split("\n").forEach((line, index) => {
      const hit = BANNED.find((word) => line.includes(word));
      if (!hit) return;
      offenders.push(`${relative(repoRoot, file)}:${index + 1} [${hit}] — ${line.trim().slice(0, 60)}`);
    });
  }

  assert.deepEqual(
    offenders,
    [],
    "화면에 '베타' 라는 틀이 남았습니다(2026-08-29 파운더 결정). 사실은 남기고 틀만 "
      + "빼세요 — 예: \"통제 베타에서는 텍스트만\" → \"지금은 텍스트만\".\n"
      + offenders.join("\n"),
  );
});

test("검사기가 실제로 틀을 잡는다", () => {
  // 위 검사가 0건이라 "잡을 수 있는가"를 증명하지 못한다. 답을 아는 표본으로 잰다.
  for (const planted of [
    'const msg = "계정 베타에서는 아직 쓸 수 없어요";',
    '{isComingSoon ? "미리 체험하기" : "시작하기"}',
    'process.env.NEXT_PUBLIC_LAUNCH_MODE === "coming_soon"',
    // 주석이 "덮는다"고 말하는 틀마다 표본을 둔다. 커버리지를 부풀려 적으려면
    // 여기에 심을 표본이 있어야 하고, 없으면 거짓 주장이 이 테스트에 걸린다.
    'const label = "베타 신청";',
  ]) {
    const clean = stripComments(planted);
    assert.ok(BANNED.some((w) => clean.includes(w)), `심어 둔 틀을 못 잡았다: ${planted}`);
  }

  // 주석에 남긴 기록은 걸리지 않아야 한다 — 걸리면 왜 없앴는지를 못 적는다.
  const note = ["// 2026-08-29 파운더 결정으로 베타 틀을 없앴다", 'const ok = "지금은 텍스트만";'].join("\n");
  assert.ok(!stripComments(note).includes("베타"), "주석의 기록까지 금지하고 있다");
});
